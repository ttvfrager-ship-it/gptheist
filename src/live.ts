import { launchEvidence, readHeader, type LaunchEvidence } from "./launch-evidence.js";
import { AGENTS, type AgentHandoff, type AgentOutcome } from "./simulation.js";
import { assessPonsLaunch, readPonsLaunchResearch, type PonsAssessment, type PonsMarketState, type PonsTokenMetadata } from "./market.js";
import { toEventSelector } from "viem";

export const ROBINHOOD_CHAIN_ID = 4663;
export const PONS_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
export const TOKEN_LAUNCHED_TOPIC = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607" as const;
export const POOL_GRADUATED_TOPIC = toEventSelector("PoolGraduated(address,uint256,uint256,uint256)");
export const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

export interface RpcLog {
  address: string;
  removed?: boolean;
  blockHash?: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  data: string;
}

export interface LiveLaunch {
  token: string;
  blockHash?: string;
  curve: string;
  deployer: string;
  pairToken: string;
  launchConfigId: string;
  graduationThreshold: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

const ABI_ADDRESS_WORD = /^0{24}[0-9a-fA-F]{40}$/;
const ADDRESS_TOPIC = /^0x0{24}[0-9a-fA-F]{40}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function addressFromWord(word: string): string | null {
  if (!ABI_ADDRESS_WORD.test(word)) return null;
  const address = `0x${word.slice(24)}`.toLowerCase();
  return ADDRESS.test(address) ? address : null;
}

function addressFromTopic(topic: string): string | null {
  return ADDRESS_TOPIC.test(topic) ? addressFromWord(topic.slice(2)) : null;
}

function parseHexInteger(value: string): number | null {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const parsed = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function decodeTokenLaunchedLog(log: RpcLog): LiveLaunch | null {
  if (!log || log.removed === true || typeof log.address !== "string" || typeof log.blockNumber !== "string" ||
      typeof log.transactionHash !== "string" || typeof log.logIndex !== "string" ||
      typeof log.data !== "string" || !Array.isArray(log.topics) ||
      !log.topics.every((topic) => typeof topic === "string")) return null;
  if (log.address.toLowerCase() !== PONS_FACTORY) return null;
  if (log.topics.length !== 4 || log.topics[0]?.toLowerCase() !== TOKEN_LAUNCHED_TOPIC) return null;
  if (!/^0x[0-9a-fA-F]{192}$/.test(log.data)) return null;
  const token = addressFromTopic(log.topics[1] ?? "");
  const curve = addressFromTopic(log.topics[2] ?? "");
  const deployer = addressFromTopic(log.topics[3] ?? "");
  const words = log.data.slice(2).match(/.{64}/g);
  if (!token || !curve || !deployer || !words || words.length !== 3) return null;
  const pairToken = addressFromWord(words[0] ?? "");
  const blockNumber = parseHexInteger(log.blockNumber);
  const logIndex = parseHexInteger(log.logIndex);
  if (!pairToken || blockNumber === null || logIndex === null || !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)) return null;
  return {
    token,
    ...(log.blockHash ? { blockHash: log.blockHash } : {}),
    curve,
    deployer,
    pairToken,
    launchConfigId: BigInt(`0x${words[1]}`).toString(),
    graduationThreshold: BigInt(`0x${words[2]}`).toString(),
    blockNumber,
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex
  };
}

export type RpcCaller = (method: string, params?: unknown[]) => Promise<unknown>;

export interface LiveLaunchDecision extends LiveLaunch {
  chronology?: LaunchEvidence;
  verdict: "WATCH" | "VETO";
  pairLabel: "ETH" | "OTHER";
  market: PonsMarketState;
  metadata: PonsTokenMetadata;
  assessment: PonsAssessment;
  handoffs: AgentHandoff[];
  deployerResearch: {
    windowBlocks: number;
    priorLaunches: number;
    priorGraduations: number;
  };
}

export interface LiveSnapshot {
  chainId: typeof ROBINHOOD_CHAIN_ID;
  headBlock: number;
  fetchedAt: string;
  discoveredAt?: string;
  normalizedAt?: string;
  ingestedAt?: string;
  source: "Robinhood Chain RPC";
  mode: "read-only";
  historyWindowBlocks: number;
  launches: LiveLaunchDecision[];
}

/** Refresh a retained, verified LIVE launch outside the rolling latest-launch list. Read-only. */
export async function refreshLiveLaunchAtHead(rpc: RpcCaller, launch: LiveLaunchDecision, headBlock: number): Promise<LiveLaunchDecision> {
  return (await refreshLiveLaunchesAtHead(rpc, [launch], headBlock))[0]!;
}

/** Share one head header and batched market reads across the retained watchlist. */
export async function refreshLiveLaunchesAtHead(rpc: RpcCaller, launches: LiveLaunchDecision[], headBlock: number): Promise<LiveLaunchDecision[]> {
  if (!launches.length) return [];
  const blockTag = `0x${headBlock.toString(16)}`;
  const batches: LiveLaunchDecision[][] = [];
  for (let i = 0; i < launches.length; i += 24) batches.push(launches.slice(i, i + 24));
  const [header, research] = await Promise.all([
    rpc("eth_getBlockByNumber", [blockTag, false]),
    Promise.all(batches.map(batch => readPonsLaunchResearch(rpc, batch, blockTag))).then(rows => rows.flat())
  ]);
  const h = header as Record<string, unknown> | null;
  return launches.map((launch, index) => {
    const row = research[index];
    if (!h || h.number !== blockTag || typeof h.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(h.hash) ||
        typeof h.timestamp !== "string" || !/^0x[0-9a-f]+$/i.test(h.timestamp))
      return { ...launch, market: row?.market ?? { status: "UNAVAILABLE", reason: "retained launch refresh unavailable" } };
    const currentTimestamp = Number(BigInt(h.timestamp));
    const chronology = launch.chronology;
    const refreshedChronology = chronology ? { ...chronology, currentBlock: headBlock, currentTimestamp,
      currentBlockHash: h.hash, tokenAgeSeconds: chronology.launchTimestamp === null ? null : currentTimestamp - chronology.launchTimestamp } : undefined;
    if (!row || row.market.status !== "VERIFIED")
      return { ...launch, market: row?.market ?? { status: "UNAVAILABLE", reason: "retained launch refresh unavailable" },
        ...(refreshedChronology ? { chronology: refreshedChronology } : {}) };
    const assessment = assessPonsLaunch(launch.pairLabel, row.market);
    return { ...launch, market: row.market, metadata: row.metadata, assessment, verdict: assessment.verdict,
      handoffs: liveHandoffs(launch, row.market, assessment), ...(refreshedChronology ? { chronology: refreshedChronology } : {}) };
  });
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function liveHandoffs(launch: LiveLaunch, market: PonsMarketState, assessment: PonsAssessment): AgentHandoff[] {
  const isEthPair = launch.pairToken === ZERO_ADDRESS;
  const verified = market.status === "VERIFIED";
  const entries: Array<[AgentOutcome, string]> = [
    ["INFO", `Detected Pons v2 launch in block ${launch.blockNumber}.`],
    ["INFO", "Policy locked: observe verified factory events; never sign or execute."],
    [verified ? "PASS" : "VETO", verified
      ? `Curve state verified: ${market.progressBps / 100}% to graduation; current snipe tax ${market.currentSnipeTaxBps / 100}%.`
      : `Market state unavailable: ${market.reason}`],
    ["INFO", "Social evidence not claimed by this read-only feed."],
    [verified ? "PASS" : "VETO", verified
      ? "Factory record and curve state verified against the launch event."
      : "Factory record and curve state could not be verified."],
    [verified ? "INFO" : "VETO", isEthPair
      ? verified
        ? `Native ETH pair and reserves verified at ${(market.progressBps / 100).toFixed(2)}% curve progress, but executable quote and slippage evidence are not available yet.`
        : "Native ETH pair found, but liquidity and slippage evidence are unavailable."
      : "Non-ETH pair is outside the default policy."],
    ["INFO", verified
      ? `Brief: on-chain evidence verified; creator tax ${market.creatorTaxBps / 100}%; social and slippage checks remain unresolved.`
      : "Brief: launch provenance verified; market, slippage, and social checks remain unresolved."],
    ["INFO", `Explorer-linked trace ${launch.transactionHash.slice(2, 18)} prepared.`],
    [assessment.verdict === "WATCH" ? "PASS" : "VETO", assessment.verdict === "WATCH"
      ? `Watch gate cleared at ${assessment.score}/100; unresolved evidence remains visible.`
      : `Veto: ${assessment.blockers.join("; ")}.`],
    [assessment.verdict === "WATCH" ? "PASS" : "VETO", assessment.verdict === "WATCH"
      ? "WATCH approved for read-only monitoring; no order was sent."
      : "No action approved; no order was sent."]
  ];
  const timestamp = new Date().toISOString();
  return entries.map(([outcome, message], index): AgentHandoff => ({
    sequence: index + 1,
    timestamp,
    agent: AGENTS[index]?.name ?? "PROFESSOR",
    role: AGENTS[index]?.role ?? "",
    outcome,
    message
  }));
}

function isRpcLog(value: unknown): value is RpcLog {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const log = value as Record<string, unknown>;
  return typeof log.address === "string" && typeof log.blockNumber === "string" &&
    typeof log.transactionHash === "string" && typeof log.logIndex === "string" &&
    Array.isArray(log.topics) && log.topics.every((topic) => typeof topic === "string") &&
    typeof log.data === "string";
}

export interface LiveDiscoveryCache {
  head: number | null;
  headHash: string | null;
  window: number;
  launches: RpcLog[];
  graduations: RpcLog[];
}

export function createLiveDiscoveryCache(): LiveDiscoveryCache {
  return { head: null, headHash: null, window: 0, launches: [], graduations: [] };
}

export async function fetchLiveSnapshot(rpc: RpcCaller, options: { blockWindow?: number; discoveryCache?: LiveDiscoveryCache } = {}): Promise<LiveSnapshot> {
  const [chainHex, headHex] = await Promise.all([rpc("eth_chainId"), rpc("eth_blockNumber")]);
  if (typeof chainHex !== "string" || parseHexInteger(chainHex) !== ROBINHOOD_CHAIN_ID) {
    throw new Error("RPC is not Robinhood Chain mainnet (chain id 4663)");
  }
  if (typeof headHex !== "string") throw new Error("RPC returned an invalid head block");
  const headBlock = parseHexInteger(headHex);
  if (headBlock === null) throw new Error("RPC returned an invalid head block");
  const requestedWindow = options.blockWindow ?? 25_000;
  if (!Number.isSafeInteger(requestedWindow) || requestedWindow < 1 || requestedWindow > 25_000) {
    throw new Error("blockWindow must be an integer from 1 to 25000");
  }
  const fromBlock = Math.max(0, headBlock - requestedWindow + 1);
  const cache = options.discoveryCache;
  // Keep full deployer context, but fetch only new logs plus a reorg overlap after startup.
  const priorHeader = cache?.head !== null && cache?.head !== undefined && cache.headHash && cache.window === requestedWindow && headBlock > cache.head
    ? await readHeader(rpc, cache.head) : null;
  const scanFrom = cache?.head !== null && cache?.head !== undefined && priorHeader && cache.headHash && priorHeader.hash.toLowerCase() === cache.headHash.toLowerCase() && cache.window === requestedWindow && headBlock > cache.head
    ? Math.max(fromBlock, cache.head - 31) : fromBlock;
  const getLogs = (topic: string) => rpc("eth_getLogs", [{ address: PONS_FACTORY, topics: [topic],
    fromBlock: `0x${scanFrom.toString(16)}`, toBlock: headHex }]);
  const [newLogs, newGraduations] = await Promise.all([getLogs(TOKEN_LAUNCHED_TOPIC), getLogs(POOL_GRADUATED_TOPIC)]);
  const mergeLogs = (previous: RpcLog[], incoming: unknown[]): RpcLog[] => {
    const retained = previous.filter(log => {
      const block = parseHexInteger(log.blockNumber);
      return block !== null && block >= fromBlock && block < scanFrom;
    });
    const merged = new Map<string, RpcLog>();
    for (const log of [...retained, ...incoming.filter(isRpcLog)]) {
      const block = parseHexInteger(log.blockNumber);
      if (block !== null && block >= fromBlock && block <= headBlock && log.removed !== true && log.address.toLowerCase() === PONS_FACTORY)
        merged.set(`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log);
    }
    return [...merged.values()];
  };
  if (!Array.isArray(newLogs)) throw new Error("RPC returned invalid launch logs");
  if (!Array.isArray(newGraduations)) throw new Error("RPC returned invalid graduation logs");
  const rawLogs = mergeLogs(cache?.launches ?? [], newLogs);
  const discoveredAt = new Date().toISOString();
  const rawGraduations = mergeLogs(cache?.graduations ?? [], newGraduations);
  const graduatedTokens = new Set(rawGraduations.filter(isRpcLog).flatMap((log) => {
    if (log.address.toLowerCase() !== PONS_FACTORY || log.topics[0]?.toLowerCase() !== POOL_GRADUATED_TOPIC || log.topics.length < 2) return [];
    const token = addressFromTopic(log.topics[1] ?? "");
    return token ? [token] : [];
  }));
  const validDecodedLaunches = rawLogs.filter(isRpcLog).map(decodeTokenLaunchedLog).filter((launch): launch is LiveLaunch => launch !== null && launch.blockNumber >= fromBlock && launch.blockNumber <= headBlock);
  const normalizedAt = new Date().toISOString();
  const allLaunches = validDecodedLaunches
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  const decodedLaunches = allLaunches.slice(0, 24);
  const research = await readPonsLaunchResearch(rpc, decodedLaunches, headHex);
  const ingestedAt = new Date().toISOString();
  const chronology = await launchEvidence(rpc, headBlock, decodedLaunches, research.map(r => r.market), Date.parse(discoveredAt), Date.parse(normalizedAt), Date.parse(ingestedAt));
  const launches = decodedLaunches.map((launch, index): LiveLaunchDecision => {
    const market = research[index]?.market ?? { status: "UNAVAILABLE", reason: "market evidence missing" };
    const metadata = research[index]?.metadata ?? { status: "UNAVAILABLE", reason: "token metadata missing" };
    const pairLabel = launch.pairToken === ZERO_ADDRESS ? "ETH" : "OTHER";
    const assessment = assessPonsLaunch(pairLabel, market);
    const prior = allLaunches.filter((candidate) => candidate.deployer === launch.deployer &&
      (candidate.blockNumber < launch.blockNumber || (candidate.blockNumber === launch.blockNumber && candidate.logIndex < launch.logIndex)));
    return {
      ...launch,
      chronology: chronology[index]!,
      pairLabel,
      market,
      metadata,
      assessment,
      verdict: assessment.verdict,
      handoffs: liveHandoffs(launch, market, assessment),
      deployerResearch: {
        windowBlocks: requestedWindow,
        priorLaunches: prior.length,
        priorGraduations: prior.filter((candidate) => graduatedTokens.has(candidate.token)).length
      }
    };
  });
  if (cache) Object.assign(cache, { head: headBlock, headHash: chronology[0]?.currentBlockHash ?? null,
    window: requestedWindow, launches: rawLogs, graduations: rawGraduations });
  return {
    chainId: ROBINHOOD_CHAIN_ID,
    headBlock,
    fetchedAt: ingestedAt,
    discoveredAt,
    normalizedAt,
    ingestedAt,
    source: "Robinhood Chain RPC",
    mode: "read-only",
    historyWindowBlocks: requestedWindow,
    launches
  };
}

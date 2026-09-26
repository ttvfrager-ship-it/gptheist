import { randomUUID } from "node:crypto";
import { AGENTS, type AgentHandoff } from "./simulation.js";
import type { LiveLaunchDecision, LiveSnapshot } from "./live.js";
import { accountCapacity, proposeTradePlan, evaluateExit, initialManagement, type PaperTradePlan, type Management, type ExitReason } from "./paper-policy.js";

export const PAPER_CONFIG = Object.freeze({
  STARTING_BALANCE_USD: 1000, MAX_OPEN_POSITIONS: 5, MAX_DAILY_LOSS_USD: 50,
  MAX_POSITION_EQUITY_PERCENT: 2, MAX_PORTFOLIO_EXPOSURE_PERCENT: 10, MIN_CASH_RESERVE_PERCENT: 20,
  MAX_RISK_EQUITY_PERCENT: .2, MIN_POSITION_USD: 1, MAX_REAL_LIQUIDITY_PERCENT: 2,
  MAX_ENTRY_IMPACT_PERCENT: 2, MAX_DOWNSIDE_PERCENT: 25, MAX_HOLD_MS: 3_600_000,
  QUOTE_MAX_AGE_MS: 30_000, ETH_USD_MAX_AGE_MS: 30_000, MONITOR_INTERVAL_MS: 15_000
});
export type PaperConfig = { -readonly [K in keyof typeof PAPER_CONFIG]: number };
export interface Costs { feesUsd: number | null; slippageUsd: number | null; priceImpactPercent: number | null; gasUsd: number | null }
/** Prices include known fees/impact/slippage; gas is separate. Quotes must be sized to the requested fill. */
export interface PaperQuote {
  tokenAddress: string; side: "BUY" | "SELL"; timestamp: string; blockTimestamp: string;
  source: string; blockNumber: number; rawPriceUsd: number; fillPriceUsd: number;
  quantity: number; notionalUsd: number; liquidityUsd: number; costs: Costs;
  /** Exact token units and evidence retained for subsequent sell quotes. */
  tokenUnits?: string;
  evidence?: { model: "PONS_V2_CURVE"; chainId: number; curve: string; blockHash: string;
    ethUsd: number; usdTimestamp: string; usdSource: string; tokenDecimals: number;
    quoteReserve: string; tokenReserve: string; realQuoteReserve: string;
    feeBps: number; creatorTaxBps: number; snipeTaxBps: number; progressBps: number;
    amountIn: string; amountOut: string; quoteAsset: "ETH"; feeWei: string; creatorTaxWei: string; snipeTaxWei: string; modelSource: string };
}
export interface QuoteDiagnostics {
  attemptedAt: string; completedAt?: string; input: { side: string; tokenUnits?: string; quantity?: number; sizeUsd?: number };
  currentBlock?: number; blockTimestamp?: string; launchTimestamp?: string; launchBlockHash?: string;
  rpc: { method: string; params: unknown[]; response?: unknown; error?: string }[];
  ethUsd?: unknown; market?: unknown; calculation?: Record<string, string>; failure?: string;
}
export type QuoteResult = ({ status: "AVAILABLE"; quote: PaperQuote } |
  { status: "NOT_PAPER_TRADABLE"; reason: string; details: string[] }) & { diagnostics?: QuoteDiagnostics };
export interface Candidate {
  tokenAddress: string; name: string; symbol: string; launchId: string;
  launch?: LiveLaunchDecision;
  decision: "WATCH" | "VETO";
  evidenceComplete: boolean; handoffs: AgentHandoff[]; quote: QuoteResult;
}
export interface Eligibility { outcome: "PAPER_ELIGIBLE" | "PAPER_BUY" | "PAPER_REJECT" | "NOT_TRADABLE" | "VETO"; reason: string; details: string[] }
export interface ActivityEvent {
  timestamp: string; category: "RESEARCH" | "PAPER" | "SYSTEM"; stage: string;
  tokenAddress: string | null; tokenSymbol: string | null; eventType: string; message: string; metadata: Record<string, unknown>;
}
export interface Position {
  id: string; mode: "PAPER"; execution: "SIMULATED"; candidate: Candidate;
  tokenAddress: string; name: string; symbol: string; launchId: string;
  entry: PaperQuote; current: PaperQuote; quantity: number; sizeUsd: number; costBasisUsd: number;
  plan: PaperTradePlan; management: Management;
  quoteDiagnostics?: QuoteDiagnostics; lastQuoteAttempt?: string; quoteFailureDetails?: string[]; launchTimestamp?: string; launchBlockHash?: string;
  enteredAt: string; markStatus: "FRESH" | "UNAVAILABLE"; markReason: string | null;
}
export interface ClosedTrade extends Position {
  exit: PaperQuote; exitedAt: string; pnlUsd: number; returnPercent: number; exitReason: ExitReason | "STOP_LOSS" | "TAKE_PROFIT"; exitReasoning: string[];
}
export interface CandidateDecision extends Eligibility { timestamp: string; candidate: Candidate; sizeUsd: number; gptheistVerdict: Candidate["decision"]; paperVerdict: Eligibility["outcome"]; plan?: PaperTradePlan }
export interface EquitySnapshot { timestamp: string; equity: number; stalePositions: number }
export interface PaperState {
  schemaVersion: 2; mode: "PAPER"; createdAt: string; config: PaperConfig; cash: number;
  positions: Position[]; trades: ClosedTrade[]; decisions: CandidateDecision[];
  events: ActivityEvent[]; history: EquitySnapshot[]; lastSnapshotAt: string | null;
  latestGate: { stage: string; outcome: string; message: string } | null;
}
const positive = (n: number): boolean => Number.isFinite(n) && n > 0;
const iso = (now: number): string => new Date(now).toISOString();
export function initialPaperState(now = Date.now(), config: PaperConfig = PAPER_CONFIG): PaperState {
  if (Object.keys(PAPER_CONFIG).some(key => !positive(config[key as keyof PaperConfig])) ||
      !Number.isInteger(config.MAX_OPEN_POSITIONS) || config.MAX_POSITION_EQUITY_PERCENT > 100 ||
      config.MAX_PORTFOLIO_EXPOSURE_PERCENT > 100 || config.MIN_CASH_RESERVE_PERCENT >= 100 ||
      config.MAX_RISK_EQUITY_PERCENT > 100 || config.MAX_DOWNSIDE_PERCENT >= 100 ||
      config.MAX_REAL_LIQUIDITY_PERCENT > 100 || config.MAX_ENTRY_IMPACT_PERCENT >= 100) throw new Error("Invalid paper configuration");
  return { schemaVersion: 2, mode: "PAPER", createdAt: iso(now), config: { ...config }, cash: config.STARTING_BALANCE_USD,
    positions: [], trades: [], decisions: [], events: [], history: [{ timestamp: iso(now), equity: config.STARTING_BALANCE_USD, stalePositions: 0 }],
    lastSnapshotAt: null, latestGate: null };
}
export function quoteProblem(q: PaperQuote, now: number, maxAge: number, usdMaxAge = maxAge): string | null {
  try {
  if (![q.rawPriceUsd, q.fillPriceUsd, q.quantity, q.notionalUsd, q.liquidityUsd].every(positive) ||
      !Number.isSafeInteger(q.blockNumber) || q.blockNumber < 0 || !q.source ||
      !["BUY", "SELL"].includes(q.side) || !/^0x[0-9a-f]{40}$/i.test(q.tokenAddress) ||
      ![q.costs.feesUsd, q.costs.slippageUsd, q.costs.priceImpactPercent, q.costs.gasUsd].every(v => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0)) ||
      Object.values(q.costs).some(v => v !== null && (!Number.isFinite(v) || v < 0)) ||
      !Number.isFinite(q.fillPriceUsd * q.quantity) ||
      Math.abs(q.fillPriceUsd * q.quantity - q.notionalUsd) > Math.max(1e-8, q.notionalUsd * 1e-8)) return "INVALID_QUOTE";
  if (q.evidence && (q.evidence.model !== "PONS_V2_CURVE" || q.evidence.chainId !== 4663 || !positive(q.evidence.ethUsd) ||
      !q.evidence.usdSource || !/^0x[0-9a-f]{64}$/i.test(q.evidence.blockHash) || !q.tokenUnits || !/^[1-9][0-9]*$/.test(q.tokenUnits))) return "INVALID_QUOTE_EVIDENCE";
  for (const time of [q.timestamp, q.blockTimestamp, ...(q.evidence ? [q.evidence.usdTimestamp] : [])]) {
    const age = now - Date.parse(time);
    if (!Number.isFinite(age) || age < 0 || age > (q.evidence && time === q.evidence.usdTimestamp ? usdMaxAge : maxAge)) return q.evidence && time === q.evidence.usdTimestamp ? "ETH_USD_STALE" : "QUOTE_STALE";
  }
  return null;
  } catch { return "INVALID_QUOTE"; }
}
export function dailyRealizedLoss(state: PaperState, now: number): number {
  const day = iso(now).slice(0, 10);
  return state.trades.filter(t => t.exitedAt.slice(0, 10) === day).reduce((sum, t) => sum + Math.max(0, -t.pnlUsd), 0);
}
export function isPaperTradeEligible(candidate: Candidate, state: PaperState, sizeUsd: number, now = Date.now()): Eligibility {
  const reject = (reason: string, outcome: Eligibility["outcome"] = "PAPER_REJECT", details: string[] = []): Eligibility => ({ outcome, reason, details });
  if (candidate.decision === "VETO" || candidate.handoffs.some(h => h.outcome === "VETO")) return reject("GPTHEIST_VETO", "VETO");
  if (candidate.decision !== "WATCH" || !candidate.evidenceComplete || !completedWatch(candidate.handoffs)) return reject("INCOMPLETE_GPTHEIST_WATCH");
  if (!/^0x[0-9a-f]{40}$/i.test(candidate.tokenAddress) || !candidate.launchId) return reject("INVALID_CANDIDATE");
  if (candidate.quote.status !== "AVAILABLE") return reject(candidate.quote.reason, "NOT_TRADABLE", candidate.quote.details);
  if (candidate.launch && candidate.launch.pairToken !== `0x${"0".repeat(40)}`) return reject("UNSUPPORTED_PAIR", "NOT_TRADABLE");
  const q = candidate.quote.quote;
  const problem = quoteProblem(q, now, state.config.QUOTE_MAX_AGE_MS, state.config.ETH_USD_MAX_AGE_MS);
  if (problem) return reject(problem, "NOT_TRADABLE");
  if (q.side !== "BUY" || q.tokenAddress.toLowerCase() !== candidate.tokenAddress.toLowerCase()) return reject("QUOTE_MISMATCH", "NOT_TRADABLE");
  if (candidate.launch && (!q.evidence || q.evidence.curve.toLowerCase() !== candidate.launch.curve.toLowerCase())) return reject("MISSING_QUOTE_PROVENANCE", "NOT_TRADABLE");
  const capacity = accountCapacity(state);
  if (!positive(sizeUsd) || sizeUsd < state.config.MIN_POSITION_USD) return reject("SIZE_NOT_EXECUTABLE");
  if (sizeUsd > capacity.equityUsd * state.config.MAX_POSITION_EQUITY_PERCENT / 100 + 1e-8) return reject("MAX_POSITION_EXPOSURE");
  if (capacity.exposureUsd + sizeUsd > capacity.equityUsd * state.config.MAX_PORTFOLIO_EXPOSURE_PERCENT / 100 + 1e-8) return reject("MAX_PORTFOLIO_EXPOSURE");
  if (Math.abs(q.notionalUsd - sizeUsd) > 1e-8) return reject("QUOTE_SIZE_MISMATCH", "NOT_TRADABLE");
  if (q.liquidityUsd < sizeUsd) return reject("INSUFFICIENT_LIQUIDITY", "NOT_TRADABLE");
  if (sizeUsd > q.liquidityUsd * state.config.MAX_REAL_LIQUIDITY_PERCENT / 100 + 1e-8) return reject("REAL_LIQUIDITY_CAP");
  if (q.costs.priceImpactPercent === null || q.costs.priceImpactPercent > state.config.MAX_ENTRY_IMPACT_PERCENT) return reject("PRICE_IMPACT_LIMIT");
  if (state.positions.some(p => p.tokenAddress.toLowerCase() === candidate.tokenAddress.toLowerCase())) return reject("DUPLICATE_POSITION");
  if (state.trades.some(t => t.launchId === candidate.launchId)) return reject("LAUNCH_ALREADY_TRADED");
  if (state.positions.length >= state.config.MAX_OPEN_POSITIONS) return reject("MAX_OPEN_POSITIONS");
  if (dailyRealizedLoss(state, now) >= state.config.MAX_DAILY_LOSS_USD) return reject("DAILY_LOSS_LIMIT");
  if (sizeUsd + (q.costs.gasUsd ?? 0) > state.cash) return reject("INSUFFICIENT_PAPER_CASH");
  if (state.cash - sizeUsd - (q.costs.gasUsd ?? 0) < capacity.equityUsd * state.config.MIN_CASH_RESERVE_PERCENT / 100 - 1e-8) return reject("MIN_CASH_RESERVE");
  return { outcome: "PAPER_ELIGIBLE", reason: "ALL_PAPER_GATES_CLEARED", details: ["SIMULATED_EXECUTION", "Social quality is unverified; gas and execution drift are excluded when unknown"] };
}
/** Every agent must finish in order. INFO is honest completion, not fabricated PASS evidence. */
export function completedWatch(handoffs: AgentHandoff[]): boolean {
  return handoffs.length === AGENTS.length && AGENTS.every((agent, index) => {
    const h = handoffs[index];
    return h?.agent === agent.name && h.sequence === index + 1 &&
      (["RIO", "LISBON", "PALERMO", "PROFESSOR"].includes(agent.name) ? h.outcome === "PASS" : ["PASS", "INFO"].includes(h.outcome));
  });
}
export function positionValue(p: Position): number { return p.current.notionalUsd - (p.current.side === "SELL" ? p.current.costs.gasUsd ?? 0 : 0); }
export function accountSummary(state: PaperState) {
  const realizedPnl = state.trades.reduce((sum, t) => sum + t.pnlUsd, 0);
  const value = state.positions.reduce((sum, p) => sum + positionValue(p), 0);
  const unrealizedPnl = state.positions.reduce((sum, p) => sum + positionValue(p) - p.costBasisUsd, 0);
  const equity = state.cash + value;
  return { startingBalance: state.config.STARTING_BALANCE_USD, availableCash: state.cash, equity, realizedPnl, unrealizedPnl,
    totalPnl: equity - state.config.STARTING_BALANCE_USD, totalReturnPercent: (equity / state.config.STARTING_BALANCE_USD - 1) * 100 };
}
export function performance(state: PaperState) {
  const trades = state.trades, wins = trades.filter(t => t.pnlUsd > 0), losses = trades.filter(t => t.pnlUsd < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0), grossLoss = -losses.reduce((s, t) => s + t.pnlUsd, 0);
  let peakEquity = state.config.STARTING_BALANCE_USD, maximumDrawdown = 0, maximumDrawdownUsd = 0;
  for (const h of state.history) { peakEquity = Math.max(peakEquity, h.equity); maximumDrawdownUsd = Math.max(maximumDrawdownUsd, peakEquity - h.equity); maximumDrawdown = Math.max(maximumDrawdown, (peakEquity - h.equity) / peakEquity * 100); }
  const fills = [...state.positions.map(p => p.entry), ...trades.flatMap(t => [t.entry, t.exit])];
  const cost = (key: keyof Costs) => ({ knownUsd: fills.reduce((s, q) => s + (q.costs[key] ?? 0), 0), unknownFills: fills.filter(q => q.costs[key] === null).length });
  return { totalTrades: trades.length, wins: wins.length, losses: losses.length, winRate: trades.length ? wins.length / trades.length * 100 : 0,
    grossProfit, grossLoss, netPnl: grossProfit - grossLoss, averageWin: wins.length ? grossProfit / wins.length : null,
    averageLoss: losses.length ? -grossLoss / losses.length : null, profitFactor: grossLoss ? grossProfit / grossLoss : null,
    expectancy: trades.length ? (grossProfit - grossLoss) / trades.length : null, maximumDrawdown, maximumDrawdownUsd, peakEquity,
    averageHoldingTime: trades.length ? trades.reduce((s, t) => s + Date.parse(t.exitedAt) - Date.parse(t.enteredAt), 0) / trades.length : null,
    estimatedFees: cost("feesUsd"), estimatedSlippage: cost("slippageUsd"), estimatedGasCosts: cost("gasUsd") };
}
export function activity(state: PaperState, eventType: string, message: string, now: number, candidate?: Candidate, metadata: Record<string, unknown> = {}): void {
  state.events.push({ timestamp: iso(now), category: "PAPER", stage: "PAPER", tokenAddress: candidate?.tokenAddress ?? null,
    tokenSymbol: candidate?.symbol ?? null, eventType, message, metadata });
}
export function recordEquity(state: PaperState, now: number): void {
  state.history.push({ timestamp: iso(now), equity: accountSummary(state).equity, stalePositions: state.positions.filter(p => p.markStatus !== "FRESH").length });
}
export function enterPaper(state: PaperState, candidate: Candidate, sizeUsd: number, now = Date.now(), plan?: PaperTradePlan): Eligibility {
  let result = isPaperTradeEligible(candidate, state, sizeUsd, now);
  if (plan && (Math.abs(plan.approvedSizeUsd - sizeUsd) > 1e-8 || sizeUsd * plan.exitPolicy.downsidePercent / 100 > plan.riskBudgetUsd + 1e-8)) {
    result = { outcome: "PAPER_REJECT", reason: "PLAN_RISK_BUDGET", details: [] };
  }
  const recorded = structuredClone(candidate);
  if (recorded.quote.status === "AVAILABLE" && quoteProblem(recorded.quote.quote, now, state.config.QUOTE_MAX_AGE_MS)) {
    recorded.quote = { status: "NOT_PAPER_TRADABLE", reason: result.reason, details: ["Invalid or stale quote excluded from stored numeric evidence"] };
  }
  result.details = [...new Set(result.details.filter(d => d !== result.reason))];
  state.decisions.push({ ...result, timestamp: iso(now), candidate: recorded, sizeUsd: Number.isFinite(sizeUsd) ? sizeUsd : 0,
    gptheistVerdict: candidate.decision, paperVerdict: result.outcome, ...(plan ? { plan: structuredClone(plan) } : {}) });
  activity(state, result.outcome, result.reason, now, candidate, { details: result.details });
  state.latestGate = { stage: "PAPER", outcome: result.outcome, message: result.reason };
  if (result.outcome !== "PAPER_ELIGIBLE" || candidate.quote.status !== "AVAILABLE") return result;
  const q = structuredClone(candidate.quote.quote), costBasisUsd = sizeUsd + (q.costs.gasUsd ?? 0);
  const savedPlan = structuredClone(plan ?? proposeTradePlan(state, candidate, q, now));
  savedPlan.approvedSizeUsd = sizeUsd; savedPlan.entryQuote = q;
  state.cash -= costBasisUsd;
  state.positions.push({ id: randomUUID(), mode: "PAPER", execution: "SIMULATED", candidate: structuredClone(candidate),
    tokenAddress: candidate.tokenAddress, name: candidate.name, symbol: candidate.symbol, launchId: candidate.launchId,
    plan: savedPlan, management: initialManagement(), entry: q, current: q, quantity: q.quantity, sizeUsd, costBasisUsd, enteredAt: iso(now), markStatus: "UNAVAILABLE", markReason: "Awaiting independent exit quote" });
  activity(state, "PAPER_BUY", "SIMULATED position opened after PAPER_ELIGIBLE", now, candidate, { sizeUsd, quantity: q.quantity, fillPriceUsd: q.fillPriceUsd, source: q.source });
  recordEquity(state, now);
  return { ...result, outcome: "PAPER_BUY" };
}
export function markPaperPosition(state: PaperState, id: string, result: QuoteResult, now = Date.now()): boolean {
  const p = state.positions.find(p => p.id === id);
  if (!p) return false;
  p.lastQuoteAttempt = result.diagnostics?.attemptedAt ?? iso(now);
  if (result.diagnostics) {
    p.quoteDiagnostics = result.diagnostics;
    if (result.diagnostics.launchTimestamp) { p.launchTimestamp = result.diagnostics.launchTimestamp; p.launchBlockHash = result.diagnostics.launchBlockHash!; }
  }
  p.quoteFailureDetails = result.status === "AVAILABLE" ? [] : result.details;
  const q = result.status === "AVAILABLE" ? result.quote : null;
  const problem = q ? quoteProblem(q, now, state.config.QUOTE_MAX_AGE_MS, state.config.ETH_USD_MAX_AGE_MS) ??
    (q.side !== "SELL" || q.tokenAddress.toLowerCase() !== p.tokenAddress.toLowerCase() || Math.abs(q.quantity - p.quantity) > p.quantity * 1e-10 ||
     (p.entry.tokenUnits && q.tokenUnits !== p.entry.tokenUnits) ? "QUOTE_MISMATCH" : null) : result.status === "NOT_PAPER_TRADABLE" ? result.reason : "QUOTE_UNAVAILABLE";
  if (problem || !q || q.notionalUsd > q.liquidityUsd || (q.costs.gasUsd ?? 0) >= q.notionalUsd) {
    p.markStatus = "UNAVAILABLE"; p.markReason = problem ?? "INSUFFICIENT_EXIT_LIQUIDITY";
    p.management.quoteFailureCount++; p.management.consecutiveQuoteFailures++;
    p.management.holdReason = `QUOTE UNAVAILABLE: ${p.markReason}; last successful value retained`;
    activity(state, "QUOTE_UNAVAILABLE", p.markReason, now, p.candidate);
    recordEquity(state, now); return false;
  }
  p.current = structuredClone(q); p.markStatus = "FRESH"; p.markReason = null;
  p.management.lastSuccessfulQuote = structuredClone(q); p.management.lastSuccessfulQuoteTimestamp = q.timestamp;
  p.management.consecutiveQuoteFailures = 0;
  const value = positionValue(p), ret = (value / p.costBasisUsd - 1) * 100;
  if (p.management.peakLiquidationValueUsd === null || value > p.management.peakLiquidationValueUsd) {
    p.management.peakLiquidationValueUsd = value; p.management.peakReturnPercent = ret; p.management.peakTimestamp = q.timestamp;
  }
  activity(state, "SELL_QUOTE_UPDATED", "Fresh full-quantity liquidation quote", now, p.candidate,
    { liquidationValueUsd: value, pnlUsd: value - p.costBasisUsd, fillPriceUsd: q.fillPriceUsd, source: q.source });
  recordEquity(state, now); return true;
}
export type QuoteProvider = (position: Position) => Promise<QuoteResult>;
export async function monitorPaper(state: PaperState, provider: QuoteProvider, clock = Date.now): Promise<void> {
  const get = async (p: Position): Promise<QuoteResult> => {
    try { return await provider(structuredClone(p)); }
    catch { return { status: "NOT_PAPER_TRADABLE", reason: "QUOTE_UNAVAILABLE", details: ["RPC failure; last valuation retained"] }; }
  };
  await Promise.all([...state.positions].map(async p => {
    if (!markPaperPosition(state, p.id, await get(p), clock())) return;
    const decision = p.management.pendingExit ?? evaluateExit(p, clock());
    if (!decision) return;
    // Once triggered, a risk exit remains pending through outages. Never sell an old quote.
    p.management.pendingExit = decision;
    activity(state, "DYNAMIC_EXIT_CONDITION_MET", decision.reason, clock(), p.candidate, { reasoning: decision.reasoning });
    const finalQuote = await get(p);
    if (!markPaperPosition(state, p.id, finalQuote, clock()) || finalQuote.status !== "AVAILABLE") return;
    const now = clock(), q = structuredClone(finalQuote.quote), value = positionValue(p);
    const pnlUsd = value - p.costBasisUsd, returnPercent = pnlUsd / p.costBasisUsd * 100;
    state.cash += value;
    state.trades.push({ ...p, exit: q, exitedAt: iso(now), pnlUsd, returnPercent, exitReason: decision.reason, exitReasoning: decision.reasoning });
    state.positions = state.positions.filter(position => position.id !== p.id);
    activity(state, "SIMULATED_SELL", decision.reason, now, p.candidate, { pnlUsd, returnPercent, finalQuote: q });
    activity(state, "REALIZED_PNL_RECORDED", "Final quoted proceeds credited to paper cash", now, p.candidate, { pnlUsd, returnPercent });
    recordEquity(state, now);
  }));
}
/** WATCH remains the research verdict; eligibility is a separate paper decision. */
export function liveCandidate(launch: LiveLaunchDecision): Candidate {
  return { launch, tokenAddress: launch.token, name: launch.metadata.status === "DECLARED" ? launch.metadata.name : launch.token,
    symbol: launch.metadata.status === "DECLARED" ? launch.metadata.symbol : "—", launchId: `${launch.transactionHash}:${launch.logIndex}`,
    decision: launch.verdict, evidenceComplete: launch.market.status === "VERIFIED" && completedWatch(launch.handoffs), handoffs: launch.handoffs,
    quote: unavailablePonsQuote(launch) };
}
export function unavailablePonsQuote(launch?: LiveLaunchDecision): QuoteResult {
  return { status: "NOT_PAPER_TRADABLE", reason: launch && launch.market.status !== "VERIFIED" ? "MARKET_UNAVAILABLE" : "QUOTE_NOT_REQUESTED",
    details: [] };
}
export type EntryQuoteProvider = (launch: LiveLaunchDecision, sizeUsd: number) => Promise<QuoteResult>;
export async function observeSnapshot(state: PaperState, snapshot: LiveSnapshot, now = Date.now(), quotes?: EntryQuoteProvider, clock: () => number = () => now): Promise<void> {
  if (snapshot.fetchedAt === state.lastSnapshotAt) return;
  state.lastSnapshotAt = snapshot.fetchedAt;
  const latest = snapshot.launches[0];
  if (latest) state.latestGate = { stage: "PROFESSOR", outcome: latest.verdict, message: latest.handoffs.at(-1)?.message ?? "" };
  for (const launch of snapshot.launches) {
    const candidate = liveCandidate(launch);
    for (const h of candidate.handoffs) state.events.push({ timestamp: h.timestamp, category: "RESEARCH", stage: h.agent,
      tokenAddress: launch.token, tokenSymbol: candidate.symbol, eventType: h.outcome, message: h.message, metadata: { launchId: candidate.launchId, block: snapshot.headBlock } });
    // Do not repeatedly quote or re-enter a launch already held or completed.
    if (state.positions.some(p => p.tokenAddress === launch.token) || state.trades.some(t => t.launchId === candidate.launchId)) continue;
    if (candidate.decision === "WATCH" && candidate.evidenceComplete && quotes) {
      const age = clock() - Date.parse(snapshot.fetchedAt);
      if (!Number.isFinite(age) || age < 0 || age > state.config.QUOTE_MAX_AGE_MS) {
        candidate.quote = { status: "NOT_PAPER_TRADABLE", reason: "STALE_RESEARCH", details: [] };
      } else {
        activity(state, "WATCH", "Full GPTHEIST chain completed; requesting sized paper quote", clock(), candidate);
        await preparePaperTrade(state, candidate, quotes, clock);
        continue;
      }
    }
    enterPaper(state, candidate, state.config.MIN_POSITION_USD, clock());
  }
  recordEquity(state, now);
}

/** Separate experimental paper policy and sizing; never rewrites the GPTHEIST verdict. */
export async function preparePaperTrade(state: PaperState, candidate: Candidate, quotes: EntryQuoteProvider, clock = Date.now): Promise<void> {
  if (!candidate.launch) return;
  const get = async (size: number): Promise<QuoteResult> => {
    try { return await quotes(candidate.launch!, size); }
    catch { return { status: "NOT_PAPER_TRADABLE", reason: "QUOTE_UNAVAILABLE", details: [] }; }
  };
  const reject = (reason: string, size: number, details: string[] = []): void => {
    candidate.quote = { status: "NOT_PAPER_TRADABLE", reason, details: [...new Set(details)] };
    enterPaper(state, candidate, size, clock());
  };
  const capacity = accountCapacity(state);
  if (capacity.availableCapacityUsd < state.config.MIN_POSITION_USD) { reject("INSUFFICIENT_PAPER_CAPACITY", 0); return; }
  let probeSize = capacity.availableCapacityUsd;
  candidate.quote = await get(probeSize);
  while (candidate.quote.status !== "AVAILABLE" && ["GRADUATION_FILL_UNSUPPORTED", "INVALID_SIZE", "INSUFFICIENT_LIQUIDITY"].includes(candidate.quote.reason) && probeSize / 2 >= state.config.MIN_POSITION_USD) {
    probeSize = Math.floor(probeSize * 50) / 100; candidate.quote = await get(probeSize);
  }
  if (candidate.quote.status !== "AVAILABLE") { enterPaper(state, candidate, probeSize, clock()); return; }
  const problem = quoteProblem(candidate.quote.quote, clock(), state.config.QUOTE_MAX_AGE_MS, state.config.ETH_USD_MAX_AGE_MS);
  if (problem) { reject(problem, 0); return; }
  activity(state, "QUOTE_VERIFIED", "Fresh sized curve quote and ETH/USD reference", clock(), candidate);
  let plan = proposeTradePlan(state, candidate, candidate.quote.quote, clock());
  let size = Math.min(plan.proposedSizeUsd, probeSize);
  let iterations = 0;
  const attempts: PaperTradePlan["sizingAttempts"] = [];
  while (size >= state.config.MIN_POSITION_USD && iterations++ < 12) {
    candidate.quote = await get(size);
    if (candidate.quote.status === "AVAILABLE") {
      const gate = isPaperTradeEligible(candidate, state, size, clock());
      attempts.push({ sizeUsd: size, outcome: gate.reason, impactPercent: candidate.quote.quote.costs.priceImpactPercent });
      if (gate.outcome === "PAPER_ELIGIBLE") {
        // Re-evaluate the risk budget against the approved-size quote, never enlarge it here.
        const refreshed = proposeTradePlan(state, candidate, candidate.quote.quote, clock());
        if (refreshed.proposedSizeUsd + 1e-8 < size) { size = refreshed.proposedSizeUsd; plan = refreshed; continue; }
        plan = { ...refreshed, proposedSizeUsd: plan.proposedSizeUsd, approvedSizeUsd: size, sizingAttempts: attempts };
        activity(state, "PAPER_ELIGIBLE", "WATCH passed separate quote and paper risk policy", clock(), candidate);
        activity(state, "POSITION_SIZE_CALCULATED", `Dynamic size $${size.toFixed(2)}`, clock(), candidate, { riskBudgetUsd: plan.riskBudgetUsd, attempts });
        activity(state, "TRADE_PLAN_CREATED", plan.riskClass, clock(), candidate, { reasoning: plan.reasoning, exitPolicy: plan.exitPolicy });
        // A distinct final read is mandatory after planning; a failed quote never fills.
        candidate.quote = await get(size);
        if (candidate.quote.status !== "AVAILABLE") { enterPaper(state, candidate, size, clock()); return; }
        const finalProblem = quoteProblem(candidate.quote.quote, clock(), state.config.QUOTE_MAX_AGE_MS, state.config.ETH_USD_MAX_AGE_MS);
        if (finalProblem) { reject(finalProblem, size); return; }
        const finalPlan = proposeTradePlan(state, candidate, candidate.quote.quote, clock());
        if (finalPlan.proposedSizeUsd + 1e-8 < size) { reject("FINAL_QUOTE_RISK_CHANGED", size); return; }
        plan = { ...finalPlan, proposedSizeUsd: plan.proposedSizeUsd, approvedSizeUsd: size, sizingAttempts: attempts };
        enterPaper(state, candidate, size, clock(), plan); return;
      }
      if (!["PRICE_IMPACT_LIMIT", "INSUFFICIENT_LIQUIDITY"].includes(gate.reason)) { enterPaper(state, candidate, size, clock()); return; }
    } else {
      attempts.push({ sizeUsd: size, outcome: candidate.quote.reason, impactPercent: null });
      if (!["GRADUATION_FILL_UNSUPPORTED", "INVALID_SIZE", "INSUFFICIENT_LIQUIDITY"].includes(candidate.quote.reason)) { enterPaper(state, candidate, size, clock()); return; }
    }
    size = Math.floor(size * 50) / 100;
  }
  reject("SIZE_NOT_EXECUTABLE", size, attempts.map(a => a.outcome));
}

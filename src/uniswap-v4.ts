import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, formatUnits, keccak256, parseAbi, type Hex } from "viem";
import { PONS_FACTORY, ROBINHOOD_CHAIN_ID, type LiveLaunchDecision, type RpcCaller } from "./live.js";
import { PAPER_CONFIG, quoteProblem, type PaperConfig, type PaperQuote, type QuoteResult } from "./paper.js";
import type { UsdRateProvider } from "./paper-quotes.js";

// Official chain-4663 deployments: https://developers.uniswap.org/docs/protocols/v4/deployments
export const V4 = {
  manager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  router: "0x8876789976decbfcbbbe364623c63652db8c0904",
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  reservesLens: "0x0000001b173c3bbf3984d417d8614e3eed34865b",
} as const;
const ZERO = `0x${"0".repeat(40)}`;
export interface V4Route {
  market: "UNISWAP_V4"; pool: Hex; manager: string; quoter: string; router: string;
  key: { currency0: Hex; currency1: Hex; fee: number; tickSpacing: number; hooks: Hex };
}
export interface V4Evidence {
  route: V4Route; blockHash: string; chainId: number; tokenDecimals: number;
  amountIn: string; amountOut: string; ethUsd: number; usdTimestamp: string; usdSource: string;
  activeLiquidity: string; quotePrincipalWei: string; gasEstimate: string;
}
export const V4_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "function poolManager() view returns (address)", "function memeHook() view returns (address)",
  "function factory() view returns (address)", "function decimals() view returns (uint8)",
  "function getSlot0(bytes32 poolId) view returns (uint160,int24,uint24,uint24)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
  "function quoteExactInputSingle((PoolKey poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  "function getPoolTVL(address manager,PoolKey key) view returns ((uint256 coreAmount0,uint256 coreAmount1,uint256 hookReserves0,uint256 hookReserves1,uint256 hookEffective0,uint256 hookEffective1,uint160 sqrtPriceX96,int24 tick,uint128 activeLiquidity,uint256 blockNumber,address statsProvider,uint16 hookPermissions,bool hasCustomAccounting,uint8 statsStatus))"
]);
export function v4PoolId(key: V4Route["key"]): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}
/** Pons factory snapshot identifies the pool, including its original hook. Never reads a v2/v3 pair. */
export async function readV4SellQuote(rpc: RpcCaller, usd: UsdRateProvider, launch: LiveLaunchDecision,
  order: { tokenUnits: string; quantity: number; tokenDecimals?: number }, clock = Date.now, config: PaperConfig = PAPER_CONFIG): Promise<QuoteResult> {
  const fail = (reason: string): never => { throw new Error(reason); };
  try {
    if (await rpc("eth_chainId") !== `0x${ROBINHOOD_CHAIN_ID.toString(16)}`) fail("WRONG_CHAIN");
    if (!/^[1-9][0-9]*$/.test(order.tokenUnits) || BigInt(order.tokenUnits) >= 1n << 128n) fail("INVALID_TOKEN_AMOUNT");
    const block = await rpc("eth_blockNumber") as Hex;
    if (!/^0x[0-9a-f]+$/i.test(block) || !Number.isSafeInteger(Number(BigInt(block)))) fail("INVALID_BLOCK");
    const getHeader = async () => {
      const h = await rpc("eth_getBlockByNumber", [block, false]) as { number: string; hash: string; timestamp: string; l1BlockNumber?: string };
      if (!h || h.number !== block || !/^0x[0-9a-f]{64}$/i.test(h.hash)) fail("INVALID_BLOCK");
      return h;
    };
    const h = await getHeader();
    const blockTimestamp = new Date(Number(BigInt(h.timestamp)) * 1000).toISOString();
    if (clock() - Date.parse(blockTimestamp) < 0 || clock() - Date.parse(blockTimestamp) > config.QUOTE_MAX_AGE_MS) fail("QUOTE_STALE");
    async function read(to: string, functionName: typeof V4_ABI[number]["name"], args?: readonly unknown[]): Promise<unknown> {
      const data = encodeFunctionData({ abi: V4_ABI, functionName, args } as Parameters<typeof encodeFunctionData>[0]);
      const raw = await rpc("eth_call", [{ to, data }, block]) as Hex;
      return decodeFunctionResult({ abi: V4_ABI, functionName, data: raw });
    }
    const [record, manager, hooks, decimals] = await Promise.all([
      read(PONS_FACTORY, "getLaunchedToken", [launch.token]), read(PONS_FACTORY, "poolManager"),
      read(PONS_FACTORY, "memeHook"), read(launch.token, "decimals")
    ]);
    const r = record as { exists: boolean; token: string; curve: string; pairToken: Hex; phase: number; poolFee: number; tickSpacing: number };
    if (!r.exists || r.token.toLowerCase() !== launch.token.toLowerCase() || r.curve.toLowerCase() !== launch.curve.toLowerCase()) fail("V4_LAUNCH_IDENTITY_MISMATCH");
    if (r.phase !== 2) fail("V4_POOL_NOT_CREATED");
    // Current Pons native-ETH launches. Other quote currencies require a separately validated multi-hop route.
    if (r.pairToken.toLowerCase() !== ZERO) fail("V4_UNSUPPORTED_QUOTE_CURRENCY");
    if (String(manager).toLowerCase() !== V4.manager || typeof hooks !== "string" || hooks === ZERO) fail("V4_INFRASTRUCTURE_MISMATCH");
    const [hookManager, hookFactory, quoterManager, viewManager] = await Promise.all([
      read(String(hooks), "poolManager"), read(String(hooks), "factory"), read(V4.quoter, "poolManager"), read(V4.stateView, "poolManager")
    ]);
    if ([hookManager, quoterManager, viewManager].some(v => String(v).toLowerCase() !== V4.manager) || String(hookFactory).toLowerCase() !== PONS_FACTORY) fail("V4_INFRASTRUCTURE_MISMATCH");
    if (typeof decimals !== "number" || decimals > 36 || (order.tokenDecimals !== undefined && decimals !== order.tokenDecimals)) fail("TOKEN_DECIMALS_MISMATCH");
    const quantity = Number(formatUnits(BigInt(order.tokenUnits), decimals as number));
    if (!(quantity > 0) || !Number.isFinite(order.quantity) || Math.abs(quantity - order.quantity) > quantity * 1e-10) fail("TOKEN_QUANTITY_MISMATCH");
    const key: V4Route["key"] = { currency0: r.pairToken, currency1: launch.token as Hex, fee: r.poolFee, tickSpacing: r.tickSpacing, hooks: hooks as Hex };
    const pool = v4PoolId(key);
    const [slot, liquidity, tvl, quoted, rate] = await Promise.all([
      read(V4.stateView, "getSlot0", [pool]), read(V4.stateView, "getLiquidity", [pool]),
      read(V4.reservesLens, "getPoolTVL", [V4.manager, key]),
      read(V4.quoter, "quoteExactInputSingle", [{ poolKey: key, zeroForOne: false, exactAmount: BigInt(order.tokenUnits), hookData: "0x" }]), usd()
    ]);
    const [amountOut, gasEstimate] = quoted as readonly [bigint, bigint];
    const principal = tvl as { coreAmount0: bigint; blockNumber: bigint; activeLiquidity: bigint; sqrtPriceX96: bigint; tick: number };
    if ((slot as readonly [bigint, number, number, number])[0] <= 0n || typeof liquidity !== "bigint" || liquidity <= 0n) fail("V4_POOL_INACTIVE");
    // Arbitrum's Solidity block.number is the L1 block. RPC's block.number is L2.
    // All reads are pinned to the same L2 snapshot; compare the lens with its L1 header field.
    if (principal.activeLiquidity !== liquidity || principal.sqrtPriceX96 !== (slot as readonly [bigint, number, number, number])[0] ||
        principal.tick !== (slot as readonly [bigint, number, number, number])[1] || principal.blockNumber !== BigInt(h.l1BlockNumber ?? block))
      fail(`V4_POOL_STATE_MISMATCH: lensBlock=${principal.blockNumber}; expectedBlock=${h.l1BlockNumber ?? block}`);
    if (amountOut <= 0n || principal.coreAmount0 < amountOut) fail("V4_INSUFFICIENT_EXIT_LIQUIDITY");
    if (!(rate.bid > 0) || rate.ask < rate.bid || rate.ask / rate.bid > 1.05 || !rate.source) fail("ETH_USD_UNAVAILABLE");
    if ((await getHeader()).hash !== h.hash) fail("QUOTE_BLOCK_REORG");
    const notionalUsd = Number(formatUnits(amountOut, 18)) * rate.bid;
    const route: V4Route = { market: "UNISWAP_V4", pool, key, manager: V4.manager, quoter: V4.quoter, router: V4.router };
    const quote: PaperQuote = { tokenAddress: launch.token, side: "SELL", timestamp: new Date(clock()).toISOString(), blockTimestamp,
      blockNumber: Number(BigInt(block)), source: "UNISWAP_V4", quoteMethod: "PINNED_V4_QUOTER_EXACT_INPUT_SINGLE", graduationState: "POOL",
      tokenUnits: order.tokenUnits, quantity, notionalUsd, fillPriceUsd: notionalUsd / quantity, rawPriceUsd: notionalUsd / quantity,
      liquidityUsd: Number(formatUnits(principal.coreAmount0, 18)) * rate.bid,
      humanAmountIn: formatUnits(BigInt(order.tokenUnits), decimals as number), humanAmountOut: formatUnits(amountOut, 18), quoteAssetDecimals: 18,
      costs: { feesUsd: null, gasUsd: null, slippageUsd: null, priceImpactPercent: null },
      v4: { route, chainId: ROBINHOOD_CHAIN_ID, blockHash: h.hash, tokenDecimals: decimals as number, amountIn: order.tokenUnits,
        amountOut: amountOut.toString(), ethUsd: rate.bid, usdTimestamp: rate.timestamp, usdSource: rate.source,
        activeLiquidity: String(liquidity), quotePrincipalWei: principal.coreAmount0.toString(), gasEstimate: gasEstimate.toString() } };
    const problem = quoteProblem(quote, clock(), config.QUOTE_MAX_AGE_MS, config.ETH_USD_MAX_AGE_MS);
    return problem ? { status: "NOT_PAPER_TRADABLE", reason: problem, details: [] } : { status: "AVAILABLE", quote };
  } catch (error) {
    return { status: "NOT_PAPER_TRADABLE", reason: "V4_QUOTE_UNAVAILABLE", details: [String(error).slice(0, 500)] };
  }
}

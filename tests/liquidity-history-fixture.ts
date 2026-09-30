// Explicit synthetic multi-block history for older tests whose subject is not the liquidity gate.
// Liquidity-trap tests call production entry functions directly instead of these wrappers.
import * as paper from "../src/paper.js";
import { sellObservation } from "../src/paper-liquidity.js";
export function seedLiquidityHistory(state: paper.PaperState, candidate: paper.Candidate, quote: paper.PaperQuote): void {
  // Older policy tests exercise their original 2%-sizing scenarios with an explicit 4% exit cap.
  // New safety tests retain the production 1% / 100x defaults.
  state.config.MIN_EXIT_COVERAGE_RATIO = 25; state.config.MAX_EXIT_PARTICIPATION_BPS = 400;
  const sell = quote.roundTrip?.sell;
  if (!sell || paper.quoteProblem(quote, Date.parse(quote.timestamp), state.config.QUOTE_MAX_AGE_MS, state.config.ETH_USD_MAX_AGE_MS)) return;
  const o = sellObservation(sell, quote.notionalUsd);
  if (!o) return;
  state.liquidityHistory ??= {};
  state.liquidityHistory[candidate.launchId] = [2, 1, 0].map(i => ({ ...o, block: o.block - i,
    timestamp: new Date(Date.parse(o.timestamp) - i * 15000).toISOString(),
    realQuoteReserveWei: String(BigInt(o.realQuoteReserveWei)*BigInt(100-i*5)/100n),
    quoteReserveWei: String(BigInt(o.quoteReserveWei)-BigInt(o.realQuoteReserveWei)+BigInt(o.realQuoteReserveWei)*BigInt(100-i*5)/100n),
    tokenReserveRaw: String(BigInt(o.tokenReserveRaw)*BigInt(100+i*5)/100n) }));
}
export function seedTractionHistory(state: paper.PaperState, candidate: paper.Candidate): void {
  if (state.tractionHistory?.[candidate.launchId]?.length) return;
  const market = candidate.launch?.market, block = candidate.currentBlock, timestamp = candidate.currentTimestamp;
  if (!market || market.status !== "VERIFIED" || block === null || timestamp === null) return;
  const reserve = BigInt(market.realQuoteReserve), progress = market.progressBps;
  state.tractionHistory ??= {};
  state.tractionHistory[candidate.launchId] = [2, 1].map(i => ({ token: candidate.tokenAddress, symbol: candidate.symbol,
    sourceEventId: candidate.sourceEventId ?? candidate.launchId, block: block - i,
    blockHash: `0x${String(block - i).padStart(64, "0")}`,
    timestamp: new Date((timestamp - i * 15) * 1000).toISOString(), reserve: String(reserve * BigInt(100 - i * 5) / 100n),
    previousReserve: String(reserve * BigInt(95 - i * 5) / 100n), reserveDelta: String(reserve / 20n), reserveDeltaPct: null,
    curveProgressBps: progress - i, previousCurveProgressBps: progress - i - 1, curveProgressDeltaBps: 1,
    verificationStatus: "VERIFIED", quoteStatus: "AVAILABLE" }));
}
// Explicit positive-flow fixture for entry-quality tests; no production signal bypass.
export function seedEntryQuality(state: paper.PaperState, candidate: paper.Candidate, quote?: paper.PaperQuote): void {
  if (candidate.tractionDiagnostics?.observations.length) return;
  const e = quote?.evidence, market = candidate.launch?.market;
  const reserve = BigInt(e?.realQuoteReserve ?? (market?.status === "VERIFIED" ? market.realQuoteReserve : "1000000000000000000"));
  const block = candidate.currentBlock ?? 2, time = candidate.currentTimestamp ?? Date.now()/1000;
  const rows: paper.TractionObservation[] = [2,1,0].map(i => ({ token: candidate.tokenAddress, symbol: candidate.symbol,
    sourceEventId: candidate.sourceEventId ?? candidate.launchId, block: block-i, blockHash: `0x${"b".repeat(64)}`,
    timestamp: new Date((time-i*15)*1000).toISOString(), reserve: String(reserve * BigInt(100-i*5)/100n),
    previousReserve: null, reserveDelta: null, reserveDeltaPct: null, curveProgressBps: 1000-i*10,
    previousCurveProgressBps: null, curveProgressDeltaBps: null, verificationStatus: "VERIFIED", quoteStatus: "AVAILABLE" }));
  candidate.tractionDiagnostics = { observationCount: 3, verifiedObservationCount: 3, observations: rows,
    tractionWindowSeconds: state.config.TRACTION_WINDOW_SECONDS, positiveReserveChangeDetected: true,
    positiveCurveChangeDetected: true, tractionPass: true, exactFailureReason: null };
}
export const enterPaper: typeof paper.enterPaper = (state, candidate, size, now, plan) => {
  if (candidate.quote.status === "AVAILABLE") { seedLiquidityHistory(state, candidate, candidate.quote.quote); seedEntryQuality(state, candidate, candidate.quote.quote); }
  return paper.enterPaper(state, candidate, size, now, plan);
};
export const preparePaperTrade: typeof paper.preparePaperTrade = (state, candidate, quotes, clock) => {
  seedEntryQuality(state, candidate);
  return paper.preparePaperTrade(state, candidate, async (launch, size) => {
    const q = await quotes(launch, size);
    if (q.status === "AVAILABLE") {
      seedLiquidityHistory(state, candidate, q.quote);
      // Quote-backed depth is the synthetic fixture's current depth.
      delete candidate.tractionDiagnostics;
      seedEntryQuality(state, candidate, q.quote);
    }
    return q;
  }, clock);
};
export const observeSnapshot: typeof paper.observeSnapshot = (state, snapshot, now, quotes, clock) => {
  for (const launch of snapshot.launches) seedTractionHistory(state, paper.liveCandidate(launch));
  return paper.observeSnapshot(state, snapshot, now, quotes ? async (launch, size) => {
    const q = await quotes(launch, size);
    if (q.status === "AVAILABLE") seedLiquidityHistory(state, paper.liveCandidate(launch), q.quote);
    return q;
  } : undefined, clock);
};

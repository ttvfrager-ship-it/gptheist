import type { Candidate, PaperQuote, PaperState, TractionObservation } from "./paper.js";

/** Versioned experimental paper policy; historical diagnostics inform rules, live cohorts validate them. */
export const PAPER_STRATEGY_V2 = Object.freeze({
  version: 2, targetWinRatePercent: 50, minimumValidationTrades: 30,
  maxRoundTripLossPercent: 5, maxTokenExposurePercent: .5, lossStreakLimit: 3, lossStreakPauseMs: 900_000, minReserveGrowthPercent: 2,
  minLatestReserveGrowthPercent: .5, minPositiveStepRatio: .6,
  maxReserveDrawdownPercent: 5, confirmationSamples: 3, recentSamples: 5,
  profitFloorPercent: 1, stagnationMs: 120_000, maxHoldMs: 600_000
});
export interface EntryQuality {
  passed: boolean; reason: string | null; samples: number;
  reserveGrowthPercent: number | null; latestReserveGrowthPercent: number | null;
  positiveStepRatio: number | null; reserveDrawdownPercent: number | null;
  roundTripLossPercent: number | null;
}
export function entryQuality(candidate: Candidate, quote?: PaperQuote, now = Date.now()): EntryQuality {
  const policy = PAPER_STRATEGY;
  const rows = (candidate.tractionDiagnostics?.observations ?? []).slice(-policy.recentSamples);
  const result: EntryQuality = { passed: false, reason: null, samples: rows.length, reserveGrowthPercent: null,
    latestReserveGrowthPercent: null, positiveStepRatio: null, reserveDrawdownPercent: null,
    roundTripLossPercent: quote?.roundTrip ? (1 - quote.roundTrip.sell.notionalUsd / quote.notionalUsd) * 100 : null };
  const reject = (reason: string) => ({ ...result, reason });
  if (rows.length < policy.confirmationSamples) return reject("ENTRY_CONFIRMATION_INSUFFICIENT");
  const valid = (r: TractionObservation) => r.verificationStatus === "VERIFIED" && /^[1-9][0-9]*$/.test(r.reserve ?? "") &&
    Number.isFinite(Date.parse(r.timestamp)) && Date.parse(r.timestamp) <= now &&
    now - Date.parse(r.timestamp) <= candidate.tractionDiagnostics!.tractionWindowSeconds * 1000 &&
    Number.isSafeInteger(r.block) && r.block >= 0 && r.token.toLowerCase() === candidate.tokenAddress.toLowerCase();
  if (rows.some((r,i) => !valid(r) || (i > 0 && (r.block <= rows[i-1]!.block || Date.parse(r.timestamp) <= Date.parse(rows[i-1]!.timestamp)))))
    return reject("ENTRY_CONFIRMATION_INVALID");
  const reserves = rows.map(r => BigInt(r.reserve!)), first = reserves[0]!, last = reserves.at(-1)!, previous = reserves.at(-2)!;
  const ratio = (a: bigint, b: bigint) => Number(a) / Number(b) * 100;
  result.reserveGrowthPercent = ratio(last - first, first);
  result.latestReserveGrowthPercent = ratio(last - previous, previous);
  result.positiveStepRatio = reserves.slice(1).filter((r,i)=>r > reserves[i]!).length / (reserves.length - 1);
  const peak = reserves.reduce((a,b)=>a>b?a:b);
  result.reserveDrawdownPercent = ratio(peak - last, peak);
  if (result.latestReserveGrowthPercent < policy.minLatestReserveGrowthPercent ||
      result.reserveGrowthPercent < policy.minReserveGrowthPercent || result.positiveStepRatio < policy.minPositiveStepRatio ||
      result.reserveDrawdownPercent > policy.maxReserveDrawdownPercent) return reject("ENTRY_MOMENTUM_WEAK");
  if (quote) {
    const loss = result.roundTripLossPercent;
    if (loss === null || !Number.isFinite(loss)) return reject("EXIT_QUOTE_UNAVAILABLE");
    if (loss > policy.maxRoundTripLossPercent) return reject("ENTRY_FRICTION_TOO_HIGH");
    // A large apparent instant profit usually means the buy and sell snapshots moved apart.
    if (loss < -1) return reject("ENTRY_PRICE_MOVED");
    if (quote.evidence && BigInt(quote.evidence.realQuoteReserve) < last * 95n / 100n) return reject("ENTRY_SIGNAL_REVERSED");
  }
  return { ...result, passed: true };
}


export function entryRegimeRejection(state: PaperState, now: number): string | null {
  const recent = state.trades.filter(t=>t.plan.strategyVersion===PAPER_STRATEGY.version && Date.parse(t.exitedAt)<=now)
    .sort((a,b)=>Date.parse(a.exitedAt)-Date.parse(b.exitedAt)).slice(-PAPER_STRATEGY.lossStreakLimit);
  if (recent.length===PAPER_STRATEGY.lossStreakLimit && recent.every(t=>t.pnlUsd<0) &&
      now-Date.parse(recent.at(-1)!.exitedAt)<PAPER_STRATEGY.lossStreakPauseMs) return "STRATEGY_LOSS_STREAK_PAUSE";
  return null;
}

/** V3 prefers curves backed by majority real ETH and quote-backed momentum above friction. */
export const PAPER_STRATEGY_V3 = Object.freeze({ ...PAPER_STRATEGY_V2, version: 3,
  minRealReserveShareBps: 5000, minQuoteMomentumSpanMs: 10_000, maxQuoteMomentumSpanMs: 90_000, quoteMomentumCostMultiple: 1.5 });
export const PAPER_STRATEGY = PAPER_STRATEGY_V3;
export interface EntryExecutionQuality {
  passed: boolean; reason: string | null; realReserveSharePercent: number | null;
  quoteMomentumPercent: number | null; requiredMomentumPercent: number | null; confirmationSpanMs: number | null;
}
export function entryExecutionQuality(quote: PaperQuote, history: import("./paper-liquidity.js").LiquidityObservation[], now: number): EntryExecutionQuality {
  const policy = PAPER_STRATEGY;
  const result: EntryExecutionQuality = { passed: false, reason: null, realReserveSharePercent: null,
    quoteMomentumPercent: null, requiredMomentumPercent: null, confirmationSpanMs: null };
  const reject = (reason: string) => ({ ...result, reason });
  try {
    const current = quote.roundTrip?.sell.evidence, sell = quote.roundTrip?.sell;
    if (!current || !sell || !quote.evidence || !quote.tokenUnits) return reject("ENTRY_EXECUTION_EVIDENCE_MISSING");
    if (quote.side !== "BUY" || sell.side !== "SELL" || sell.tokenUnits !== quote.tokenUnits || sell.tokenAddress.toLowerCase() !== quote.tokenAddress.toLowerCase() ||
        !Number.isFinite(quote.notionalUsd) || quote.notionalUsd <= 0 || !Number.isFinite(sell.notionalUsd) || sell.notionalUsd <= 0)
      return reject("ENTRY_EXECUTION_EVIDENCE_INVALID");
    const qr = BigInt(current.quoteReserve), tr = BigInt(current.tokenReserve), real = BigInt(current.realQuoteReserve);
    if (qr <= 0n || tr <= 0n || real <= 0n || real > qr) return reject("ENTRY_EXECUTION_EVIDENCE_INVALID");
    result.realReserveSharePercent = Number(real) / Number(qr) * 100;
    if (real * 10000n < qr * BigInt(policy.minRealReserveShareBps)) return reject("ENTRY_VIRTUAL_RESERVE_DOMINATED");
    const quoteTime = Date.parse(sell.blockTimestamp);
    if (!Number.isFinite(quoteTime) || quoteTime > now) return reject("ENTRY_EXECUTION_EVIDENCE_INVALID");
    const rows = history.filter(o=>o.token.toLowerCase()===quote.tokenAddress.toLowerCase() && o.curve.toLowerCase()===current.curve.toLowerCase() &&
      o.sellResult==="AVAILABLE" && Number.isSafeInteger(o.block) && o.block>=0 && /^0x[0-9a-f]{64}$/i.test(o.blockHash) && o.block<sell.blockNumber &&
      quoteTime-Date.parse(o.timestamp)>=policy.minQuoteMomentumSpanMs && quoteTime-Date.parse(o.timestamp)<=policy.maxQuoteMomentumSpanMs)
      .sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
    const prior = rows.at(-1);
    if (!prior) return reject("ENTRY_QUOTE_MOMENTUM_UNCONFIRMED");
    const beforeQr = BigInt(prior.quoteReserveWei), beforeTr = BigInt(prior.tokenReserveRaw);
    if (beforeQr<=0n || beforeTr<=0n) return reject("ENTRY_EXECUTION_EVIDENCE_INVALID");
    // Both are pinned ETH/token reserve ratios; USD conversion cannot create apparent token momentum.
    result.quoteMomentumPercent = (Number(qr * beforeTr) / Number(beforeQr * tr) - 1) * 100;
    result.confirmationSpanMs = quoteTime-Date.parse(prior.timestamp);
    const loss = (1-sell.notionalUsd/quote.notionalUsd)*100;
    result.requiredMomentumPercent = Math.max(1, Math.max(0,loss)*policy.quoteMomentumCostMultiple);
    if (!Number.isFinite(result.quoteMomentumPercent) || !Number.isFinite(result.requiredMomentumPercent)) return reject("ENTRY_EXECUTION_EVIDENCE_INVALID");
    if (result.quoteMomentumPercent<result.requiredMomentumPercent) return reject("ENTRY_MOMENTUM_BELOW_COST");
    return { ...result, passed: true };
  } catch { return reject("ENTRY_EXECUTION_EVIDENCE_INVALID"); }
}

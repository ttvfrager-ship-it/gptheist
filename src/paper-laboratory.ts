import { accountSummary, initialPaperState, monitorPaper, observeSnapshot, performance, type PaperState, type QuoteResult } from "./paper.js";
import type { LiveSnapshot } from "./live.js";
import { researchMetrics } from "./paper-research.js";

export const SHADOW_STRATEGIES = ["CONTROL", "SELECTIVE", "FAST_FAILURE", "RUNNER"] as const;
export type ShadowStrategy = typeof SHADOW_STRATEGIES[number];
export interface PaperMarketFrame {
  sequence: number; completedAt: string; snapshot: LiveSnapshot;
  buys: { token: string; sizeUsd: number; result: QuoteResult }[];
  sells: { token: string; tokenUnits: string; result: QuoteResult }[];
}
export interface LaboratoryState {
  version: 1; sequence: number; completedAt: string | null;
  portfolios: Record<ShadowStrategy, PaperState>;
  positiveObservations: Record<string, { count: number; block: number }>;
}
/** Offline, chronological paper experiment. No network, no generated quotes, no primary-account writes.
 * Strategies can consume only the exact sizes captured in the common frame. Missing sizes reject.
 * Each strategy gets an independent cursor over the SAME quote tape, including distinct final exit reads.
 */
export class PaperStrategyLaboratory {
  readonly state: LaboratoryState;
  constructor(now: number, saved?: LaboratoryState) {
    this.state = saved ? structuredClone(saved) : { version: 1, sequence: -1, completedAt: null,
      portfolios: Object.fromEntries(SHADOW_STRATEGIES.map(name => [name, initialPaperState(now)])) as Record<ShadowStrategy, PaperState>,
      positiveObservations: {} };
  }
  async consume(frame: PaperMarketFrame): Promise<void> {
    const now = Date.parse(frame.completedAt);
    if (!Number.isFinite(now) || frame.sequence <= this.state.sequence ||
        (this.state.completedAt && now < Date.parse(this.state.completedAt)) || Date.parse(frame.snapshot.fetchedAt) > now) throw new Error("NON_CHRONOLOGICAL_FRAME");
    for (const item of [...frame.buys, ...frame.sells]) if (item.result.status === "AVAILABLE") {
      const q = item.result.quote;
      if (Date.parse(q.timestamp) > now || Date.parse(q.blockTimestamp) > now ||
          (q.roundTrip && Date.parse(q.roundTrip.sell.timestamp) > now)) throw new Error("FUTURE_QUOTE");
    }
    const draft = structuredClone(this.state);
    for (const launch of frame.snapshot.launches) {
      const traction = launch.chronology?.recentTraction;
      const prior = draft.positiveObservations[launch.token];
      if (prior && prior.block >= frame.snapshot.headBlock) continue;
      const positive = traction?.status === "VERIFIED" && (traction.progressChangeBps ?? 0) > 0 && /^[1-9][0-9]*$/.test(traction.reserveChangeWei ?? "");
      draft.positiveObservations[launch.token] = { count: positive ? (prior?.count ?? 0) + 1 : 0, block: frame.snapshot.headBlock };
    }
    const missing = (reason: string): QuoteResult => ({ status: "NOT_PAPER_TRADABLE", reason, details: ["Exact chronological quote was not captured; no interpolation or future lookup"] });
    for (const name of SHADOW_STRATEGIES) {
      const state = draft.portfolios[name], sells = [...frame.sells], buys = [...frame.buys];
      await monitorPaper(state, async p => {
        const index = sells.findIndex(q => q.token === p.tokenAddress && q.tokenUnits === p.entry.tokenUnits);
        return index < 0 ? missing("SHADOW_EXIT_QUOTE_UNAVAILABLE") : structuredClone(sells.splice(index, 1)[0]!.result);
      }, () => now);
      const existing = new Set(state.positions.map(p => p.id));
      await observeSnapshot(state, structuredClone(frame.snapshot), now, async (launch, sizeUsd) => {
        if (name !== "CONTROL" && (draft.positiveObservations[launch.token]?.count ?? 0) < 2) return missing("INSUFFICIENT_TRACTION");
        const index = buys.findIndex(q => q.token === launch.token && Math.abs(q.sizeUsd - sizeUsd) < 1e-8);
        return index >= 0 ? structuredClone(buys.splice(index, 1)[0]!.result) : missing("SHADOW_SIZED_QUOTE_UNAVAILABLE");
      }, () => now);
      for (const p of state.positions.filter(p => !existing.has(p.id))) {
        // Fixed experimental definitions, never fitted to observed P&L; primary policy is untouched.
        if (name === "FAST_FAILURE") { p.plan.exitPolicy.reserveDropPercent /= 2; p.plan.exitPolicy.maxHoldMs /= 2; }
        if (name === "RUNNER") p.plan.exitPolicy.trailingDrawdownPercent *= 1.5;
        p.plan.reasoning.push(`Shadow ${name} v1; shared chronological evidence; missing sized quotes reject`);
      }
    }
    draft.sequence = frame.sequence; draft.completedAt = frame.completedAt;
    Object.assign(this.state, draft);
  }
  metrics() {
    return Object.fromEntries(SHADOW_STRATEGIES.map(name => [name,
      { account: accountSummary(this.state.portfolios[name]), ...performance(this.state.portfolios[name]), ...researchMetrics(this.state.portfolios[name]) }]));
  }
}

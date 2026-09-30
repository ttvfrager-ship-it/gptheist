import { accountCapacity } from "./paper-policy.js";
import { researchMetrics } from "./paper-research.js";
import { accountSummary, activity, monitorPaper, observeSnapshot, performance, quoteProblem, enterPaper } from "./paper.js";
import type { EntryQuoteProvider, QuoteProvider } from "./paper.js";
import { PaperStore } from "./paper-store.js";
import type { PaperQuoteService } from "./paper-quotes.js";
import { refreshLiveLaunchAtHead, type LiveSnapshot } from "./live.js";

export class PaperService {
  readonly startedAt = Date.now();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;
  private monitorTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly retryAfter = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly sellTape: { token: string; tokenUnits: string; result: import("./paper.js").QuoteResult }[] = [];
  private lastMonitorAt: string | null = null;
  private monitorError: string | null = null;
  private stopped = false;
  private error: string | null = null;
  private lastSuccess: string | null = null;
  constructor(readonly store: PaperStore, private readonly snapshot: () => Promise<LiveSnapshot>, private readonly quotes: QuoteProvider,
    private readonly entryQuotes?: EntryQuoteProvider, private readonly sources?: Pick<PaperQuoteService, "status" | "refreshUsd">, private readonly retryClock = Date.now,
    private readonly rpc?: import("./live.js").RpcCaller) {}
  start(): void { void this.monitor(); void this.tick(); }
  async monitor(): Promise<void> {
    if (this.stopped) return;
    clearTimeout(this.monitorTimer);
    this.monitorTimer = setTimeout(() => { void this.monitor(); }, this.store.read().config.PAPER_QUOTE_REFRESH_MS);
    this.monitorTimer.unref();
    const base = this.store.read();
    const jobs = base.positions.map(position => {
      if ((this.retryAfter.get(position.id) ?? 0) > this.retryClock()) return Promise.resolve();
      const pending = this.inFlight.get(position.id);
      if (pending) return pending;
      const job = (async () => {
      const cash = base.cash;
      const draft = { ...base, positions: [position], events: [], trades: [], history: [], decisions: [] };
      await monitorPaper(draft, async p => {
        const result = await this.quotes(p);
        if (this.sellTape.length >= 1000) this.sellTape.shift(); // Every quote also persists in the append-only event archive.
        this.sellTape.push({ token: p.tokenAddress, tokenUnits: p.entry.tokenUnits ?? "", result: structuredClone(result) });
        return result;
      });
      const updated = draft.positions[0];
      if (updated && ["RPC_RATE_LIMIT", "QUOTE_TIMEOUT", "QUOTE_UNAVAILABLE", "RPC_ERROR", "RPC_TIMEOUT"].includes(updated.markReason ?? "")) {
        this.retryAfter.set(position.id, this.retryClock() + Math.min(60_000, 5_000 * 2 ** Math.min(updated.management.consecutiveQuoteFailures, 4)));
      } else this.retryAfter.delete(position.id);
      await this.store.update(state => {
        const index = state.positions.findIndex(p => p.id === position.id);
        if (index < 0) return;
        if (draft.positions[0]) state.positions[index] = draft.positions[0];
        else state.positions.splice(index, 1);
        state.cash += draft.cash - cash;
        state.trades.push(...draft.trades); state.events.push(...draft.events);
        state.history.push({ timestamp: new Date().toISOString(), equity: accountSummary(state).equity,
          stalePositions: state.positions.filter(p => p.markStatus !== "FRESH").length });
      });
      })().catch(error => { this.monitorError = error instanceof Error ? error.message : "Monitor failed"; })
        .finally(() => { this.inFlight.delete(position.id); });
      this.inFlight.set(position.id, job);
      return job;
    });
    await Promise.all(jobs);
    this.lastMonitorAt = new Date().toISOString();
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      // Price and exit retained positions before potentially slow discovery calls.
      try { await this.monitor(); }
      catch (error) { this.error = error instanceof Error ? error.message : "Paper persistence failed"; return; }
      await this.sources?.refreshUsd();
      let snapshot: LiveSnapshot | undefined;
      try {
        snapshot = await this.snapshot(); this.lastSuccess = snapshot.fetchedAt; this.error = null;
        const state = this.store.read(), present = new Set(snapshot.launches.map(l => `${l.transactionHash}:${l.logIndex}`));
        const retained = Object.entries(state.tractionWatchlist ?? {}).filter(([id, launch]) => !present.has(id) &&
          !state.positions.some(p => p.launchId === id) && !state.trades.some(t => t.launchId === id) && launch.chronology?.eventMode === "LIVE" &&
          launch.chronology.launchTimestamp !== null && Date.now()/1000-launch.chronology.launchTimestamp <= state.config.PAPER_MAX_LAUNCH_AGE_SECONDS);
        if (this.rpc && retained.length) {
          const refreshed = await Promise.all(retained.map(([,launch]) => refreshLiveLaunchAtHead(this.rpc!, launch, snapshot!.headBlock)));
          snapshot = { ...snapshot, launches: [...snapshot.launches, ...refreshed] };
        }
      }
      catch (error) { this.error = error instanceof Error ? error.message.slice(0, 200) : "RPC unavailable"; }
      try {
        // Discovery/entry network work never holds the account lock or blocks monitoring.
        if (snapshot) {
          const draft = this.store.read();
          draft.events = []; draft.decisions = [];
          const buys: { token: string; sizeUsd: number; result: import("./paper.js").QuoteResult }[] = [];
          const entryQuotes = this.entryQuotes;
          await observeSnapshot(draft, snapshot, Date.now(), entryQuotes ? async (launch, sizeUsd) => {
            const result = await entryQuotes(launch, sizeUsd);
            buys.push({ token: launch.token, sizeUsd, result: structuredClone(result) }); return result;
          } : undefined, Date.now);
          activity(draft, "PAPER_LAB_FRAME", "Common chronological research tape; no shadow quote interpolation", Date.now(), undefined,
            { frame: { sequence: Date.now(), completedAt: new Date().toISOString(), snapshot, buys, sells: this.sellTape.splice(0) } });
          await this.store.update(state => {
            state.lastSnapshotAt = draft.lastSnapshotAt;
            state.lastObservedHeadBlock = draft.lastObservedHeadBlock;
            if (draft.liquidityHistory) state.liquidityHistory = draft.liquidityHistory;
            if (draft.tractionHistory) state.tractionHistory = draft.tractionHistory;
            if (draft.tractionWatchlist) state.tractionWatchlist = draft.tractionWatchlist;
            if (draft.researchLedger) {
              state.researchLedger = draft.researchLedger;
              const traded = new Set([...state.positions, ...state.trades].map(p => p.launchId));
              for (const [id, row] of Object.entries(state.researchLedger)) row.traded = traded.has(id);
            }
            state.latestGate = draft.latestGate;
            state.events.push(...draft.events.filter(e => !["PAPER_BUY", "PAPER_ELIGIBLE"].includes(e.eventType)));
            for (const decision of draft.decisions) {
              // Revalidate against current cash/positions and quote age after concurrent exits.
              if (decision.outcome === "PAPER_ELIGIBLE") enterPaper(state, decision.candidate, decision.sizeUsd, Date.now(), decision.plan);
              else state.decisions.push(decision);
            }
          });
        } else await this.store.update(state => { activity(state, "RPC_FAILURE", this.error ?? "RPC unavailable", Date.now()); });
      } catch (error) { this.error = error instanceof Error ? error.message : "Paper persistence failed"; }
    })().finally(() => {
      this.pending = undefined;
      if (!this.stopped) { this.timer = setTimeout(() => { void this.tick(); }, this.store.read().config.MONITOR_INTERVAL_MS); this.timer.unref(); }
    });
    return this.pending;
  }
  view() {
    const state = this.store.read();
    for (const p of state.positions) {
      const problem = quoteProblem(p.current, Date.now(), state.config.QUOTE_MAX_AGE_MS, state.config.ETH_USD_MAX_AGE_MS);
      if (problem) { p.markStatus = "UNAVAILABLE"; p.markReason ??= problem; }
      const successful = p.management.lastSuccessfulQuote;
      Object.assign(p, { accounting: { costBasisUsd: p.costBasisUsd,
        lastSuccessfulExecutableValueUsd: successful ? successful.notionalUsd - (successful.costs.gasUsd ?? 0) : null,
        currentExecutableValueUsd: successful && p.markStatus === "FRESH" ? successful.notionalUsd - (successful.costs.gasUsd ?? 0) : null,
        unrealizedPnlUsd: successful && p.markStatus === "FRESH" ? successful.notionalUsd - (successful.costs.gasUsd ?? 0) - p.costBasisUsd : null,
        unrealizedPnlStatus: successful && p.markStatus === "FRESH" ? "FRESH" : "UNAVAILABLE" },
        market: p.market ?? "PONS_V2_CURVE", quote_source: successful?.source ?? null, quote_status: p.markStatus,
        quoteStatus: successful ? p.markStatus === "FRESH" ? "LIVE" : "STALE" : "UNAVAILABLE",
        lastQuoteAttemptAt: p.lastQuoteAttempt ?? null, lastSuccessfulQuoteAt: successful?.timestamp ?? null,
        quoteBlock: successful?.blockNumber ?? null, currentBlock: p.quoteDiagnostics?.currentBlock ?? null,
        quoteAgeMs: successful ? Date.now() - Date.parse(successful.timestamp) : null,
        consecutiveFailures: p.management.consecutiveQuoteFailures, lastFailureReason: p.markReason });
    }
    return { monitor: { lastCompletedAt: this.lastMonitorAt, running: this.inFlight.size > 0, error: this.monitorError }, quoteHealth: this.sources?.status() ?? null, execution: "SIMULATED", startedAt: new Date(this.startedAt).toISOString(),
      connection: !this.error && this.lastSuccess && Date.now() - Date.parse(this.lastSuccess) <= state.config.QUOTE_MAX_AGE_MS ? "LIVE" : "UNAVAILABLE",
      error: this.error, lastSuccess: this.lastSuccess, account: accountSummary(state), riskCapacity: accountCapacity(state), performance: performance(state), research: researchMetrics(state),
      ...state, events: state.events.slice(-200), decisions: state.decisions.slice(-100), trades: state.trades.slice(-100) };
  }
  setMaxOpenPositions(maxOpenPositions: number): Promise<void> { return this.store.setMaxOpenPositions(maxOpenPositions); }
  async resetAccount(startingBalanceUsd: number): Promise<void> {
    clearTimeout(this.timer);
    await this.pending;
    clearTimeout(this.timer);
    clearTimeout(this.monitorTimer);
    await Promise.all(this.inFlight.values());
    await this.store.reset({ startingBalanceUsd });
    if (!this.stopped) {
      this.timer = setTimeout(() => { void this.tick(); }, this.store.read().config.MONITOR_INTERVAL_MS);
      this.timer.unref();
    }
  }
  async close(): Promise<void> { this.stopped = true; clearTimeout(this.timer); clearTimeout(this.monitorTimer); await this.pending; await Promise.all(this.inFlight.values()); await this.store.close(); }
}

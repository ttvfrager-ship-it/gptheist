import { accountCapacity } from "./paper-policy.js";
import { getPaperStrategy } from "./paper-strategy.js";
import { researchMetrics } from "./paper-research.js";
import { accountSummary, activity, monitorPaper, observeSnapshot, performance, quoteProblem, enterPaper } from "./paper.js";
import type { EntryQuoteProvider, QuoteProvider } from "./paper.js";
import { PaperStore } from "./paper-store.js";
import type { PaperQuoteService } from "./paper-quotes.js";
import { refreshLiveLaunchesAtHead, type LiveSnapshot } from "./live.js";

export interface PaperServiceOptions {
  discoveryIntervalMs?: number | undefined;
  log?: ((message: string) => void) | undefined;
}

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
  private lastCycleMs: number | null = null;
  constructor(readonly store: PaperStore, private readonly snapshot: () => Promise<LiveSnapshot>, private readonly quotes: QuoteProvider,
    private readonly entryQuotes?: EntryQuoteProvider, private readonly sources?: Pick<PaperQuoteService, "status" | "refreshUsd">, private readonly retryClock = Date.now,
    private readonly rpc?: import("./live.js").RpcCaller, private readonly options: PaperServiceOptions = {}) {
    const interval = options.discoveryIntervalMs ?? 4000;
    if (!Number.isFinite(interval) || interval < 1000) throw new Error("PAPER_DISCOVERY_INTERVAL_MS must be at least 1000");
  }
  private report(message: string): void {
    try { this.options.log?.(message); } catch { /* Logging must not interrupt account updates. */ }
  }
  private reportEvents(events: import("./paper.js").ActivityEvent[]): void {
    for (const event of events) {
      if (event.category === "RESEARCH" || event.eventType === "PAPER_LAB_FRAME") continue;
      const numbers = ["sizeUsd", "pnlUsd", "returnPercent"].filter(key => typeof event.metadata[key] === "number")
        .map(key => `${key}=${Number(event.metadata[key]).toFixed(2)}`).join(" ");
      this.report(`[${event.timestamp}] ${event.eventType} ${event.tokenSymbol ?? event.tokenAddress ?? ""} ${event.message}${numbers ? " " + numbers : ""}`);
    }
  }
  start(): void {
    const config = this.store.read().config, policy = getPaperStrategy(config);
    this.report(`PAPER started: ${policy.version === 4 ? "SCALP" : "STRICT"} v${policy.version}; simulated trades; discovery every ${this.options.discoveryIntervalMs ?? 4000}ms; exit quotes every ${config.PAPER_QUOTE_REFRESH_MS}ms`);
    void this.tick();
  }
  async monitor(): Promise<void> {
    if (this.stopped) return;
    clearTimeout(this.monitorTimer);
    const base = this.store.read();
    this.monitorTimer = setTimeout(() => { void this.monitor(); }, base.config.PAPER_QUOTE_REFRESH_MS);
    this.monitorTimer.unref();
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
      this.reportEvents(draft.events);
      })().catch(error => { this.monitorError = error instanceof Error ? error.message : "Monitor failed"; this.report("PAPER monitor error: " + this.monitorError); })
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
    const cycleStartedAt = Date.now();
    const monitoring = this.monitor();
    this.pending = (async () => {
      // Discovery and retained-position exits run independently.
      void this.sources?.refreshUsd().catch(error => this.report("PAPER USD refresh error: " + String(error)));
      let snapshot: LiveSnapshot | undefined;
      try {
        snapshot = await this.snapshot(); this.lastSuccess = snapshot.fetchedAt; this.error = null;
        const state = this.store.read();
        if (snapshot.fetchedAt === state.lastSnapshotAt) return;
        const present = new Set(snapshot.launches.map(l => `${l.transactionHash}:${l.logIndex}`));
        const retained = Object.entries(state.tractionWatchlist ?? {}).filter(([id, launch]) => !present.has(id) &&
          !state.positions.some(p => p.launchId === id) && !state.trades.some(t => t.launchId === id) && launch.chronology?.eventMode === "LIVE" &&
          launch.chronology.launchTimestamp !== null && Date.now()/1000-launch.chronology.launchTimestamp <= state.config.PAPER_MAX_LAUNCH_AGE_SECONDS);
        if (this.rpc && retained.length) {
          const refreshed = await refreshLiveLaunchesAtHead(this.rpc, retained.map(([, launch]) => launch), snapshot.headBlock);
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
          const committedEvents: import("./paper.js").ActivityEvent[] = [];
          await this.store.update(state => {
            const eventStart = state.events.length;
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
            committedEvents.push(...state.events.slice(eventStart));
          });
          this.reportEvents(committedEvents);
          this.report(`PAPER scan: block ${snapshot.headBlock}, ${snapshot.launches.length} launches, ${this.store.read().positions.length} open positions, ${Date.now() - cycleStartedAt}ms`);
        } else await this.store.update(state => { activity(state, "RPC_FAILURE", this.error ?? "RPC unavailable", Date.now()); });
      } catch (error) { this.error = error instanceof Error ? error.message : "Paper persistence failed"; }
    })().finally(async () => {
      await monitoring;
      this.lastCycleMs = Date.now() - cycleStartedAt;
      if (this.error) this.report("PAPER error: " + this.error);
      this.pending = undefined;
      if (!this.stopped) { this.timer = setTimeout(() => { void this.tick(); }, Math.max(0, (this.options.discoveryIntervalMs ?? 4000) - (Date.now() - cycleStartedAt))); this.timer.unref(); }
    });
    return this.pending;
  }
  view() {
    const state = this.store.read();
    const latestDecisions = new Map<string, typeof state.decisions[number]>();
    for (const decision of state.decisions) if (decision.candidate.currentBlock === state.lastObservedHeadBlock)
      latestDecisions.set(decision.candidate.launchId, decision);
    const live = [...latestDecisions.values()].filter(d => d.candidate.eventMode === "LIVE" && !state.positions.some(p => p.launchId === d.candidate.launchId) &&
      !state.trades.some(t => t.launchId === d.candidate.launchId) && d.candidate.launchTimestamp !== null &&
      Date.now() / 1000 - d.candidate.launchTimestamp <= state.config.PAPER_MAX_LAUNCH_AGE_SECONDS);
    const blockers = new Map<string, number>();
    for (const d of live) if (d.outcome !== "PAPER_ELIGIBLE") blockers.set(d.reason, (blockers.get(d.reason) ?? 0) + 1);
    const allocationCapUsd = accountCapacity(state).equityUsd * getPaperStrategy(state.config, accountCapacity(state).equityUsd).maxTokenExposurePercent / 100;
    const entryDiagnostics = { allocationCapUsd, minimumTradeUsd: state.config.MIN_POSITION_USD,
      accountSizingBlocked: allocationCapUsd < state.config.MIN_POSITION_USD,
      strategyMode: state.config.PAPER_STRATEGY_VERSION === 4 ? "SCALP" : "STRICT",
      strategyVersion: state.config.PAPER_STRATEGY_VERSION, currentBlock: state.lastObservedHeadBlock, liveCandidates: live.length,
      discoveryIntervalMs: this.options.discoveryIntervalMs ?? 4000, lastCycleMs: this.lastCycleMs, scanning: !!this.pending,
      blockers: [...blockers].map(([reason, count]) => ({ reason, count })).sort((a,b) => b.count - a.count) };
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
    return { entryDiagnostics, monitor: { lastCompletedAt: this.lastMonitorAt, running: this.inFlight.size > 0, error: this.monitorError }, quoteHealth: this.sources?.status() ?? null, execution: "SIMULATED", startedAt: new Date(this.startedAt).toISOString(),
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
      this.timer = setTimeout(() => { void this.tick(); }, this.options.discoveryIntervalMs ?? 4000);
      this.timer.unref();
      void this.monitor();
    }
  }
  async close(): Promise<void> { this.stopped = true; clearTimeout(this.timer); clearTimeout(this.monitorTimer); await this.pending; await Promise.all(this.inFlight.values()); await this.store.close(); }
}

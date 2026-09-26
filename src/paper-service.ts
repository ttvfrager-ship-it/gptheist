import { accountSummary, activity, monitorPaper, observeSnapshot, performance, quoteProblem, enterPaper } from "./paper.js";
import type { EntryQuoteProvider, QuoteProvider } from "./paper.js";
import { PaperStore } from "./paper-store.js";
import type { PaperQuoteService } from "./paper-quotes.js";
import type { LiveSnapshot } from "./live.js";

export class PaperService {
  readonly startedAt = Date.now();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;
  private monitorTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly inFlight = new Map<string, Promise<void>>();
  private lastMonitorAt: string | null = null;
  private monitorError: string | null = null;
  private stopped = false;
  private error: string | null = null;
  private lastSuccess: string | null = null;
  constructor(readonly store: PaperStore, private readonly snapshot: () => Promise<LiveSnapshot>, private readonly quotes: QuoteProvider,
    private readonly entryQuotes?: EntryQuoteProvider, private readonly sources?: Pick<PaperQuoteService, "status" | "refreshUsd">) {}
  start(): void { void this.monitor(); void this.tick(); }
  async monitor(): Promise<void> {
    if (this.stopped) return;
    clearTimeout(this.monitorTimer);
    this.monitorTimer = setTimeout(() => { void this.monitor(); }, this.store.read().config.MONITOR_INTERVAL_MS);
    this.monitorTimer.unref();
    const base = this.store.read();
    const jobs = base.positions.map(position => {
      const pending = this.inFlight.get(position.id);
      if (pending) return pending;
      const job = (async () => {
      const cash = base.cash;
      const draft = { ...base, positions: [position], events: [], trades: [], history: [], decisions: [] };
      await monitorPaper(draft, this.quotes);
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
      try { snapshot = await this.snapshot(); this.lastSuccess = snapshot.fetchedAt; this.error = null; }
      catch (error) { this.error = error instanceof Error ? error.message.slice(0, 200) : "RPC unavailable"; }
      try {
        // Discovery/entry network work never holds the account lock or blocks monitoring.
        if (snapshot) {
          const draft = this.store.read();
          draft.events = []; draft.decisions = [];
          await observeSnapshot(draft, snapshot, Date.now(), this.entryQuotes, Date.now);
          await this.store.update(state => {
            state.lastSnapshotAt = draft.lastSnapshotAt;
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
    }
    return { monitor: { lastCompletedAt: this.lastMonitorAt, running: this.inFlight.size > 0, error: this.monitorError }, quoteHealth: this.sources?.status() ?? null, execution: "SIMULATED", startedAt: new Date(this.startedAt).toISOString(),
      connection: !this.error && this.lastSuccess && Date.now() - Date.parse(this.lastSuccess) <= state.config.QUOTE_MAX_AGE_MS ? "LIVE" : "UNAVAILABLE",
      error: this.error, lastSuccess: this.lastSuccess, account: accountSummary(state), performance: performance(state),
      ...state, events: state.events.slice(-200), decisions: state.decisions.slice(-100), trades: state.trades.slice(-100) };
  }
  async close(): Promise<void> { this.stopped = true; clearTimeout(this.timer); clearTimeout(this.monitorTimer); await this.pending; await Promise.all(this.inFlight.values()); await this.store.close(); }
}

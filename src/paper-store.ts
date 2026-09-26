import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureSafeAuditDirectory } from "./simulation.js";
import { PAPER_CONFIG, accountSummary, initialPaperState, quoteProblem, type PaperState } from "./paper.js";

import { EXIT_REASONS, initialManagement, proposeTradePlan } from "./paper-policy.js";

/** Reject corruption; never silently replace an existing account with a new one. */
export function validatePaperState(value: unknown): asserts value is PaperState {
  const s = value as PaperState;
  const finiteTree = (v: unknown): boolean => typeof v === "number" ? Number.isFinite(v) :
    Array.isArray(v) ? v.every(finiteTree) : v !== null && typeof v === "object" ? Object.values(v).every(finiteTree) : true;
  try {
    if (!s || s.schemaVersion !== 2 || s.mode !== "PAPER" || !finiteTree(s) || !Number.isFinite(Date.parse(s.createdAt))) throw new Error();
    initialPaperState(Date.parse(s.createdAt), s.config);
    if (![s.positions, s.trades, s.history, s.events, s.decisions].every(Array.isArray) || !s.history.length || !Number.isFinite(s.cash) || s.cash < 0) throw new Error();
    const ids = new Set<string>(), tokens = new Set<string>();
    for (const p of [...s.positions, ...s.trades]) {
      if (!p.id || ids.has(p.id) || p.mode !== "PAPER" || p.execution !== "SIMULATED" ||
          !/^0x[0-9a-f]{40}$/i.test(p.tokenAddress) || p.quantity <= 0 || p.sizeUsd <= 0 || p.costBasisUsd <= 0 ||
          ![p.quantity, p.sizeUsd, p.costBasisUsd].every(Number.isFinite) ||
          !p.plan || p.plan.version !== 1 || !Array.isArray(p.plan.riskReasons) || !Array.isArray(p.plan.reasoning) ||
          ![p.plan.riskBudgetUsd, p.plan.approvedSizeUsd, p.plan.exitPolicy.downsidePercent, p.plan.exitPolicy.profitArmPercent,
            p.plan.exitPolicy.trailingDrawdownPercent, p.plan.exitPolicy.maxHoldMs, p.plan.exitPolicy.reserveDropPercent,
            p.plan.exitPolicy.taxIncreaseBps, p.plan.exitPolicy.maxExitImpactPercent, p.plan.exitPolicy.graduationProgressBps].every(v => Number.isFinite(v) && v > 0) ||
          p.plan.exitPolicy.downsidePercent >= 100 || Math.abs(p.plan.approvedSizeUsd - p.sizeUsd) > 1e-8 ||
          !p.management || !Number.isSafeInteger(p.management.quoteFailureCount) || p.management.quoteFailureCount < 0 ||
          (p.management.peakLiquidationValueUsd !== null && (!Number.isFinite(p.management.peakLiquidationValueUsd) || p.management.peakLiquidationValueUsd <= 0)) ||
          !Number.isFinite(Date.parse(p.enteredAt)) || p.entry.side !== "BUY" ||
          quoteProblem(p.entry, Date.parse(p.entry.timestamp), Number.MAX_SAFE_INTEGER) ||
          quoteProblem(p.current, Date.parse(p.current.timestamp), Number.MAX_SAFE_INTEGER) ||
          p.entry.tokenAddress.toLowerCase() !== p.tokenAddress.toLowerCase() || p.current.tokenAddress.toLowerCase() !== p.tokenAddress.toLowerCase() ||
          Math.abs(p.entry.quantity - p.quantity) > p.quantity * 1e-10 ||
          Math.abs(p.costBasisUsd - p.sizeUsd - (p.entry.costs.gasUsd ?? 0)) > 1e-7) throw new Error();
      ids.add(p.id);
    }
    for (const p of s.positions) { const token = p.tokenAddress.toLowerCase(); if (tokens.has(token)) throw new Error(); tokens.add(token); }
    for (const t of s.trades) {
      if (!Number.isFinite(Date.parse(t.exitedAt)) || Date.parse(t.exitedAt) < Date.parse(t.enteredAt) || t.exit.side !== "SELL" ||
          quoteProblem(t.exit, Date.parse(t.exit.timestamp), Number.MAX_SAFE_INTEGER) ||
          ![...EXIT_REASONS, "STOP_LOSS", "TAKE_PROFIT"].includes(t.exitReason) ||
          Math.abs(t.pnlUsd - (t.exit.notionalUsd - (t.exit.costs.gasUsd ?? 0) - t.costBasisUsd)) > 1e-7) throw new Error();
    }
    if (s.history.some(h => !Number.isFinite(Date.parse(h.timestamp)) || h.equity < 0)) throw new Error();
    const a = accountSummary(s);
    if (!finiteTree(a) || Math.abs(a.totalPnl - a.realizedPnl - a.unrealizedPnl) > 1e-6) throw new Error();
  } catch { throw new Error("Invalid paper state; refusing to reset or trade. Restore a valid backup or explicitly reset PAPER data."); }
}
async function readSafe(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { if (!(await handle.stat()).isFile()) throw new Error("Paper storage must be a regular file"); return await handle.readFile("utf8"); }
  finally { await handle.close(); }
}
function code(error: unknown): string | undefined { return error instanceof Error && "code" in error ? String(error.code) : undefined; }
export class PaperStore {
  private tail: Promise<void> = Promise.resolve();
  private constructor(readonly directory: string, private state: PaperState) {}
  static async open(directory: string): Promise<PaperStore> {
    const root = await ensureSafeAuditDirectory(directory), lock = resolve(root, "writer.lock");
    // Exclusive process ownership; stale locks from a terminated process are recoverable.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const h = await open(lock, "wx", 0o600); try { await h.writeFile(String(process.pid)); await h.sync(); } finally { await h.close(); } break; }
      catch (error) {
        if (code(error) !== "EEXIST" || attempt !== 0) throw error;
        const pid = Number(await readSafe(lock));
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid paper lock; inspect writer.lock manually");
        try { process.kill(pid, 0); throw new Error("Paper account already owned by a running process"); }
        catch (probe) { if (code(probe) !== "ESRCH") throw probe; }
        await unlink(lock);
      }
    }
    try {
      let state: PaperState;
      try {
        const text = await readSafe(resolve(root, "state.json"));
        const raw = JSON.parse(text) as { schemaVersion?: number };
        if (raw.schemaVersion === 1) {
          state = migratePaperState(raw);
          validatePaperState(state);
          const backup = await open(resolve(root, `schema-v1-backup-${Date.now()}.json`), "wx", 0o600);
          try { await backup.writeFile(text); await backup.sync(); } finally { await backup.close(); }
        } else { validatePaperState(raw); state = raw; }
      }
      catch (error) { if (code(error) !== "ENOENT") throw error; state = initialPaperState(); }
      const store = new PaperStore(root, state); await store.write(state); return store;
    } catch (error) { await unlink(lock); throw error; }
  }
  read(): PaperState { return structuredClone(this.state); }
  private async write(state: PaperState): Promise<void> {
    // Keep the active account bounded without discarding audit evidence or trade history.
    const oldEvents = Math.max(0, state.events.length - 2000), oldDecisions = Math.max(0, state.decisions.length - 500);
    if (oldEvents || oldDecisions) {
      const archive = await open(resolve(this.directory, `audit-archive-${Date.now()}-${randomUUID()}.json`), "wx", 0o600);
      try {
        await archive.writeFile(JSON.stringify({ events: state.events.slice(0, oldEvents), decisions: state.decisions.slice(0, oldDecisions) }));
        await archive.sync();
      } finally { await archive.close(); }
      state.events = state.events.slice(oldEvents); state.decisions = state.decisions.slice(oldDecisions);
    }
    validatePaperState(state);
    const temp = resolve(this.directory, `state-${process.pid}.tmp`);
    const h = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try { await h.writeFile(JSON.stringify(state)); await h.sync(); } finally { await h.close(); }
    await rename(temp, resolve(this.directory, "state.json"));
    const dir = await open(this.directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
  }
  update(fn: (state: PaperState) => void | Promise<void>): Promise<void> {
    const work = this.tail.then(async () => { const next = this.read(); await fn(next); await this.write(next); this.state = next; });
    this.tail = work.catch(() => undefined); return work;
  }
  async reset(): Promise<void> {
    await this.update(async state => {
      const backup = await open(resolve(this.directory, `reset-backup-${Date.now()}.json`), "wx", 0o600);
      try { await backup.writeFile(JSON.stringify(state)); await backup.sync(); } finally { await backup.close(); }
      Object.assign(state, initialPaperState());
    });
  }
  async close(): Promise<void> { await this.tail; await unlink(resolve(this.directory, "writer.lock")); }
}

/** Preserve balances/history; old universal strategy settings do not drive new entries. */
export function migratePaperState(value: unknown): PaperState {
  const old = structuredClone(value) as PaperState;
  const supplied = old.config as unknown as Record<string, number>;
  const config = { ...PAPER_CONFIG } as PaperState["config"];
  for (const key of Object.keys(PAPER_CONFIG) as (keyof PaperState["config"])[]) {
    if (Object.hasOwn(supplied, key)) config[key] = supplied[key]!;
  }
  old.schemaVersion = 2; old.config = config;
  for (const p of [...old.positions, ...old.trades]) {
    p.plan ??= proposeTradePlan(old, p.candidate, p.entry, Date.parse(p.enteredAt));
    p.plan.approvedSizeUsd = p.sizeUsd;
    p.plan.reasoning.push("Migrated historical position; original entry and account cash retained");
    p.management ??= initialManagement();
    if (p.current.side === "SELL") {
      p.management.lastSuccessfulQuote = p.current; p.management.lastSuccessfulQuoteTimestamp = p.current.timestamp;
      // Only the retained mark is known; do not invent historical peak prices.
      p.management.peakLiquidationValueUsd = p.current.notionalUsd - (p.current.costs.gasUsd ?? 0);
      p.management.peakReturnPercent = (p.management.peakLiquidationValueUsd / p.costBasisUsd - 1) * 100;
      p.management.peakTimestamp = p.current.timestamp;
    }
  }
  for (const d of old.decisions) { d.gptheistVerdict = d.candidate.decision; d.paperVerdict = d.outcome; }
  for (const t of old.trades) t.exitReasoning ??= ["Historical exit retained during schema migration"];
  old.events.push({ timestamp: new Date().toISOString(), category: "SYSTEM", stage: "PAPER", tokenAddress: null, tokenSymbol: null,
    eventType: "POLICY_MIGRATED", message: "Dynamic paper policy enabled; account history retained; schema-v1 backup saved", metadata: {} });
  return old;
}

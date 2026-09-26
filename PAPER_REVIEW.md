# PAPER extension — local review

The account, accounting/risk engine, persistence, background service, activity audit, API and PAPER UI are implemented. **The live adapter deliberately cannot open trades:** current GPTHEIST decisions autho2rize observation only, and a deployment-verified executable USD quote has not been established. This is not a claim that the original end-to-end trading objective or every acceptance check is satisfied. Nothing was committed, pushed or merged.

1. **Discovered architecture.** `npm run desk` runs the TypeScript compiler and `dist/src/cli.js desk`. `src/server.ts` serves static files and JSON APIs. `src/live.ts` validates chain 4663 and discovers the latest 24 factory launches in a 25,000-block window. `LiveLaunch` identifies token, curve, deployer, pair, launch configuration, threshold, block, transaction and log index. `LiveLaunchDecision` adds market state, declared metadata, assessment, handoffs and deployer history. `src/market.ts` reads factory records, curve reserves, real quote reserve, recipient-specific snipe tax, and token metadata via pinned Multicall3. HTTP RPC uses retries/fallback endpoints; browser polling is used, not WebSockets. The original static Desk/Dossier and room routes remain. Shared CSS contains the current black/lime palette and monospace treatments; the bundled screenshot predates that palette. Existing replay persistence is immutable JSONL, not a database. Tests use Node's test runner and strict TypeScript.

2. **Plan followed.** Inspect before edits; preserve decision semantics; implement a separate paper core; reuse market reads and fail closed on unverified quotes; add isolated durable storage and monitor; add `/paper` and navigation; test risk/accounting/failure/restart/API behavior; document limitations and review locally. No research thresholds were changed. No additional dependency was introduced.

3. **Every created repository file.**
   - `src/paper.ts`: centralized defaults, models, eligibility, accounting, monitor helpers, statistics and structured events.
   - `src/paper-quotes.ts`: read-only position market refresh and explicit untradability.
   - `src/paper-store.ts`: validation, exclusive account ownership, atomic storage, restart and reset backups.
   - `src/paper-service.ts`: background scheduling, shared snapshot ingestion and API projections.
   - `assets/desk/paper.html`: PAPER composition and semantic tables.
   - `assets/desk/paper.css`: responsive page-specific layout/styling.
   - `assets/desk/paper.js`: safe text rendering, live polling, chart and uptime.
   - `tests/paper.test.ts`: 26 paper regression tests.
   - `PAPER_REVIEW.md`: this review.

4. **Every modified repository file.** `src/server.ts` (service, routes and read-only RPC allowlist); `src/cli.ts` (paper reset/help and shutdown); `assets/desk/index.html` and `assets/desk/room.html` (PAPER navigation); `README.md` (paper operation/methodology documentation). `package.json` and `package-lock.json` were already modified before this task and were not edited by this implementation. Build output in ignored `dist/` was regenerated. Tests also create ignored replay logs and temporary isolated paper stores; no example profits/trades were written into the production paper account.

5. **Account design.** One virtual USD account with $1,000 default starting cash; cash, equity, realized/unrealized/total P&L, open positions and closed trades. Positions preserve entry decision and gates, token identity and launch ID, quantity, size, cost basis, raw and effective quote prices, source/block/timestamps, cost estimates and mark status. Closed trades add exit quote/time, dollar return, percentage return and stop/target reason. All fills are `PAPER` / `SIMULATED`, with no synthetic transaction hash.

6. **Eligibility.** VETO always rejects. WATCH is observation only. The generic engine accepts only explicit `PAPER_APPROVED`, complete evidence, and required PASS handoffs, then checks quote validity/freshness/identity/size/liquidity, cash, duplicates, position count and daily losses. Production never emits that approval. Replay fixtures are not connected to the account. Both eligibility and quote availability/reasons are persisted separately.

7. **Decision meanings.** In live research Tokyo discovers; Berlin locks observation policy; Rio checks verified curve state; Denver explicitly lacks social evidence; Lisbon checks provenance; Stockholm discloses missing executable/slippage evidence; Nairobi summarizes unknowns; Helsinki prepares an explorer trace; Palermo PASS clears a watch gate; Professor PASS approves WATCH monitoring. Neither PASS means live paper buy. VETO means no action approved. The separate replay's PASS is hypothetical fixture approval only.

8. **Live pricing implementation.** Reuses actual pinned market reads. The source inspection found published Pons curve math, but no verified match for the monitored snipe-tax deployment and no established fresh ETH/USD conversion. The adapter returns `NOT_PAPER_TRADABLE`, with `MARKET_UNAVAILABLE` or `EXECUTABLE_USD_QUOTE_UNVERIFIED`. It does not pretend a reserve ratio is an executable quote. Source links and precise gaps are in README. No verified executable live quote was obtained during validation.

9. **Simulated fills.** Generic engine requires a sized quote with raw and effective USD unit price, quantity, notional, liquidity and freshness evidence. Effective quote must reconcile with quantity × price. Entries debit sized notional plus known gas; exits credit effective proceeds less known gas. No production fill currently occurs. Deterministic test fills exercise accounting only and are not live data.

10. **Fees/slippage/gas.** Known fee/impact/slippage components are already included in the effective quote and are not charged twice. Gas is charged separately when available. Unavailable estimates are null; performance displays known sums and unknown-fill counts. Unknown costs are excluded from P&L and explicitly disclosed. No gas units, spread, tax, or slippage percentage is invented.

11. **Persistence.** `runs/paper/state.json`: versioned JSON, serialized copy-on-write updates, fsync and atomic rename, no-follow reads, safe-directory reuse, writer PID lock. State corruption fails closed. Account rules survive restart. Reset backs up prior state and affects only this paper directory. SQLite was not added because the existing Node 18 package has no database infrastructure and native dependency overhead was avoidable. Use one process and a durable local disk; history grows without automatic deletion.

12. **Monitor.** Runs after server startup independently of browser traffic, with a 15-second delay between completed cycles and no overlapping writes. Every retained position is checked independently of the current launch window. Fresh pinned market reads are possible from its saved launch provenance, but the quote remains unavailable until the missing adapter is implemented. RPC/missing/stale/invalid quote results preserve the position and last-known valuation; valid quotes in the engine update P&L and trigger only stop/target exits. There is no $0 fallback.

13. **Risk controls.** Central defaults: $10 max notional, five positions, −10% stop, +20% target, $50 realized daily gross-loss limit. Duplicate addresses are compared case-insensitively. Cash includes known entry gas. Quote and block timestamps must each be at most 30 seconds old and not future-dated. Daily losses use UTC dates and do not net away losses against wins; exits continue after the limit.

14. **Statistics.** Total trades includes all closed trades, including breakevens; wins/losses are positive/negative P&L. Win rate = wins/count. Gross profit = sum positive P&L; gross loss = absolute sum negative P&L; net = profit − loss. Average win/loss divides corresponding sums by counts; average loss is negative. Profit factor = profit/loss; expectancy = net/count. Undefined ratios/averages are null, and empty win rate is 0. Holding time is mean exit minus entry in milliseconds. Drawdown uses every persisted equity snapshot relative to its running peak, in percent and dollars. Cost statistics sum entries/exits, not marks. Account equity = cash + last-known position net values; total P&L = equity − starting balance. README documents all formulas and stale-mark limitations.

15. **Activity model.** Objects carry timestamp, category, stage, token address/symbol, event type, message and metadata. Actual research handoffs, rejections, simulated opens/marks/closes, and failures generate records. Exit events include the condition and P&L. No sample feed is injected into the page.

16. **PAPER architecture.** Static `/paper`, `/paper.js`, `/paper.css`; read-only `GET /api/paper`; browser polling every five seconds. Account cards, server-session clock, real WATCH/VETO gate, persisted time-based equity chart, event log, position/trade tables, full-history performance and eligibility table. No mutation or manual-buy endpoint. Original routes and Target Dossier retained. Display limits are 100 recent trades/decisions and 200 events; performance still uses all stored data.

17. **Exact layout/style files.** `assets/desk/paper.html` controls structure; `assets/desk/paper.css` controls PAPER layout/responsiveness; `assets/desk/paper.js` controls rendering/chart; existing `assets/desk/desk.css` supplies shared tokens/fonts/navigation and was not modified.

18. **Safety protections.** No key/seed/wallet/signing/swap/order/transaction-broadcasting code added. RPC methods are explicitly limited to reads. No write-contract ABI or buy/sell calldata added. Production does not import test fixtures. WATCH is never upgraded to approval. Invalid quotes cannot liquidate positions; paper storage and reset are isolated. UI uses text nodes and existing security headers.

19. **Tests added.** 26 cases cover initialization, entry/exit, win/loss, stop/target, cash, size, count, duplicates, daily loss/reset/continued exits, raw/effective/cost handling, price updates, realized/unrealized/equity, statistics/drawdown/empty denominators, invalid/stale/future/missing quotes, RPC errors, malformed quote shape, quote mismatch, eligibility and veto, restart/exclusive ownership/reset/corruption/rollback, serialized API/routes, RPC read allowlist and live adapter semantics/pinned calls.

20. **Test results.** `npm test`: **58 passed, 2 failed, 60 total**. All 26 new tests passed. 32 of 34 existing tests passed. The two existing doctor tests fail because the pre-existing `codex` runtime dependency violates the unchanged `viem`-only allowlist. This was reproduced against unchanged HEAD source in `/tmp/gptheist-baseline`, using the existing working package manifest: the same two doctor failures, eight other CLI tests passing. No tests or allowlist rules were weakened. Tests required execution outside the sandbox because localhost binding/child-process execution initially returned EPERM.

21. **Other validation.** `npm run build`: passed. `npx --no-install tsc --noEmit -p tsconfig.json`: passed. `node --check assets/desk/paper.js`: passed. `git diff --check`: passed. No lint or typecheck npm script is configured; strict compiler checking was run directly. Browser rendering and live executable-quote integration were not verified. No browser tool/binary was available.

22. **Start commands.** From repository root: `npm run desk`. Alternatively `npm run build`, then `npm start` (the existing start command listens on 0.0.0.0 and honors PORT). Existing optional RPC_URL remains supported. Default paper storage is relative to the process working directory: `runs/paper`.

23. **URL.** `http://127.0.0.1:4173/paper`; original Desk at `http://127.0.0.1:4173/`.

24. **Reset.** Stop the Desk; run `npm run build`, then `node dist/src/cli.js paper-reset --confirm-paper-reset`. A timestamped backup of prior PAPER state is retained. Restart with `npm run desk`. Corrupt state requires restoring a valid backup before reset; active-owner locks refuse reset.

25. **Limitations.** No current live entries; no deployment-verified executable quote/ETH-USD source; missing required social/slippage approval evidence; no graduated-pool quote; unknown execution costs; no real-market impact from hypothetical trades; last-known equity can be stale; JavaScript floating-point USD accounting; local single-process growing JSON persistence; limited discovery window; no screenshot/browser verification; two pre-existing test failures.

26. **Human review.** Review the PAPER UI in a browser, the conservative no-entry behavior, quote/deployment/USD-source requirements, local storage deployment/retention, and the pre-existing dependency conflict. A future pricing/approval implementation requires independent verification and tests, not flipping a flag. No approval for real execution is requested or supported.

## Final safety/quality checklist

- [x] No private-key support added.
- [x] No seed-phrase support added.
- [x] No wallet signing added.
- [x] No transaction broadcasting added.
- [x] No real swap/order execution added.
- [x] No fake live prices added.
- [x] No fake production trades added (test fixtures isolated).
- [x] No fake profits/statistics added.
- [x] WATCH is not blindly converted to BUY.
- [x] Missing RPC/quote data cannot cause a $0 exit.
- [x] Paper state survives restart (tested).
- [x] Existing Desk routes and research behavior preserved (regression tests passed).
- [x] Existing Target Dossier markup/API behavior preserved (regression tests passed; browser review outstanding).
- [x] PAPER page says PAPER MODE.
- [x] PAPER page says SIMULATED EXECUTION.
- [x] PAPER page says NO REAL MONEY.
- [ ] All existing tests pass — two pre-existing doctor failures remain.
- [x] New paper tests pass (26/26).
- [x] Build passes.
- [x] TypeScript checks pass; lint is not configured.
- [x] No commit, push or merge performed.

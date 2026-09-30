GPTHEIST paper engine reliability audit — 2026-09-28

Changes are uncommitted. The existing project, launch-age work, and original paper account were preserved. No wallet, key, signing, approval, transaction broadcasting, or real execution code was added. The production RPC transport still permits only its existing five read methods. Live validation used an isolated account.

**Outcome and limits**

A real fresh IQLABS launch progressed through observation, positive verified traction, sized buy/sell validation, and paper entry. Five consecutive independent sell observations succeeded. An injected RPC outage preserved the last valuation and cash, followed by successful live recovery. Existing drained positions remain unavailable; their values were not forced to zero or made executable artificially.

This is not a blanket certification of every deployed contract path. The current official documentation specifies the integer quote model, and captured real trades corroborate it exactly. The accessible public Solidity revision lacks the deployed snipe-tax path. Explorer verification requests returned HTTP 403 and Sourcify metadata was unavailable. Nonzero-snipe and graduation paths have not been independently proven against deployed bytecode; graduation fills/pools remain unsupported. Historical BOAR/PLabs archive calls also returned HTTP 403. These limitations remain explicit.

**1. Old failures and exact rejection condition**

The old entry path admitted positions without ever testing a sell for the buy output. It initialized their mark from the BUY quote, which is not liquidation evidence. Later market drainage left some positions without a usable sell quote. A separate observation bug changed a previously LIVE launch to BACKFILL on its next scan, preventing a multi-observation entry process.

The existing liquidity rejection was not a generic RPC error. `calculatePaperQuote` computes:

```
gross = floor(rawTokenInput * pricingQuoteReserve / (tokenReserve + rawTokenInput))
if (gross > realQuoteReserve) reject INSUFFICIENT_EXIT_LIQUIDITY
net = gross - floor(gross * feeBps / 10000) - floor(gross * creatorTaxBps / 10000)
```

`markPaperPosition` also refuses proceeds above quoted available liquidity. Neither condition was removed. The gross-reserve test preserves the curve's free-reserve accounting; it does not borrow balances reserved for fees.

The live hoods audit reproduced this failure:

| Field | Verified/read result |
|---|---|
| Token | hoods / `0xa1dafdefcf115e15632f5d69950ac4b52ce2ee52` |
| Curve | `0xe5e1ba4d053a1b53a336a6000527a4f192efac5e` |
| Human quantity | `409881.356835236675132219` |
| Raw quantity | `409881356835236675132219` |
| Token decimals | 18 |
| Pricing quote reserve | `1680000000000000001` wei |
| Token reserve | `1000000000000000000000000000` raw |
| Real free quote reserve | `1` wei |
| Curve progress | 0 bps |
| Gross proposed sell | `688318550541766` wei |
| Curve fee | `6883185505417` wei |
| Creator tax | `27532742021670` wei |
| Hypothetical net, NOT an accepted fill | `653902623014679` wei |
| Exact failure | `688318550541766 > 1` |

This supports insufficient current free liquidity, not a decimal conversion or cache explanation, for this case. NETWORK, THECARDWALL, CLANKCAP, and CELCIUS also failed the same bound. It does not prove that every historical failure had the same cause. Full ABI-encoded requests/responses, blocks, and calculations are in [old-position diagnostics](runs/paper-reliability-2026-09-28/old-position-diagnostics.json).

**2. Authoritative quote path and Pons integration**

Production entry and position-monitor adapters use `PaperQuoteService`. Its buy/sell methods share `readPaperQuote` and the same pinned-state calculator. No alternative spot-price fill was introduced.

Factory: `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e`; chain: 4663. Curve/token identity is checked against factory research and the curve's `token()`, `factory()`, and `pairToken()` reads. Only the zero-address native ETH pair is supported. Curve addresses come from verified launch records, not a guessed universal pair.

Read methods include `getLaunchedToken(address)`, `getReserves()`, `realQuoteReserve()`, `feeBps()`, `sellableTokens()`, `graduated()`, `readyToGraduate()`, token `decimals()`, and `currentSnipeTaxBps(recipient)`. Snipe research uses the existing explicit probe recipient `0x000000000000000000000000000000000000dead`; this is a read parameter, not a connected wallet.

Pons documents no standalone curve quote function. The engine uses the [official integer quote specification](https://docs.ponsfamily.com/v2#getting-a-quote). Pricing reserves include phantom quote liquidity; real reserves exclude phantom reserves and accrued fee balances. Real reserves are used as an execution bound, never substituted into the pricing formula. Factory phase and both graduation flags prevent unsupported fills.

The core multiplication/division now follows the [public Solidity math library](https://github.com/ponsdotdev/pons-labs/blob/6bca41795baab5a5a8ee797e1ad31cd0bd4686b2/contractsV2/src/v2/libraries/PonsV2BondingCurveMath.sol), including uint256 intermediate overflow and zero-output rejection. With a zero curve-math fee argument, its scaled numerator/denominator reduce algebraically to the documented fraction without changing integer floor. Each quote-leg fee is rounded separately.

An actual IQLABS buy at block 74417607 produced exactly `405726848480127867753106` raw tokens in both the model and settled event. Five actual sell events also matched output AND separately rounded curve/creator fees exactly; their `factory()` reads matched Pons. [Captured contract observations](fixtures/paper-contract-observations.json) are automated regression fixtures. This is concrete corroboration, not an exhaustive bytecode equivalence proof.

**3. Units, buys, sells, and round trips**

Token decimals are read from each actual token at the quote block; missing/unsupported decimals reject. Native ETH uses 18 decimals. Contract quantities are bigint/raw decimal strings, never reconstructed from the floating-point display quantity. Tests cover 6, 8, 9, and 18 decimals.

USD-to-wei now serializes the account amount/rate as decimal rationals and divides integers, flooring to wei. Buy fees, creator tax, and capped snipe tax come off input before curve pricing. Full-allocation/graduation fills reject. Sells price the exact retained raw token quantity, then subtract separately rounded curve and creator fees; no sell snipe tax is invented.

Every successful buy read now obtains an independent current-state sell read for precisely its raw output. No hypothetical buy is applied to real reserves. Both reads must remain fresh at admission, have matching identity/decimals/quantity, and satisfy existing account gates. Round-trip loss, immediate liquidation, taxes, and curve fees are retained. Costs at or above the existing maximum downside cap reject; risk/exit thresholds were not fitted to the saved outcomes. New entries also reject stale account valuation.

A new position starts from the validated SELL baseline. Size remains dynamic, based on account/risk/liquidity policy, with sized probes and re-quotes; no fixed $10 entry was introduced. Gas and execution drift remain null. The historical `costs.feesUsd` field includes total known fees/taxes; new round-trip fields separate curve fees from creator/snipe taxes.

**4. Freshness, monitoring, and exits**

Every calculation pins reads to a numbered block, validates its timestamp, and rechecks its canonical hash. Source ETH/USD timestamps, not fetch times, govern conversion freshness. The shared Coinbase bid/ask cache lasts at most five seconds and never refreshes a source timestamp. Buys use ask; sells use bid.

Position refresh defaults to 5,000 ms through `PAPER_QUOTE_REFRESH_MS`, independently of the existing 15-second discovery interval. Minimum configured refresh is 1,000 ms. Quote service concurrency is two; identical in-flight work is deduplicated, and work for a token is serialized. Existing RPC request timeouts, bounded retries, and rate-limit backoff remain; admission pacing now reserves its start time before awaiting, preventing concurrent requests from claiming the same slot. Transient position failures back off up to 60 seconds. Polling is used; reliable new-block subscriptions were not established.

The API separately exposes attempt time, successful quote time, quote/current block, age, consecutive failures, and last reason. UI statuses distinguish LIVE, STALE, and UNAVAILABLE. It labels stale marks LAST VALUE and stale account totals LAST KNOWN. There is no sell-quote result cache; shared ETH/USD caching does not make token quotes live.

On failure, the last successful quote is retained. No $0, -100%, fictional rug, or simulated exit is generated. Pending exit intent survives failures. Every actual paper close still requires a distinct final full-position quote after the exit condition; it does not fill from the dashboard mark.

Peak liquidation, MFE, MAE, entry liquidation, excursion-tracking start, and management state persist. MFE is the maximum nonnegative measured return; MAE is the minimum nonpositive measured return. Peak return remains signed. Legacy excursions start when measured after upgrade, not from an invented historical path. Existing dynamic risk, runner/profit protection, reserve-deterioration, trailing, and maximum-hold policies use fresh sells. Primary numerical strategy thresholds were preserved.

**5. Fresh launches, observations, research, and laboratory**

Startup/backfill launches cannot enter. Launch age is verified separately from holding age. LIVE provenance persists while that same launch is observed within its session; startup after restart still fails closed as backfill. Positive measured changes in BOTH real reserve and curve progress are required, with recent source timestamps. Unknown data stays unknown. Unknown traction is OBSERVING; weak/negative evidence rejects. No volume, holders, sentiment, or volatility was manufactured.

Launch observations, entry decisions, round-trip evidence, successful quote snapshots, failures, exits, and chronological laboratory frames are archived by existing persistence. A compact opportunity ledger counts unique opportunities since activation; older lifetime counts are explicitly unknown pending archive reconstruction.

The offline laboratory has separate CONTROL, SELECTIVE, FAST_FAILURE, and RUNNER accounts. Every portfolio consumes the same chronological frame and exact-size quote tape, with independent cursors. Future/backward frames reject. Missing sizes or distinct final sell reads reject instead of being interpolated. SELECTIVE requires two positive observation pairs; FAST_FAILURE halves its own reserve-drop/hold policies; RUNNER widens its own trail by 1.5. These versioned experimental definitions do not modify the primary strategy and were not fitted to outcomes.

The early live capture lacked the complete sized probe tape, so its laboratory replay cannot be used as a fair performance comparison. Future desk frames capture that tape. Offline replay supports saving/restarting the laboratory; it is not an automatically running multi-portfolio live trading desk.

Metrics include existing trade/P&L/drawdown statistics, median/best/worst returns, measured excursions/capture, known taxes with missing-data counts, opportunity coverage, and groupings by Palermo/risk/curve/age/traction/exit. Stale equity remains explicitly qualified. Historical missing excursion values remain null.

**6. BOAR and PLabs historical audit**

| Trade | Recorded entry USD | Recorded exit USD | Recorded return | Saved raw arithmetic |
|---|---:|---:|---:|---|
| BOAR | 10.97 | 2.0899892196131518 | -80.9481383809193% | Reproduces exactly |
| PLabs | 11.05 | 2.561044231215993 | -76.82312912926703% | Reproduces exactly |

Both saved gross exits fit their saved real reserves, and both preserve raw 18-decimal quantities. BOAR's blocks are 73252409 → 73254166; PLabs' are 73243031 → 73245682. Neither has pre-entry round-trip evidence. Historical RPC reconstruction was attempted for both entry and exit and failed with HTTP 403. Their saved sell-history coverage is not complete enough to certify the whole trajectory.

Conclusion: the saved numbers are internally consistent, but whether those losses were fully executable-equivalent remains UNVERIFIED_HISTORICAL_EXECUTION. No trade was deleted, rewritten, or falsely classified as invalid solely for losing. The audit script emits INVALID_HISTORICAL_EXECUTION if it finds an arithmetic/liquidity contradiction. [Full reconstruction attempts](runs/paper-reliability-2026-09-28/historical-audit.json) retain the evidence and errors.

**7. Complete real numerical example**

IQLABS: `0x49b1be8e7ca0730f2cc24388bd54832f948b8a3f`; curve `0x7dcb4bd9f210f902b53fba4fa2b574fa323ebef2`.

Launch block 74417547; verified observed launch age 22 seconds; eventMode LIVE. GPTHEIST WATCH, Palermo 80/PASS. It was initially held for insufficient traction. Subsequent reads measured +2 progress bps and +717800000000000 wei reserve over 17 seconds. The existing sizing policy approved $2.35, limited by real-liquidity participation.

```
$2.35 / ETH ask $2659.24
→ 0.000883711135512402 ETH (883711135512402 wei)
→ 484078.39085831909865579 IQLABS
  (484078390858319098655790 raw; decimals = 18)
→ 0.000830657951306179 ETH (830657951306179 wei)
× ETH bid $2658.71
→ $2.208478601717251 immediate liquidation
```

Buy block 74417821; independent sell block 74417826. Round-trip loss: $0.14152139828274857 / 6.022187160968029%. It was admitted with the measured loss, not made profitable. [Full example](runs/paper-reliability-2026-09-28/numerical-example.json).

**8. Five independent live refreshes and failure recovery**

Each row sold the SAME exact raw quantity above, producing `830657951306179` wei = `0.000830657951306179 ETH`. The unchanged raw result reflects unchanged curve reserves; each row has separate RPC diagnostics and a different block.

| UTC completion | Block | ETH/USD bid | USD liquidation | Age at capture | Status |
|---|---:|---:|---:|---:|---|
| 01:53:53.718 | 74418950 | 2660.15 | 2.209674749167132 | 1 ms | LIVE |
| 01:53:57.149 | 74418984 | 2660.15 | 2.209674749167132 | 0 ms | LIVE |
| 01:54:00.566 | 74419019 | 2660.09 | 2.209624909690054 | 0 ms | LIVE |
| 01:54:03.986 | 74419052 | 2660.09 | 2.209624909690054 | 1 ms | LIVE |
| 01:54:07.407 | 74419086 | 2661.48 | 2.210779524242369 | 1 ms | LIVE |

At 01:54:07.408 a deliberately injected RPC exception left $2.210779524242369 as LAST VALUE, marked STALE. Cash remained $997.65; closed trades stayed zero. At 01:54:10.827 a real read at block 74419121 restored LIVE. No exit policy was forced during this copied-position failure test. [Raw independent reads and recovery](runs/paper-reliability-2026-09-28/quote-refreshes.json).

The real desk also independently refreshed this open position throughout its run. Its recorded transport counts were 52 chain reads, 52 head reads, 24 log requests, 92 eth_calls, and 377 block-header reads; zero transaction methods. [Desk run](runs/paper-reliability-2026-09-28/live-desk.json).

**9. Tests and remaining work**

Build succeeds. Paper/launch/server suite: 97/97 passed. Full suite: 127 tests, 125 passed, 2 failed. Both failures are pre-existing doctor/dependency-policy tests: package.json includes `codex`, while doctor allows only `viem`. That dependency policy was not silently weakened or the package removed. UI JavaScript syntax and `git diff --check` pass.

Added tests cover four decimal formats, integer conversion/overflow, mandatory exact/stale/missing round trips, drained reserves, transient failure/recovery, distinct final exit reads, observation requirements, MFE/MAE, per-token serialization/deduplication, actual settled sell fixtures, laboratory chronology/future rejection, separate portfolios, and laboratory restart. Existing sizing/account limits, launch/backfill, persistence, risk/trailing/max-hold, source freshness, and HTTP-boundary tests remain exercised.

Remaining verification limits: full deployed-source equivalence including nonzero-snipe behavior; archive-backed BOAR/PLabs reconstruction; graduated-pool support (currently rejects); a complete shared quote dataset before valid comparative shadow-strategy conclusions. No profit, loss-rate, or strategy-improvement claim is made.

**10. Files changed in this task**

Core: `src/paper-quotes.ts`, `src/paper-math.ts`, `src/paper.ts`, `src/paper-service.ts`, `src/paper-policy.ts`, `src/paper-store.ts`, `src/server.ts`, `src/launch-evidence.ts`.

Research: `src/paper-research.ts`, `src/paper-laboratory.ts`.

Desk/docs: `assets/desk/paper.js`, `assets/desk/paper.html`, `README.md`, `PAPER_ENGINE_AUDIT.md`.

Tests/evidence: `tests/paper-reliability.test.ts`, `tests/paper-laboratory.test.ts`, `tests/paper-fixtures.ts`, `tests/paper-flow.test.ts`, `tests/paper.test.ts`, `tests/launch-age.test.ts`, `fixtures/paper-contract-observations.json`.

Validation/replay: `scripts/paper-live-check.mjs`, `scripts/paper-refresh-validation.mjs`, `scripts/paper-history-audit.mjs`, `scripts/paper-contract-proof.mjs`, `scripts/paper-sell-contract-proof.mjs`, `scripts/paper-laboratory.mjs`. Raw outputs are under `runs/paper-reliability-2026-09-28/` (ignored runtime artifacts, still available locally).

The worktree already contained changes to launch evidence, live.ts, tests/live.test.ts, README, desk files, paper persistence/fixtures, investigation reports, and diagnostic scripts. Those were retained. Nothing was committed, pushed, or merged.

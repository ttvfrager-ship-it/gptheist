# Paper strategy v3

V3 adds stricter entry selection to the [v2 policy](PAPER_STRATEGY_V2.md). It remains an experimental paper strategy, with no live transaction signing or changes to historical fills.

## Changes

- Require real ETH reserves to back at least 50% of the curve's pricing quote reserve. Virtual reserve depth alone cannot qualify an entry.
- Compare matching, successful, pinned curve observations from different blocks 10–90 seconds apart. Native ETH/token reserve price momentum must exceed the larger of 1% or 1.5 times the actual sized round-trip loss. ETH/USD changes cannot manufacture this momentum. This is entry context; valuation and exits still require full-position executable SELL quotes.
- Retain v2's recent inflow confirmation, 5% maximum round-trip loss, 0.5% equity allocation cap, three-loss entry cooldown, early profit protection, stagnation exits and separate fresh final exit quotes. Migration to verified Uniswap v4 routes remains supported.
- Size against cash plus fresh executable holdings. Unavailable or expired holdings contribute zero to sizing equity while retaining at least their full cost basis against portfolio exposure. This allows separately verified opportunities within remaining limits without letting stale marks inflate buying power. Saved marks, fills and position data are preserved; zero is a conservative capital assumption, not a fabricated liquidation quote.
- Show conservative sizing equity and unavailable holdings in the dashboard. Track new v3 trades separately. Validation requires at least 30 closed trades, at least 50% wins, positive realized PnL and positive PnL including fresh open liquidation values. Unavailable open v3 exposure prevents validation.

Existing positions retain their saved exit plans. New entries receive strategy version 3 after the desk loads this build.

## Gas accounting correction (2026-10-01)

Entry confirmation, execution momentum and stop-distance planning now share the same round-trip loss calculation: `1 - (sell notional - sell gas) / (buy notional + buy gas)`. Fees and price impact are already embedded in quote notionals and are not deducted again. Unknown gas remains excluded and is not claimed to be estimated. Position sizing reserves known entry gas inside cash capacity, stop-risk budget and the token allocation cap; final eligibility includes it in account exposure limits.

Regression tests cover gas turning an apparent viable trade into a rejection, the higher momentum hurdle, allocation limits, invalid gas and final eligibility. Removed the unused `codex` npm package to restore the existing runtime dependency allowlist; the bot only imports `viem`. Daily-loss accounting fixtures use legacy plans to isolate that limit from the separately tested strategy cooldown.

The gas-aware replay is written separately to `runs/strategy-v3/gas-aware-replay.json`. Its result remains one accepted closed trade at +$1.49, 26 rejections and zero unresolved accepted trades. This correction does not establish a new profitable edge.

## Evidence and limits

The frozen archive contains 27 original closed trades: 4 wins and −$59.83. V2's exploratory matched-size replay accepted six, with three wins and −$2.89. V3 rejects 26 and accepts one recorded trade, which closes at +$1.49 using separate observed final SELL evidence. There are no unresolved accepted trades in this replay.

One outcome cannot establish a win rate or profitable edge. These rules were informed by the same history, so this is an exploratory comparison, not an independent holdout or prospective result. The replay retains original quantities, omits the new allocation sizes and portfolio cooldowns, and cannot capture missed opportunities. Strict selection may substantially reduce trading frequency. Stops cannot guarantee fills through sudden liquidity gaps.

```sh
npm run build
node scripts/paper-strategy-replay.mjs runs/strategy-v2/tape.json runs/strategy-v3/replay.json 3
node dist/tests/paper-execution-quality.test.js
```

The replay writes separate research artifacts and never rewrites the main paper account. The v2 tape was extracted from archived real quote evidence using `scripts/paper-strategy-tape.mjs`.

## Activation

On 2026-10-01 the existing desk was restarted after all 189 tests passed, preserving its environment and account directory. The restart retained an account backup at `runs/paper/monitor-fix-backup-1790888483443.json`. The restarted process loads the gas correction for future entries; historical plans and fills remain preserved. New-trade performance still requires prospective validation. `npm run desk` builds before starting; do not start a second writer against the existing account.

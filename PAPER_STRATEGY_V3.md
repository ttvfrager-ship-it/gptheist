# Paper strategy v3

V3 adds stricter entry selection to the [v2 policy](PAPER_STRATEGY_V2.md). It remains an experimental paper strategy, with no live transaction signing or changes to historical fills.

## Changes

- Require real ETH reserves to back at least 50% of the curve's pricing quote reserve. Virtual reserve depth alone cannot qualify an entry.
- Compare matching, successful, pinned curve observations from different blocks 10–90 seconds apart. Native ETH/token reserve price momentum must exceed the larger of 1% or 1.5 times the actual sized round-trip loss. ETH/USD changes cannot manufacture this momentum. This is entry context; valuation and exits still require full-position executable SELL quotes.
- Retain v2's recent inflow confirmation, 5% maximum round-trip loss, 0.5% equity allocation cap, three-loss entry cooldown, early profit protection, stagnation exits and separate fresh final exit quotes. Migration to verified Uniswap v4 routes remains supported.
- Size against cash plus fresh executable holdings. Unavailable or expired holdings contribute zero to sizing equity while retaining at least their full cost basis against portfolio exposure. This allows separately verified opportunities within remaining limits without letting stale marks inflate buying power. Saved marks, fills and position data are preserved; zero is a conservative capital assumption, not a fabricated liquidation quote.
- Show conservative sizing equity and unavailable holdings in the dashboard. Track new v3 trades separately. Validation requires at least 30 closed trades, at least 50% wins, positive realized PnL and positive PnL including fresh open liquidation values. Unavailable open v3 exposure prevents validation.

Existing positions retain their saved exit plans. New entries receive strategy version 3 after the desk loads this build.

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

The existing desk process is outside this sandbox's process namespace and cannot be restarted here. Restart that desk from its controlling terminal after building; use its existing configuration and paper data directory. `npm run desk` builds before starting. Do not start a second writer against the existing account. The current saved account still contains unversioned plans, so the new policy must not be reported as active until the restarted process creates v3 plans.

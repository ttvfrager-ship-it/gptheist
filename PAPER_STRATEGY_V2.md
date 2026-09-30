# Paper strategy v2

Superseded for new entries by [paper strategy v3](PAPER_STRATEGY_V3.md). This document preserves the earlier research comparison.

The saved account audit found 4 wins in 27 closed trades (14.81%), with −$59.83 realized PnL. Entries could pass on positive endpoints across an old observation window even after the most recent reserves reversed or flattened. Profit protection often armed only at 20–32% executable return, allowing smaller gains to disappear. PFE's recorded full-balance quote went from approximately −2.3% to −61% between monitor reads as reserves collapsed; a stop threshold cannot manufacture intervening liquidity.

## New entry rules

V2 requires at least three verified samples, evaluating up to the latest five. At least 60% of reserve transitions must be positive, total reserve growth must reach 2%, the latest transition must grow at least 0.5%, and reserves may not be more than 5% below their recent peak. Invalid, unverified, future or duplicate-block samples fail. The existing freshness, launch age, completed agent chain and multi-observation executable liquidity gates still apply.

A full-sized buy/sell round trip may lose at most 5%. An apparent instantaneous profit above 1% rejects separated buy/sell price snapshots. A fresh buy quote whose real reserves have fallen more than 5% below the last confirmation rejects the reversed signal. Excessive sized friction triggers smaller, independently re-quoted sizing attempts; an irreducible tax floor rejects.

Planning caps each new token allocation at 0.5% of account equity as well as the existing stop-distance risk budget, cash, portfolio exposure and real liquidity limits. Explicit v2 plans exceeding that gap-risk cap reject. Three consecutive closed v2 losses pause new entries for 15 minutes; monitoring and pending exits continue. Existing saved plans and historic fills are preserved.

## Exit rules

New v2 plans arm profit protection at 3–6% **net executable** return. Known fees already affect that return and are not charged again when choosing the arming threshold. Armed protection uses the greater of 1% return or half the peak return, with 2–4% liquidation drawdown trails. Downside ranges from 6–16% depending on the existing risk assessment, respecting the configured cap and entry-friction buffer. Holds are limited to 5–10 minutes; positions that have never reached a positive executable return exit after two minutes when still negative.

All exits require a distinct, fresh, full-balance final sell quote. Failed final quotes remain pending; a gap can still close below the triggering threshold. Uniswap v4 migration remains available. No chart prices, synthesized liquidity, invented fills, signed transactions or real-money trading are introduced.

## Evidence

Exploratory matched-size replay of archived quote evidence:

| Metric | Original account | V2 selection + exits |
|---|---:|---:|
| Closed trades | 27 | 6 |
| Wins | 4 | 3 |
| Win rate | 14.81% | 50.00% |
| Net quoted PnL | −$59.83 | −$2.89 |
| Profit factor | 0.146 | 0.680 |

V2 rejected 21 original entries. This comparison isolates selection and exits using the original exact quantities; it does **not** replay the new smaller allocation sizes or portfolio cooldown. It uses two distinct recorded exit reads, never interpolates prices and never changes the primary account. Rules were informed by the same history; the chronological split is diagnostic, not an independent holdout. The earlier split had 2/3 wins and +$3.95; the later split had 1/3 wins and −$6.84. Six outcomes do not establish profitable performance.

The dashboard tracks new `strategyVersion=2` trades separately. Target status requires at least 30 closed v2 trades, win rate ≥50%, and positive net quoted PnL. Until then it reports `COLLECTING_EVIDENCE`; a ≥50% win rate with negative PnL does not pass. Original losses remain visible in lifetime results.

## Reproduce

```sh
npm run build
node scripts/paper-strategy-tape.mjs runs/paper runs/strategy-v2/tape.json
node scripts/paper-strategy-replay.mjs runs/strategy-v2/tape.json runs/strategy-v2/replay.json 2
node dist/tests/paper-strategy.test.js
```

Both scripts write separate research artifacts. The extraction reads saved trades and archive events; the replay uses only observed full-balance sell quotes inside each original holding period. Missing final exit evidence remains unresolved.

Build, JavaScript syntax and diff checks pass. Eight new strategy tests and 108 relevant existing tests pass, including liquidity traps, failed final sells, migration, persistence, strategy sizing and traction. The two previously documented CLI doctor failures were outside this validation run.

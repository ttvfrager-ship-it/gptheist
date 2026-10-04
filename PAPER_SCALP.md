# Experimental paper scalp profile

`PAPER_STRATEGY_MODE=SCALP` selects strategy version 4 for new entries. `STRICT`
selects the existing version 3. The choice is saved in the account; startup can
override it. Existing positions retain their saved exit plans and all historical
trades remain in lifetime P&L. No real order execution is added.

The scalp profile aims to qualify earlier launches and close short opportunities
rather than hold for large runners. It is experimental and has not demonstrated
positive net profitability.

| Rule | STRICT | SCALP |
|---|---:|---:|
| Verified inflow samples | 3 | 2 |
| Minimum inflow span | 10 seconds | 5 seconds |
| Successful pinned SELL samples | 3 | 2 |
| Minimum SELL confirmation span | 30 seconds | 10 seconds |
| Real share of pricing reserve | 50% | 20% |
| Maximum known round-trip loss | 5% | 3% |
| Maximum token allocation | 0.5% equity | 0.25% equity |
| Net take-profit target | Trailing policy | 3% |
| Profit protection arms | 3–6% | 1.5% |
| Liquidation drawdown trail | 2–4% | 1.25% |
| Planned downside | Risk-derived | 4–6%, with entry-friction buffer |
| Stagnation exit | 120 seconds | 30 seconds |
| Maximum hold | Up to 600 seconds | 90 seconds |
| Pause after three cohort losses | 15 minutes | 3 minutes |

SCALP retains verified chain identity and factory provenance, completed WATCH
handoffs, fresh chronology, positive reserve/progress changes, sized BUY quotes,
exact-unit full SELL quotes, a minimum real ETH reserve, 100× exit coverage,
1% maximum exit participation, and account/portfolio/daily-loss limits. Native
ETH/token quote momentum must still exceed modeled round-trip friction. Reduced
reserve share is paired with smaller allocation, stricter friction selection and
shorter exits; virtual reserves alone cannot authorize a trade.

Profits and stops are net executable quote thresholds. A distinct fresh final
SELL determines actual simulated proceeds. Quote failures keep the position and
pending exit; a price/liquidity gap can settle below a threshold. Gas and execution
drift remain unknown when no estimates exist. No quote interpolation or invented
fills are used.

Start one desk process after stopping any existing owner:

```bash
PAPER_STRATEGY_MODE=SCALP PAPER_DISCOVERY_INTERVAL_MS=2000 PAPER_QUOTE_REFRESH_MS=1000 npm run desk
```

These are scheduling targets; RPC and persistence latency affect observed timing.
The dashboard and terminal display the active mode. Scalp validation requires at
least 30 closed v4 trades, at least 60% wins, positive realized P&L and positive
net P&L including freshly valued open positions. A high win rate with negative
P&L does not pass validation. Lifetime losses remain visible.

## Recorded-quote checks

The fixed preset was tested with original exact quantities, captured full-position
SELL evidence and separate final exit reads. The replay does not test the smaller
new allocations, additional early opportunities, portfolio cooldowns or the new
monitor cadence; missing historical quotes are not synthesized.

| Recorded tape | Original P&L | Scalp closed trades | Wins | Scalp replay P&L |
|---|---:|---:|---:|---:|
| Current nine-trade account | −$6.16 | 5 | 3 | −$0.59 |
| Older 27-trade archive | −$59.83 | 3 | 1 | −$6.06 |

No accepted replay positions remain unresolved. Both comparisons are still
negative. They are small exploratory samples, not proof of a profitable edge or
independent out-of-sample validation. New live paper outcomes must be measured.

The local artifacts are in `runs/scalp-v4/`: `baseline.json`, `current-tape.json`,
`current-strict-replay.json`, `current-scalp-replay.json` and `archive-replay.json`.
The baseline is read-only; activation preserves cash, positions and trades.

```bash
node scripts/paper-strategy-replay.mjs runs/scalp-v4/current-tape.json runs/scalp-v4/current-scalp-replay.json 4
```

Regression tests exercise earlier production admission, strict/scalp separation,
friction and exact-unit rejection, liquidity confirmation, net profit-taking,
unavailable final quotes, downside/stagnation exits, cohort loss pauses, statistics
and preservation of saved plans when switching modes.

## Activation verification

SCALP v4 was activated on 2026-10-04 with a 2-second discovery target and
1-second monitoring target. All 207 tests passed. Live API verification confirmed
the selected profile, no monitor error, and preservation of all nine existing
closed trades and the $993.84 cash balance. No new scalp trade qualified during
the verification window. Observed discovery cycles took approximately 5–11
seconds despite the configured target; RPC and persistence latency still limit
entry speed. Verification evidence is in `runs/scalp-v4/live-validation.json`.

## Live gas counter

The paper dashboard shows Robinhood Chain's live `eth_gasPrice` and Ethereum
mainnet's live rate as a separate reference. Both RPC sources must report the
expected chain ID. Rates expire after 30 seconds; failures display unavailable.
Ethereum mainnet prices are not used to charge Robinhood Chain trades.

New Pons curve quotes model each buy and sell at **200,000 assumed gas units**
multiplied by the live chain price and the quote's ETH/USD rate. This is an
explicit budget assumption, not `eth_estimateGas` or measured transaction usage.
The estimate is deducted from paper cash and exit proceeds, and included in
round-trip entry friction. Saved quotes retain the price, timestamp, chain ID and
assumed units. Old trades are unchanged; their unknown gas remains unknown.
Migrated Uniswap routes, approvals, failed transactions, additional chain fees
and execution slippage are not covered by this model.

## Dynamic balances and quote latency

SCALP sizing now follows current conservative equity rather than requiring a
fixed starting balance. The allocation percentage is
`max(0.25%, min(5%, $2.50 / equity * 100))`. For example, a $50 account has a
$2.50 cost-basis cap (5%), $100 has $2.50 (2.5%), $500 has $2.50 (0.5%), and
$2,000 has $5 (0.25%). Entry gas reduces the token notional under this cap.
The active scalp position limit expands to accommodate that allocation; portfolio
exposure and cash-reserve limits still apply. The scalp downside-risk percentage
is `max(configured risk %, min(0.5%, allocation % * 0.1))`, then reduced by the
existing quality adjustment. Small balances therefore accept greater proportional
exposure than the original profile. Strict mode and saved exit plans are unchanged.

Quote size remains bounded by downside risk, actual reserve participation,
full-position exit coverage, impact, gas-inclusive round-trip friction and the
$1 minimum. Tiny accounts can still be too small for an executable trade; the
bot rejects before unnecessary bootstrap or entry quote work and reports the
allocation cap on the dashboard. Changing equity through account controls is
reflected in future sizing without a process restart.

Chain identity and head reads now overlap. Once the head is known, its header,
pinned contract reads and USD lookup also overlap. The later canonical-block
check and independent final SELL read are retained. These changes remove two
serial network waits per curve quote; scheduling targets are not guaranteed
execution latency or profitability.

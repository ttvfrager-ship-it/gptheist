# Market migration and BUSTO

Validated 2026-09-29 UTC. This is a paper account; no signed transaction was sent.

## Why BUSTO stayed stale

BUSTO (`0x31e31f14fec0591d3e53e85ca5fc425bba1ce21d`) is now factory phase 2 (POOL). Its retired Pons curve fails the curve-state validator with `CURVE_STATE_UNAVAILABLE`. A curve-only monitor cannot produce a current executable liquidation value after that transition.

The workspace had an unfinished Uniswap v4 fallback. It failed TypeScript compilation because its dynamic ABI reader inferred scalar results for tuple-returning functions. A saved preliminary fallback probe also rejected `V4_POOL_INACTIVE` despite populated StateView liquidity and a positive full-position quoter response. The precise loaded implementation responsible for that historical rejection is not retained. The completed validator separately checks active liquidity and consistent StateView/ReservesLens state. On Robinhood's Arbitrum chain the lens's Solidity `block.number` is compared with the pinned RPC header's **L1** block number, rather than its L2 RPC number. Regression tests cover both conventions and reject inconsistent snapshots.

## Validated BUSTO exit route

- Pool ID: `0x203d7a6fc181b4f360a4c6f4658244ace6a60e0e6060842c6c8265bd5f88f2dc`
- PoolKey: native ETH / BUSTO, fee `0`, tickSpacing `200`, hooks `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`.
- PoolManager: `0x8366a39cc670b4001a1121b8f6a443a643e40951`.
- Quoter: `0x8dc178efb8111bb0973dd9d722ebeff267c98f94`.
- Universal Router: `0x8876789976decbfcbbbe364623c63652db8c0904`.
- Full saved balance: `261706621253018206014785` base units, or `261706.621253018206014785` BUSTO.
- Observed output: `410648852161582` wei (`0.000410648852161582` ETH).
- Read-only observation at L2 block `75965606`: approximately `$1.103286`, with approximately `$3164.20` native-ETH pool principal. These are historical observations, not ongoing price claims.

Raw successful read-only evidence: `runs/busto-migration-current.json`. The saved paper trade subsequently contains a fresh second v4 quote at block `75965948`, approximately `$1.103426`, and an ordinary `DYNAMIC_RISK_EXIT` at `2026-09-29T21:06:27.180Z`. BUSTO is now closed in the saved paper account. Its entry, token units and quantity were not rewritten. Do not recreate the position to make it appear open.

## Current behavior

Every open position tries its current execution venue. A failed original curve sell triggers v4 discovery using verified Pons factory provenance and pool key, then pinned StateView, ReservesLens and Quoter calls. Migration requires a successful full-balance exact-input token-to-native-ETH quote; chart price and market cap are never used. The route is persisted only after quote validation, along with `MARKET_MIGRATION_DETECTED` metadata. Future refreshes and the second exit-confirmation quote use v4. Entry venue and entry accounting remain preserved.

The executable mark updates value, PnL, peak value and excursion tracking. Existing exit policy evaluates downside, profit protection and trailing drawdown using that mark. Curve reserve history is removed from migrated position management because it cannot describe pool liquidity.

This implementation covers Pons native-ETH migrations on chain 4663. Unsupported non-native quote currencies fail closed; it does not claim to discover arbitrary third-party or multi-hop pools. The quoter validates the swap route, not wallet allowances or signed transaction execution; this repository remains a paper simulator.

## Validation

`npm run build` passes. All 13 v4 regression tests pass, covering full units, venue fallback, L1/L2 block validation, inactive or uncreated pools, insufficient ETH, stale USD, reorgs, failed full sells, route persistence, unchanged entry data a second exit quote, trailing exits and rejection of altered pool/output evidence.

Full `npm test`: 163 passed, 2 failed. Both failures are existing CLI doctor expectations: package.json includes `codex`, while the doctor allows only `viem`. No dependency or doctor policy was changed for this task.

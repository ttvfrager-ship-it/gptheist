# Open-position quote investigation

Read-only observations on 2026-09-26 UTC. Raw responses: [position-diagnostics.json](runs/position-diagnostics.json). Saved account was read without opening its writer or changing balances. These values describe the recorded observation, not a current price.

## Findings

Four full-position sells fail because real curve ETH reserves are insufficient. $REVOKE succeeds. The saved API previously replaced underlying failures with QUOTE_STALE, hiding that distinction. Discovery, serial position quotes, and entry quoting previously extended the 15-second monitor delay; the configured interval was a delay after all work, not a fixed refresh cadence. Saved events prove the monitor had been polling, not universally stopped.

The sell integer formula matches https://docs.ponsfamily.com/v2#getting-a-quote. Paper purchases do not deposit real ETH into a curve. A simulated holding can therefore remain after real buyers have drained the curve; virtual reserves must not be treated as executable liquidity.

## Per-position trace

### hoods

- Address: `0xa1dafdefcf115e15632f5d69950ac4b52ce2ee52`
- Token quantity: 409881.35683523666; exact units: `409881356835236675132219`; decimals: 18
- Launch block time: 2026-09-26T16:56:30.000Z; launch age at observation: 2047.397s
- Entry: 2026-09-26T16:56:39.000Z; position age: 2038.397s
- Last historical attempt event (completion, not start): 2026-09-26T17:30:10.380Z; historical exact start was not recorded.
- Manual attempt: 2026-09-26T17:30:37.003Z; completion: 2026-09-26T17:30:37.397Z
- Last persisted successful sell: Never; quote age at observation: Never; block: None
- Persisted consecutive failures: 51; saved underlying reason: INSUFFICIENT_EXIT_LIQUIDITY
- Current observed block: 73263261; block time: 2026-09-26T17:30:37.000Z
- Full sell input: `409881356835236675132219` base units
- Gross required: 688318550541766 wei; real available: 1 wei; net mathematical output: 653902623014679 wei (NOT executable when liquidity validation fails).
- ETH/USD: AVAILABLE, bid 2688.24, timestamp 2026-09-26T17:30:35.298817286Z
- Factory phase: CURVE; identity/decimals checks passed before liquidity test.
- Result: NOT_PAPER_TRADABLE / INSUFFICIENT_EXIT_LIQUIDITY
- Validated USD liquidation at observation: UNAVAILABLE; no current executable value
- Raw contract responses and pinned call inputs: corresponding `positions[].result.diagnostics.rpc` in the JSON report. Pons has no sell-quote view function; output is computed from those reads.

### NETWORK

- Address: `0x16ff148dbc95a7c4160149cf0e68d6f2ea8164ac`
- Token quantity: 271089.9897897362; exact units: `271089989789736212617457`; decimals: 18
- Launch block time: 2026-09-26T16:56:14.000Z; launch age at observation: 2063.770s
- Entry: 2026-09-26T16:56:42.206Z; position age: 2035.564s
- Last historical attempt event (completion, not start): 2026-09-26T17:30:10.704Z; historical exact start was not recorded.
- Manual attempt: 2026-09-26T17:30:37.426Z; completion: 2026-09-26T17:30:37.770Z
- Last persisted successful sell: 2026-09-26T16:59:46.057Z; quote age at observation: 1851.713s; block: 73244874
- Persisted consecutive failures: 46; saved underlying reason: INSUFFICIENT_EXIT_LIQUIDITY
- Current observed block: 73263266; block time: 2026-09-26T17:30:37.000Z
- Full sell input: `271089989789736212617457` base units
- Gross required: 455307753481374 wei; real available: 16344081 wei; net mathematical output: 441648520876934 wei (NOT executable when liquidity validation fails).
- ETH/USD: AVAILABLE, bid 2688.24, timestamp 2026-09-26T17:30:35.298817286Z
- Factory phase: CURVE; identity/decimals checks passed before liquidity test.
- Result: NOT_PAPER_TRADABLE / INSUFFICIENT_EXIT_LIQUIDITY
- Validated USD liquidation at observation: UNAVAILABLE; no current executable value
- Raw contract responses and pinned call inputs: corresponding `positions[].result.diagnostics.rpc` in the JSON report. Pons has no sell-quote view function; output is computed from those reads.

### $REVOKE

- Address: `0x45e2c6805531491d2b96a89553860b5227dd6b50`
- Token quantity: 645841.6633850894; exact units: `645841663385089369255543`; decimals: 18
- Launch block time: 2026-09-26T16:56:06.000Z; launch age at observation: 2072.166s
- Entry: 2026-09-26T16:56:45.361Z; position age: 2032.805s
- Last historical attempt event (completion, not start): 2026-09-26T17:30:11.097Z; historical exact start was not recorded.
- Manual attempt: 2026-09-26T17:30:37.786Z; completion: 2026-09-26T17:30:38.166Z
- Last persisted successful sell: 2026-09-26T17:30:11.097Z; quote age at observation: 27.069s; block: 73263000
- Persisted consecutive failures: 0; saved underlying reason: None
- Current observed block: 73263268; block time: 2026-09-26T17:30:37.000Z
- Full sell input: `645841663385089369255543` base units
- Gross required: 1179587821354252 wei; real available: 72277881263333162 wei; net mathematical output: 1167791943140710 wei (NOT executable when liquidity validation fails).
- ETH/USD: AVAILABLE, bid 2688.24, timestamp 2026-09-26T17:30:35.298817286Z
- Factory phase: CURVE; identity/decimals checks passed before liquidity test.
- Result: AVAILABLE / validated full-position sell
- Validated USD liquidation at observation: 3.1393050132285816
- Raw contract responses and pinned call inputs: corresponding `positions[].result.diagnostics.rpc` in the JSON report. Pons has no sell-quote view function; output is computed from those reads.

### THECARDWALL

- Address: `0x3fc63daf84f0e2a13a0206b5bb32ad3ae38b19c3`
- Token quantity: 406881.43365695374; exact units: `406881433656953733440164`; decimals: 18
- Launch block time: 2026-09-26T17:04:24.000Z; launch age at observation: 1574.498s
- Entry: 2026-09-26T17:05:11.268Z; position age: 1527.230s
- Last historical attempt event (completion, not start): 2026-09-26T17:30:11.427Z; historical exact start was not recorded.
- Manual attempt: 2026-09-26T17:30:38.173Z; completion: 2026-09-26T17:30:38.498Z
- Last persisted successful sell: 2026-09-26T17:10:23.150Z; quote age at observation: 1215.348s; block: 73251196
- Persisted consecutive failures: 30; saved underlying reason: INSUFFICIENT_EXIT_LIQUIDITY
- Current observed block: 73263273; block time: 2026-09-26T17:30:38.000Z
- Full sell input: `406881433656953733440164` base units
- Gross required: 683282793466786 wei; real available: 7009802 wei; net mathematical output: 662784309662784 wei (NOT executable when liquidity validation fails).
- ETH/USD: AVAILABLE, bid 2688.24, timestamp 2026-09-26T17:30:35.298817286Z
- Factory phase: CURVE; identity/decimals checks passed before liquidity test.
- Result: NOT_PAPER_TRADABLE / INSUFFICIENT_EXIT_LIQUIDITY
- Validated USD liquidation at observation: UNAVAILABLE; no current executable value
- Raw contract responses and pinned call inputs: corresponding `positions[].result.diagnostics.rpc` in the JSON report. Pons has no sell-quote view function; output is computed from those reads.

### CLANKCAP

- Address: `0x91db55e83f88de1d5da026ebe2a4f55bed6d8d08`
- Token quantity: 1255299.966393095; exact units: `1255299966393095046707635`; decimals: 18
- Launch block time: 2026-09-26T17:15:15.000Z; launch age at observation: 923.817s
- Entry: 2026-09-26T17:15:28.714Z; position age: 910.103s
- Last historical attempt event (completion, not start): 2026-09-26T17:30:11.742Z; historical exact start was not recorded.
- Manual attempt: 2026-09-26T17:30:38.510Z; completion: 2026-09-26T17:30:38.817Z
- Last persisted successful sell: Never; quote age at observation: Never; block: None
- Persisted consecutive failures: 22; saved underlying reason: INSUFFICIENT_EXIT_LIQUIDITY
- Current observed block: 73263276; block time: 2026-09-26T17:30:38.000Z
- Full sell input: `1255299966393095046707635` base units
- Gross required: 2106259955489059 wei; real available: 6 wei; net mathematical output: 2043072156824388 wei (NOT executable when liquidity validation fails).
- ETH/USD: AVAILABLE, bid 2688.24, timestamp 2026-09-26T17:30:35.298817286Z
- Factory phase: CURVE; identity/decimals checks passed before liquidity test.
- Result: NOT_PAPER_TRADABLE / INSUFFICIENT_EXIT_LIQUIDITY
- Validated USD liquidation at observation: UNAVAILABLE; no current executable value
- Raw contract responses and pinned call inputs: corresponding `positions[].result.diagnostics.rpc` in the JSON report. Pons has no sell-quote view function; output is computed from those reads.

## Manual repeat: $REVOKE

TOKEN: $REVOKE

ADDRESS: `0x45e2c6805531491d2b96a89553860b5227dd6b50`

LAUNCH TIME: 2026-09-26T16:56:06.000Z

LAUNCH AGE: 2073.216s

ENTRY TIME: 2026-09-26T16:56:45.361Z

POSITION AGE: 2033.855s

TOKEN QUANTITY: 645841.6633850894 (exact `645841663385089369255543` units)

CURRENT BLOCK: 73263279

LAST QUOTE ATTEMPT: 2026-09-26T17:30:38.825Z

LAST SUCCESSFUL QUOTE: 2026-09-26T17:30:39.216Z (manual, not persisted)

QUOTE AGE AT COMPLETION: 0.000s; block age 1.216s

FAILURE COUNT: 0 persisted, both manual attempts successful

SELL QUOTE INPUT: `645841663385089369255543` units

RAW SELL QUOTE OUTPUT: computed `1167791943140710` wei; raw RPC hex is in `manualRepeat.result.diagnostics.rpc`

ETH OUT: 0.00116779194314071

ETH/USD: $2688.26 bid at 2026-09-26T17:30:38.159426671Z

USD LIQUIDATION VALUE AT OBSERVATION: $3.139328369067

STATUS: AVAILABLE at observation; must expire normally after validation windows.

## Hypotheses checked

1. Polling stopped: not supported by saved events; repeated failures and successful $REVOKE updates were recorded.
2. Sell calculation failure: four real-reserve validation failures; $REVOKE calculations succeed.
3. Units/decimals: exact entry integers retained; on-chain decimals 18, formatted quantities agree.
4. Insufficient liquidity: confirmed for four positions by raw reads.
5. ETH/USD stale: not during these reads; fresh source timestamps.
6. RPC failure: sandbox blocked initial probe; authorized external reads succeeded. No evidence that RPC caused the four observed liquidity failures.
7. Freshness too short: no evidence to loosen 30-second validation.
8. Poll interval too long: previous work + 15-second sleep could exceed 30 seconds; scheduling now independent.
9. Quote cache reuse: curve state not cached; each attempt read a new block. USD cache is bounded to five seconds and validates source age.
10. Sell math bug: documented formula and integer order match; no math change made.
11. Wrong curve: identity and factory checks passed.
12. Graduation: all five factory states CURVE, ready/graduated checks passed.

## Changes

Independent 15-second position monitoring, concurrent positions with no overlapping attempt for the same position, immediate per-position persistence, and discovery network work outside the store lock. Exact failure reasons, attempt metadata, raw read evidence, source status, verified launch time, and calculation retained. UI separates launch/position/quote ages; stale sell marks are LAST VALUE with stale P&L; no successful sell means NO SELL VALUE. Exit conditions continue to require a second validated full-position quote, with EXIT_PENDING_QUOTE on failure. Strategy, sizing, thresholds and quote freshness limits unchanged. No transactions, commits, pushes or merges.

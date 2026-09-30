# Verified launch-age investigation

Implemented and enabled on the local PAPER desk. No commits, pushes, merges, wallets,
signing, real transactions, sizing changes, or exit-strategy changes.

## Finding

There are two separate behaviors, not evidence of a days-old new-entry bug:

1. `fetchLiveSnapshot` rescans `[head - 24999, head]` **on every refresh**, not just
   startup. It sorts factory `TokenLaunched` events and researches the newest 24.
   `observeSnapshot` deduplicated only the snapshot's `fetchedAt`, not individual
   launch events. A new snapshot therefore reconsidered the same original events.
   Fresh handoff timestamps described research time, not launch time.
2. Existing PAPER positions persist and receive sell-quote monitoring. The oldest
   retained position inspected, NETWORK, was entered while fresh. Its current age
   does not show that PAPER entered an old launch. It currently cannot obtain a
   sufficient full-quantity exit-liquidity quote; the existing exit behavior is unchanged.

Before this change the entry policy required completed WATCH, executable quotes and
risk checks, but no launch age and no distinction between live events and historical
context. An old original event could therefore pass the entry gate if the other
checks passed. The verified example of repeated entry consideration below is AVM,
which was minutes old, not days old. No several-days-old new entry was established.

## Exact old token inspected

All chain timestamps below are UTC. “Current” refers to the fixed proof head captured
on September 27, not the wall time at which this report is opened.

| Requested field | NETWORK |
|---|---|
| TOKEN | NETWORK |
| ADDRESS | `0x16ff148dbc95a7c4160149cf0e68d6f2ea8164ac` |
| LAUNCH BLOCK | 73,242,773 |
| LAUNCH TIMESTAMP | 2026-09-26 16:56:14 (`1790441774`) |
| CURRENT BLOCK | 74,320,540 |
| CURRENT TIMESTAMP | 2026-09-27 23:08:57 (`1790550537`) |
| CALCULATED AGE | 108,763 seconds = 30h 12m 43s |
| FIRST BLOCK SEEN BY THIS PROCESS | Earliest retained research audit head: 73,242,991; research timestamp 2026-09-26 16:56:37.106 |
| EVENT MODE | Not recorded by the old implementation; cannot honestly reconstruct the original session boundary. A replay under the new policy is BACKFILL. |
| WHY GPTHEIST PROCESSED IT | Its original factory launch event was in the rolling discovery window; verified market state received WATCH. |
| WHY PAPER POLICY CONSIDERED IT | At original entry it passed WATCH, quote and risk gates. Entry was 2026-09-26 16:56:42.206, just 28.206 seconds after launch. The entry quote's block 73,243,046 was timestamped 16:56:41, a chain age of 27 seconds. Today it is an existing position under monitoring, not an entry candidate. |
| RECENT VERIFIED ACTIVITY | Between blocks 74,319,540 (23:07:17) and 74,320,540 (23:08:57), real reserve stayed 16,344,081 wei, progress stayed 0 bps, creator tax stayed 200 bps and snipe tax stayed 0. WEAK: no net endpoint change; this does not prove zero intervening trades. |
| LAST VERIFIED ACTIVITY TIME | UNKNOWN. Endpoint state reads do not reveal the exact latest transaction time. |
| CLASSIFICATION | OTHER: retained fresh-entry position now old; not a proven stale new entry. |

## Exact repeated candidate inspected

| Requested field | AVM |
|---|---|
| ADDRESS | `0x6f48538fc1b79af9e7f56890e0da0582d763a272` |
| LAUNCH BLOCK | 74,316,450 |
| LAUNCH TIMESTAMP | 2026-09-27 23:02:06 (`1790550126`) |
| CURRENT BLOCK / TIMESTAMP | 74,320,540 / 2026-09-27 23:08:57 (`1790550537`) |
| CALCULATED AGE | 411 seconds = 6m 51s |
| FIRST BLOCK SEEN BY THIS PROCESS | Earliest retained research audit head: 74,316,587; timestamp 23:02:20.937 |
| EVENT MODE | Original implementation did not label it. The repeated scan is BACKFILL under the new chronology policy. |
| WHY GPTHEIST PROCESSED IT | Original launch event was reread by the rolling getLogs scan and remained among the newest 24. It was not triggered by a buy/sell event. |
| WHY PAPER POLICY CONSIDERED IT | WATCH passed; no age or backfill entry gate existed. It was still considered at 23:08:56.834. This inspection does not establish a fill for AVM. |
| RECENT VERIFIED ACTIVITY | Across the same 100-second interval, real reserve rose from 2,851,510,070,740,374,220 to 3,460,785,999,681,205,877 wei; progress rose from 6,789 to 8,239 bps. Creator/snipe taxes stayed 200/0 bps. VERIFIED state change, not fabricated volume or trade counts. |
| LAST VERIFIED ACTIVITY TIME | UNKNOWN exactly; at least one state change occurred within the measured interval. |
| CLASSIFICATION | OLD EVENT BACKFILL / repeated discovery. The older token also has verified recent state changes, but those changes did not cause discovery. |

For both tokens, isolated calls to the actual new `enterPaper` engine using these
verified timestamps returned **PAPER_REJECT / STALE_LAUNCH**, opening **zero** positions.
The checks did not touch the live account.

## Six possible causes assessed

- **Startup historical backfill:** yes, the first scan intentionally reads an older
  range; the same context scan also runs on each refresh. Previously it could feed entries.
- **Replayed/cached events:** repeated original events are returned by overlapping RPC
  ranges. The four-second snapshot cache does not turn an old token into a new launch;
  identical `fetchedAt` snapshots are skipped. Refreshed snapshots reprocessed events.
- **Persisted candidates:** stored decisions are display/audit history, not an entry
  queue. Persisted open positions are monitored for exits. That explains NETWORK.
- **Old RPC range:** a bounded trailing 25,000-block range, not an unbounded days-long
  replay. In the measured interval, 1,000 blocks took 100 seconds; at that observed
  cadence 25,000 blocks is about 42 minutes. Block counts are not used as launch ages.
- **Timestamp bug:** no mismatch found between decoded launch block and independently
  fetched chain header. The actual bug was missing age/chronology enforcement;
  UI/research timestamps were insufficient evidence of launch time.
- **New event involving an older token:** discovery queries the factory launch event,
  not trade events. AVM had fresh state changes independently, but these did not trigger
  its repeated selection. No relaunch or new-event explanation was established.

## Implementation and limits

- Candidates expose launch/current blocks and Unix-second chain timestamps, exact
  age difference, block hashes, first observed head, event mode, and recent traction.
  Headers must match requested block numbers; event block hashes, when provided, must
  match. Removed logs and events outside the requested range are rejected.
- Missing or inconsistent chronology fails closed (`UNVERIFIED_LAUNCH_AGE`). Legacy
  records retain unknown values rather than invented dates or first-seen blocks.
- `PAPER_MAX_LAUNCH_AGE_SECONDS` defaults to **300 seconds** and is configurable by
  environment on desk startup or the persisted paper config. It must be positive and
  finite. This is a configurable policy choice, not a claim about optimal profitability.
- First successful scan is BACKFILL. Only an unseen launch above the previously
  observed head can be LIVE. Replays, delayed older events and restarts are conservative
  BACKFILL. Head regressions cannot make an older event live.
- The engine enforces age/event mode before requesting entry quotes, and again on
  final entry/commit. Wall time may only tighten the age gate using the verified launch
  timestamp; it never supplies a launch timestamp. Stale head evidence also blocks entry.
- GPTHEIST VETO remains authoritative. Research still analyzes/displays backfill.
- Traction compares verified pinned market states within 300 seconds. Reserve/progress
  change is VERIFIED in either direction; unchanged endpoints are WEAK; unavailable,
  same-block, first-observation or distant comparisons are UNKNOWN. Tax deltas are
  explicit and do not by themselves establish buying activity. Exact last activity time,
  counts of buys/sells/participants, holders, social signals and volume remain unknown.
- Existing positions retain their plans and monitoring behavior. Entry age never
  triggers an exit. The local restart preserved all five position IDs and entry times.

## Evidence and validation

Compact chain headers/event identities, audited first observations, pinned market
states and actual engine rejections are saved in
[fixtures/launch-age-investigation.json](fixtures/launch-age-investigation.json).
Raw RPC proof files are in `runs/launch-age-proof.json` and
`runs/launch-activity-proof.json`; the read-only scripts are
`scripts/launch-age-diagnostics.mjs` and `scripts/launch-activity-diagnostics.mjs`.

The final full suite reported 107/109 passing. The two failures are the existing
CLI doctor allowlist mismatch: committed `package.json` includes both `codex` and
`viem`, while unchanged `src/cli.ts` permits only `viem`. No dependency changes were made.
The final focused launch-age, live discovery, PAPER flow and policy suites pass,
including additional three-day stale-launch and header-provenance regressions.
TypeScript build, browser JavaScript syntax and whitespace checks pass.

The local PAPER desk was restarted with an account backup at
`runs/paper/monitor-fix-backup-1790559342408.json`. Its first new scan recorded real
candidate ages and BACKFILL_EVENT rejections (for example MCAT at 150 seconds), while
GPTHEIST_VETO still took priority for vetoed launches. All five original positions
remained present with unchanged entry times.

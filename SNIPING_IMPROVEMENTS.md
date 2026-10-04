# Paper entry pipeline improvements — 2026-10-04

The running account had eight closed v3 paper trades, three wins (37.5%) and
−$2.34655 realized P&L when this work began. Its recent discovery snapshots were
roughly 23 seconds apart. Most recent rejections were insufficient traction,
GPTHEIST vetoes, expired launches or weak momentum. A profitable strategy has not
been established by these eight outcomes.

## Changes

- Start minimum-size, independently quoted BUY/SELL observation on the second
  verified inflow sample, while entry confirmation is still developing. Previously
  the liquidity observation window started only after the momentum filter passed.
  Observation cannot open a trade. Final entries still require their own sized,
  fresh quotes and every entry gate.
- Plan within the configured full-exit coverage and participation caps, and retry
  smaller amounts when actual coverage requires it. The 100× coverage requirement
  and 1% maximum exit participation remain unchanged. The initial quote uses the
  allocation cap rather than the larger account capacity.
- Evaluate the newest launches first. Space momentum confirmation samples by at
  least ten seconds so faster polling does not collapse the signal window. Invalid
  intervening samples and the latest reserve reversal still reject the entry.
- Preserve the 25,000-block context while incrementally fetching logs after a
  successful scan, with a 32-block overlap. Verify the previous canonical head
  before reuse; changed heads, rewinds, missing verification and window changes
  cause a full rebuild. Failed log requests cannot advance the cache.
- Reuse launch headers only when current source logs attest the cached hash;
  always fetch the current head. Read uncached headers concurrently. Refresh
  retained launches in batches of at most 24 with one shared head header.
- Skip discovery writes and quote work for identical cached snapshots. Position
  monitoring continues independently.
- Expose current live entry blockers and scan timing in `/api/paper` and the
  `/paper` status line. Terminal output records activity and actual rejection
  reasons. Discovery targets a four-second cadence without overlapping scans.

The running desk was restarted with `PAPER_QUOTE_REFRESH_MS=2000`, preserving its
environment and account. The original eight trade records were compared against
the restart backup and match exactly. Initial live verification showed healthy
RPC/monitor status; actual scan duration varied with quote work and persistence.

## Verification and limits

Regression coverage includes the complete production observation/entry flow,
unchanged VETO/BACKFILL/flat-launch rejection, reduced-size coverage admission,
fast-sample momentum and reversals, canonical-head changes and failed scans,
header reuse, retained-launch batching, and cached-snapshot idempotence.
The complete suite passes: 199 tests. Browser script and restart script syntax
checks and `git diff --check` also pass.

The matched-size historical replay still accepts one of 27 recorded trades,
closing at +$1.49452; 26 reject and none remain unresolved. This reproduces the
earlier tiny exploratory result, rather than establishing an improved win rate.
It cannot measure earlier entries when their exact-sized historical quote evidence
was never captured.

Local evidence is in `runs/sniping-improvement-2026-10-04/`: `baseline.json`,
`historical-replay.json` and `live-validation.json`. Account backups remain in
`runs/paper/`; historical fills and losses were not reset or rewritten. All
execution remains simulated. Prospective fills are needed to measure whether
the shorter confirmation delay and faster exits improve net P&L.

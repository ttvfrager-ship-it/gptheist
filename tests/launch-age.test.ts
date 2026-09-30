import assert from "node:assert/strict";
import test from "node:test";
import { launchEvidence, readHeader } from "../src/launch-evidence.js";
import { enterPaper, initialPaperState, liveCandidate, observeSnapshot, paperLaunchRejection, monitorPaper } from "../src/paper.js";
import { fixture } from "./paper-fixtures.js";
import { enterPaper as enterPaperWithFixtureLiquidity } from "./liquidity-history-fixture.js";
import type { RpcCaller } from "../src/live.js";

test("startup, repeated scans, new launch, replay and restart follow block chronology", async () => {
  const f = fixture();
  const rpc: RpcCaller = async (_m, p) => ({ number: p![0], timestamp: `0x${(1000 + Number(p![0])).toString(16)}`, hash: `0x${"a".repeat(64)}` });
  const read = (head: number, block = 1, token = f.launch.token) => launchEvidence(rpc, head, [{ ...f.launch, blockNumber: block, token }], [f.launch.market]);
  let e = (await read(2))[0]!;
  assert.equal(e.eventMode, "BACKFILL"); assert.equal(e.tokenAgeSeconds, 1); assert.equal(e.launchTimestamp, 1001);
  assert.equal(e.firstBlockSeenByProcess, 2); assert.equal(e.recentTraction.status, "UNKNOWN");
  e = (await read(3))[0]!;
  assert.equal(e.eventMode, "BACKFILL"); assert.equal(e.firstBlockSeenByProcess, 2); assert.equal(e.recentTraction.status, "WEAK");
  const newToken = `0x${"9".repeat(40)}`;
  assert.equal((await read(4, 4, newToken))[0]!.eventMode, "LIVE");
  assert.equal((await read(5, 4, newToken))[0]!.eventMode, "LIVE");
  assert.equal((await launchEvidence(async (...args) => rpc(...args), 5, [f.launch], [f.launch.market]))[0]!.eventMode, "BACKFILL");
  assert.equal((await read(2, 2, `0x${"8".repeat(40)}`))[0]!.eventMode, "BACKFILL");
});

test("missing, mismatched and future launch headers fail closed", async () => {
  assert.equal(await readHeader(async () => ({ number: "0x3", timestamp: "0x123", hash: `0x${"a".repeat(64)}` }), 2), null);
  const f = fixture();
  const [e] = await launchEvidence(async () => { throw new Error("offline"); }, 2, [f.launch], [f.launch.market]);
  assert.equal(e!.tokenAgeSeconds, null);
  const c = { ...liveCandidate(f.launch), ...e! };
  assert.equal(paperLaunchRejection(c, initialPaperState(f.time), f.time), "UNVERIFIED_LAUNCH_AGE");
});

test("stale and backfill reject before quotes, regardless of WATCH; VETO retains precedence", async () => {
  for (const stale of [false, true]) {
    const f = fixture(), s = initialPaperState(f.time);
    f.launch.chronology!.eventMode = "BACKFILL";
    if (stale) { f.launch.chronology!.launchTimestamp! -= 301; f.launch.chronology!.tokenAgeSeconds = 301; }
    let calls = 0;
    await observeSnapshot(s, f.snapshot, f.time, async () => { calls++; throw new Error("must not quote"); });
    assert.equal(calls, 0);
    assert.equal(s.positions.length, 0); assert.equal(s.decisions[0]!.outcome, "PAPER_REJECT");
    assert.equal(s.decisions[0]!.reason, stale ? "STALE_LAUNCH" : "BACKFILL_EVENT");
    const c = liveCandidate(f.launch); c.decision = "VETO";
    assert.equal(enterPaper(s, c, 10, f.time).reason, "GPTHEIST_VETO");
  }
});

test("age limit is configurable, inclusive, and rechecked at final entry", async () => {
  const f = fixture(), s = initialPaperState(f.time), c = liveCandidate(f.launch);
  const now = Math.floor(f.time / 1000) * 1000;
  c.launchTimestamp! -= 300; c.tokenAgeSeconds = 300;
  assert.equal(paperLaunchRejection(c, s, now), null);
  assert.equal(paperLaunchRejection(c, s, now + 1), "STALE_LAUNCH");
  s.config.PAPER_MAX_LAUNCH_AGE_SECONDS = 600;
  assert.equal(paperLaunchRejection(c, s, now + 1), null);
  c.tokenAgeSeconds = 0;
  assert.equal(paperLaunchRejection(c, s, now), "UNVERIFIED_LAUNCH_AGE");
});

test("crossing entry age never closes an existing position", async () => {
  const f = fixture(), s = initialPaperState(f.time), c = liveCandidate(f.launch);
  c.quote = await f.buy(10); assert.equal(enterPaperWithFixtureLiquidity(s, c, 10, f.time).outcome, "PAPER_BUY");
  s.config.PAPER_MAX_LAUNCH_AGE_SECONDS = 1;
  await monitorPaper(s, async () => ({ status: "NOT_PAPER_TRADABLE", reason: "TEST", details: [] }), () => f.time + 400_000);
  assert.equal(s.positions.length, 1); assert.equal(s.trades.length, 0);
});

test("traction uses actual reserve deltas; stale comparisons and missing reads stay unknown", async () => {
  const f = fixture(); let stamp = 1000;
  const rpc: RpcCaller = async (_m, p) => ({ number: p![0], timestamp: `0x${stamp.toString(16)}`, hash: `0x${"a".repeat(64)}` });
  await launchEvidence(rpc, 2, [f.launch], [structuredClone(f.launch.market)]);
  assert.equal(f.launch.market.status, "VERIFIED"); if (f.launch.market.status !== "VERIFIED") return;
  f.launch.market.realQuoteReserve = "5"; stamp++;
  const [e] = await launchEvidence(rpc, 3, [f.launch], [f.launch.market]);
  assert.equal(e!.recentTraction.status, "VERIFIED"); assert.equal(e!.recentTraction.reserveChangeWei, "-999999999999999995");
  assert.equal(e!.recentTraction.lastVerifiedActivityTime, null);
  stamp += 301;
  assert.equal((await launchEvidence(rpc, 4, [f.launch], [f.launch.market]))[0]!.recentTraction.status, "UNKNOWN");
});

test("three-day launch with fresh WATCH and quote cannot open a position", async () => {
  const f = fixture(), s = initialPaperState(f.time), c = liveCandidate(f.launch);
  c.launchTimestamp! -= 3 * 86400; c.tokenAgeSeconds = 3 * 86400; c.quote = await f.buy(10);
  assert.equal(enterPaper(s, c, 10, f.time).reason, "STALE_LAUNCH");
  assert.equal(s.positions.length, 0); assert.equal(s.cash, 1000);
});

test("launch timestamp after head and mismatched event hash are not verified", async () => {
  const f = fixture();
  const rpc: RpcCaller = async (_m, p) => ({ number: p![0], timestamp: Number(p![0]) === 1 ? "0x200" : "0x100", hash: `0x${"a".repeat(64)}` });
  assert.equal((await launchEvidence(rpc, 2, [f.launch], [f.launch.market]))[0]!.launchTimestamp, null);
  f.launch.blockHash = `0x${"b".repeat(64)}`;
  assert.equal((await launchEvidence(async (_m,p) => ({number:p![0],timestamp:"0x100",hash:`0x${"a".repeat(64)}`}), 2, [f.launch], [f.launch.market]))[0]!.launchTimestamp, null);
});

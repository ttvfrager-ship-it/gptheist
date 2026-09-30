import assert from "node:assert/strict";
import test from "node:test";
import { initialPaperState, liveCandidate, observeCandidateTraction } from "../src/paper.js";
import { observeSnapshot } from "../src/paper.js";
import { fixture } from "./paper-fixtures.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaperStore } from "../src/paper-store.js";

test("traction accumulates verified distinct-block observations for the same LIVE launch", () => {
  const f = fixture(), state = initialPaperState(f.time), candidate = liveCandidate(f.launch);
  let clock = f.time;
  const sample = (block: number, reserve: bigint, progressBps: number) => {
    clock += 5_000;
    candidate.currentBlock = block;
    candidate.currentTimestamp = Math.floor(clock / 1000);
    candidate.currentBlockHash = `0x${String(block).padStart(64, "0")}`;
    const market = candidate.launch!.market;
    assert.equal(market.status, "VERIFIED");
    if (market.status !== "VERIFIED") throw new Error("fixture market unavailable");
    candidate.launch!.market = { ...market, realQuoteReserve: reserve.toString(), progressBps };
    return observeCandidateTraction(state, candidate, { ...f.snapshot, headBlock: block,
      fetchedAt: new Date(clock).toISOString() }, () => clock);
  };
  const first = sample(10, 100n, 1000);
  assert.equal(first.tractionPass, false);
  assert.equal(first.exactFailureReason, "TRACTION_HISTORY_INSUFFICIENT");
  assert.equal(first.observations.length, 1);
  assert.equal(first.observations[0]!.verificationStatus, "VERIFIED");
  const second = sample(11, 110n, 1010);
  assert.equal(second.tractionPass, false);
  assert.equal(second.observations.length, 2);
  const third = sample(12, 120n, 1020);
  assert.equal(third.tractionPass, true);
  assert.equal(third.observations.length, 3);
  assert.equal(third.positiveReserveChangeDetected, true);
  assert.equal(third.positiveCurveChangeDetected, true);
  assert.equal(new Set(third.observations.map(row => row.block)).size, 3);
  assert.ok(third.observations.every(row => row.token === candidate.tokenAddress));
});

test("unverified state is logged but never contributes to traction", () => {
  const f = fixture(), state = initialPaperState(f.time), candidate = liveCandidate(f.launch);
  candidate.currentBlock = f.snapshot.headBlock;
  candidate.currentTimestamp = Math.floor(f.time / 1000);
  candidate.currentBlockHash = null;
  const result = observeCandidateTraction(state, candidate, f.snapshot, () => f.time);
  assert.equal(result.observationCount, 1);
  assert.equal(result.verifiedObservationCount, 0);
  assert.equal(result.observations[0]!.verificationStatus, "UNAVAILABLE");
  assert.equal(result.observations[0]!.reserve, null);
  assert.equal(result.tractionPass, false);
  assert.equal(result.exactFailureReason, "TRACTION_HISTORY_INSUFFICIENT");
});

test("OBSERVING LIVE launch remains retained and is reevaluated on later snapshots", async () => {
  const f = fixture(), state = initialPaperState(f.time);
  for (let i = 0; i < 3; i++) {
    const now = f.time + i * 5_000, block = 20 + i;
    const launch = structuredClone(f.launch);
    const market = launch.market;
    assert.equal(market.status, "VERIFIED");
    if (market.status !== "VERIFIED") throw new Error("fixture market unavailable");
    launch.market = { ...market, realQuoteReserve: String(100n + BigInt(i * 10)), progressBps: 1000 + i * 10 };
    launch.chronology = { ...launch.chronology!, eventMode: "LIVE", currentBlock: block,
      currentTimestamp: Math.floor(now / 1000), currentBlockHash: `0x${String(block).padStart(64, "0")}`,
      tokenAgeSeconds: Math.floor(now / 1000) - launch.chronology!.launchTimestamp! };
    await observeSnapshot(state, { ...f.snapshot, headBlock: block, fetchedAt: new Date(now).toISOString(), launches: [launch] }, now);
  }
  const id = `${f.launch.transactionHash}:${f.launch.logIndex}`;
  assert.equal(state.researchLedger![id]!.eventMode, "LIVE");
  assert.equal(state.researchLedger![id]!.observations, 3);
  assert.ok(state.tractionWatchlist?.[id]);
  assert.equal(state.tractionHistory![id]!.length, 3);
  assert.ok(state.events.some(event => event.eventType === "CANDIDATE_TRACTION_EVALUATED" &&
    event.metadata.tractionPass === true));
});

test("legacy persisted LIVE decision restores candidate identity without inventing sample history", async () => {
  const f = fixture(), directory = await mkdtemp(join(tmpdir(), "traction-restore-"));
  let store = await PaperStore.open(directory);
  try {
    const candidate = liveCandidate(f.launch);
    await store.update(state => {
      state.decisions.push({ outcome: "OBSERVING", reason: "INSUFFICIENT_TRACTION", details: [],
        timestamp: new Date(f.time).toISOString(), candidate, sizeUsd: 1, gptheistVerdict: "WATCH", paperVerdict: "OBSERVING" });
      state.lastObservedHeadBlock = null;
      delete state.tractionHistory;
      delete state.tractionWatchlist;
    });
    await store.close();
    store = await PaperStore.open(directory);
    const restored = store.read(), id = candidate.launchId;
    assert.equal(restored.lastObservedHeadBlock, candidate.currentBlock);
    assert.equal(restored.researchLedger?.[id]?.eventMode, "LIVE");
    assert.equal(restored.tractionWatchlist?.[id]?.token, candidate.tokenAddress);
    assert.deepEqual(restored.tractionHistory?.[id] ?? [], []);
  } finally { await store.close(); }
});

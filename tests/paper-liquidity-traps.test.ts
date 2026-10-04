import { seedEntryQuality } from "./liquidity-history-fixture.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaperStore } from "../src/paper-store.js";
import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./paper-fixtures.js";
import { enterPaper, initialPaperState, liveCandidate, monitorPaper, markPaperPosition, preparePaperTrade, PAPER_CONFIG } from "../src/paper.js";
import { sellObservation, appendLiquidityObservation, ExitLiquiditySafetyGate } from "../src/paper-liquidity.js";
import { readPaperQuote } from "../src/paper-quotes.js";

async function setup() {
  const f = fixture(), buy = await f.buy();
  if (buy.status !== "AVAILABLE") throw new Error("fixture");
  const state = initialPaperState(f.time), c = liveCandidate(f.launch); c.quote = buy;
  const sell = buy.quote.roundTrip!.sell, o = sellObservation(sell, 10)!;
  const history = [2, 1, 0].map(i => ({ ...o, block: o.block - i, timestamp: new Date(Date.parse(o.timestamp) - i * 15000).toISOString(),
    realQuoteReserveWei: String(BigInt(o.realQuoteReserveWei)*BigInt(100-i*5)/100n),
    quoteReserveWei: String(BigInt(o.quoteReserveWei)-BigInt(o.realQuoteReserveWei)+BigInt(o.realQuoteReserveWei)*BigInt(100-i*5)/100n),
    tokenReserveRaw: String(BigInt(o.tokenReserveRaw)*BigInt(100+i*5)/100n) }));
  state.liquidityHistory = { [c.launchId]: history };
  seedEntryQuality(state, c, buy.quote);
  return { f, buy, state, c, sell, o, history };
}
test("A: strong real coverage and three distinct block observations admit exact full round trip", async () => {
  const { f, state, c, buy } = await setup();
  assert.equal(enterPaper(state, c, 10, f.time).outcome, "PAPER_BUY");
  const p = state.positions[0]!;
  assert.equal(p.entry.evidence!.amountOut, p.entry.roundTrip!.sell.evidence!.amountIn);
  assert.equal(p.plan.exitLiquiditySafety!.observations.length, 3);
  assert.ok(p.plan.exitLiquiditySafety!.current.exitCoverageRatio >= 100);
  assert.equal(p.plan.exitLiquiditySafety!.current.realQuoteReserveWei, buy.quote.roundTrip!.sell.evidence!.realQuoteReserve);
});
test("B: BUY available but exact full SELL fails; cash and positions remain unchanged", async () => {
  const { f, state, c } = await setup(); f.state.real = 1n;
  c.quote = await f.buy();
  const result = enterPaper(state, c, 10, f.time);
  assert.equal(result.outcome, "PAPER_REJECT"); assert.equal(result.reason, "INSUFFICIENT_EXIT_LIQUIDITY");
  assert.ok(result.details.some(d => d.includes("availableEthWei=1")));
  assert.equal(state.positions.length, 0); assert.equal(state.cash, 1000);
});
test("C: executable full SELL below configured coverage rejects with numbers", async () => {
  const { f, state, c, o } = await setup(); state.config.MIN_EXIT_COVERAGE_RATIO = 1000;
  const r = enterPaper(state, c, 10, f.time);
  assert.equal(r.reason, "EXIT_COVERAGE_TOO_LOW");
  assert.ok(r.details.some(d => d.includes(`positionExitWei=${o.positionExitWei}`) && d.includes("configuredMinimum=1000")));
  assert.equal(state.positions.length, 0);
});
test("planning finds a smaller executable allocation within the unchanged exit-coverage limit", async () => {
  const { f, state, c } = await setup();
  state.config.MIN_EXIT_COVERAGE_RATIO = 1000;
  const sizes: number[] = [];
  await preparePaperTrade(state, c, async (_launch, size) => { sizes.push(size); return f.buy(size); }, () => f.time);
  assert.equal(state.positions.length, 1);
  const p = state.positions[0]!;
  assert.ok(p.sizeUsd <= 2); assert.ok(p.sizeUsd >= state.config.MIN_POSITION_USD);
  assert.ok(p.plan.exitLiquiditySafety!.current.exitCoverageRatio >= 1000);
  assert.equal(state.config.MIN_EXIT_COVERAGE_RATIO, 1000);
  assert.ok(sizes.filter(size => size === p.sizeUsd).length >= 2);
});
test("D: measured peak-to-current decline rejects even if current coverage is strong", async () => {
  const { f, state, c, history } = await setup(); history[0]!.realQuoteReserveWei = "2000000000000000000";
  const r = enterPaper(state, c, 10, f.time);
  assert.equal(r.reason, "LIQUIDITY_DERIORATING"); assert.ok(r.details.some(d => d.includes("peakDropPercent=50")));
});
test("missing, duplicate, reversed or too-short histories never admit", async () => {
  for (const mode of ["missing", "duplicate", "reversed", "short"] as const) {
    const { f, state, c, history, o } = await setup();
    state.liquidityHistory![c.launchId] = mode === "missing" ? [] : mode === "duplicate" ? [o,o,o] : mode === "reversed" ? [...history].reverse() : history.map(x => ({...x,timestamp:o.timestamp}));
    assert.equal(enterPaper(state,c,10,f.time).reason,"LIQUIDITY_HISTORY_INSUFFICIENT",mode);
    assert.equal(state.positions.length,0);
  }
});
test("duplicate block reads do not manufacture observations; conflicting block hash resets history", async () => {
  const { o, history } = await setup();
  assert.equal(appendLiquidityObservation(history,o,PAPER_CONFIG).length,3);
  assert.equal(appendLiquidityObservation(history,{...o,blockHash:`0x${"f".repeat(64)}`},PAPER_CONFIG).length,1);
});
test("E: collapse after entry triggers a distinct final SELL; unexecutable position stays open", async () => {
  const { f, state, c } = await setup(); enterPaper(state,c,10,f.time);
  const p = state.positions[0]!, cash = state.cash, value = p.current.notionalUsd;
  f.state.real = 1n;
  let calls = 0;
  await monitorPaper(state, async () => { calls++; return readPaperQuote(f.rpc,async()=>f.state.usd,f.launch,
    {side:"SELL",tokenUnits:p.entry.tokenUnits!,quantity:p.quantity,tokenDecimals:18},()=>f.time); },()=>f.time);
  assert.equal(calls,2); assert.equal(state.positions.length,1); assert.equal(state.trades.length,0); assert.equal(state.cash,cash);
  assert.equal(p.management.exitExecutionStatus,"EXIT_TRIGGERED_BUT_UNEXECUTABLE");
  assert.equal(p.markReason,"INSUFFICIENT_EXIT_LIQUIDITY"); assert.equal(p.current.notionalUsd,value);
  assert.equal(p.management.liquidity!.current.executableUsd,null);
});
test("E: material reserve decline with fresh executable final quote produces simulated exit", async () => {
  const { f, state, c } = await setup(); enterPaper(state,c,10,f.time); const p=state.positions[0]!;
  f.state.real = 500000000000000000n;
  let calls=0;
  await monitorPaper(state,async()=>{calls++;return readPaperQuote(f.rpc,async()=>f.state.usd,f.launch,
    {side:"SELL",tokenUnits:p.entry.tokenUnits!,quantity:p.quantity,tokenDecimals:18},()=>f.time);},()=>f.time);
  assert.equal(calls,2); assert.equal(state.positions.length,0); assert.equal(state.trades.length,1);
  assert.equal(state.trades[0]!.exitReason,"LIQUIDITY_OR_QUOTE_DETERIORATION");
});
test("F/G: near-zero REAL reserve overrides large virtual pricing reserve", async () => {
  const { o, history } = await setup();
  const empty = {...o,realQuoteReserveWei:"1",quoteReserveWei:"99999999999999999999999999",sellResult:"INSUFFICIENT_EXIT_LIQUIDITY",executableUsd:null};
  const safety=ExitLiquiditySafetyGate(empty,[...history.slice(0,2),empty],PAPER_CONFIG);
  assert.equal(safety.reason,"INSUFFICIENT_EXIT_LIQUIDITY");
  const tiny={...o,positionExitWei:"1000",netSellWei:"990",realQuoteReserveWei:"1000000",exitCoverageRatio:1000,positionParticipation:.001};
  assert.equal(ExitLiquiditySafetyGate(tiny,[tiny],PAPER_CONFIG).reason,"REAL_LIQUIDITY_TOO_LOW");
});
test("stale reserve diagnostics cannot trigger a new liquidity decision", async () => {
  const { f,state,c }=await setup();enterPaper(state,c,10,f.time);const p=state.positions[0]!;f.state.real=1n;
  const result=await readPaperQuote(f.rpc,async()=>f.state.usd,f.launch,{side:"SELL",tokenUnits:p.entry.tokenUnits!,quantity:p.quantity},()=>f.time);
  markPaperPosition(state,p.id,result,f.time+60000);
  assert.equal(p.management.pendingExit,null);assert.equal(state.trades.length,0);
});
test("configuration refuses one-observation admission and impossible windows",()=>{
  assert.throws(()=>initialPaperState(Date.now(),{...PAPER_CONFIG,LIQUIDITY_OBSERVATION_COUNT:1}));
  assert.throws(()=>initialPaperState(Date.now(),{...PAPER_CONFIG,LIQUIDITY_OBSERVATION_WINDOW_MS:1}));
});


test("actual entry pipeline accumulates separate pinned quote blocks across persistence restart", async () => {
  const f = fixture(), directory = await mkdtemp(join(tmpdir(), "trap-history-"));
  let store = await PaperStore.open(directory), now = f.time;
  try {
    for (let step = 0; step < 3; step++) {
      now = f.time + step * 15000;
      f.state.headBlock = 100 + step;
      f.state.reserve = (20n+BigInt(step*2))*10n**17n; f.state.real = (10n+BigInt(step*2))*10n**17n;
      f.state.blockTime = Math.floor(now / 1000); f.state.usd.timestamp = new Date(now).toISOString();
      const c = liveCandidate(f.launch);
      c.currentBlock = f.state.headBlock; c.currentTimestamp = f.state.blockTime;
      c.tokenAgeSeconds = c.currentTimestamp - c.launchTimestamp!;
      c.recentTraction.toTimestamp = c.currentTimestamp;
      c.tractionDiagnostics = { observationCount: 3, verifiedObservationCount: 3, observations: [],
        tractionWindowSeconds: store.read().config.TRACTION_WINDOW_SECONDS, positiveReserveChangeDetected: true,
        positiveCurveChangeDetected: true, tractionPass: true, exactFailureReason: null };
      seedEntryQuality(store.read(), c);
      await store.update(state => preparePaperTrade(state, c, (_launch,size) => readPaperQuote(f.rpc,async()=>f.state.usd,f.launch,{side:"BUY",sizeUsd:size},()=>now),()=>now));
      const saved = store.read();
      assert.equal(saved.liquidityHistory![c.launchId]!.length,step+1);
      assert.equal(saved.positions.length,step===2?1:0);
      if (step<2) assert.equal(saved.decisions.at(-1)!.reason,"LIQUIDITY_HISTORY_INSUFFICIENT");
      if (step===0) { await store.close(); store=await PaperStore.open(directory); }
    }
    const p=store.read().positions[0]!;
    assert.deepEqual(p.plan.exitLiquiditySafety!.observations.map(o=>o.block),[100,101,102]);
    assert.ok(p.plan.exitLiquiditySafety!.observations.every(o=>o.sizeUsd===p.sizeUsd));
  } finally { await store.close(); }
});

import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./paper-fixtures.js";
import { entryExecutionQuality, PAPER_STRATEGY } from "../src/paper-strategy.js";
import { sellObservation } from "../src/paper-liquidity.js";
import { initialPaperState, liveCandidate } from "../src/paper.js";
import { seedLiquidityHistory, enterPaper } from "./liquidity-history-fixture.js";
import { researchMetrics } from "../src/paper-research.js";
async function setup(){const f=fixture(),r=await f.buy();if(r.status!=="AVAILABLE")throw Error("fixture");
  const current=sellObservation(r.quote.roundTrip!.sell)!;
  const prior={...current,block:current.block-1,timestamp:new Date(Date.parse(current.timestamp)-15000).toISOString(),
    quoteReserveWei:String(BigInt(current.quoteReserveWei)*9n/10n),tokenReserveRaw:String(BigInt(current.tokenReserveRaw)*11n/10n)};
  return {f,quote:r.quote,current,prior};}
test("v3 requires majority-real backing and momentum exceeding entry friction",async()=>{
  const s=await setup();let q=entryExecutionQuality(s.quote,[s.prior],s.f.time);
  assert.equal(q.passed,true);assert.equal(q.realReserveSharePercent,50);assert.ok(q.quoteMomentumPercent!>q.requiredMomentumPercent!);
  s.quote.roundTrip!.sell.evidence!.realQuoteReserve=String(9n*10n**17n);
  assert.equal(entryExecutionQuality(s.quote,[s.prior],s.f.time).reason,"ENTRY_VIRTUAL_RESERVE_DOMINATED");
});
test("flat quotes and small spot moves cannot justify paying round-trip fees",async()=>{
  const s=await setup();s.prior.quoteReserveWei=s.current.quoteReserveWei;s.prior.tokenReserveRaw=s.current.tokenReserveRaw;
  assert.equal(entryExecutionQuality(s.quote,[s.prior],s.f.time).reason,"ENTRY_MOMENTUM_BELOW_COST");
  s.prior.quoteReserveWei=String(BigInt(s.current.quoteReserveWei)*99n/100n);
  assert.equal(entryExecutionQuality(s.quote,[s.prior],s.f.time).reason,"ENTRY_MOMENTUM_BELOW_COST");
});
test("independent ETH/token ratios prevent USD changes from inventing momentum",async()=>{
  const s=await setup();s.prior.quoteReserveWei=s.current.quoteReserveWei;s.prior.tokenReserveRaw=s.current.tokenReserveRaw;
  s.quote.roundTrip!.sell.notionalUsd=s.quote.notionalUsd*.99;
  assert.equal(entryExecutionQuality(s.quote,[s.prior],s.f.time).quoteMomentumPercent,0);
});
test("future, duplicate, stale, wrong-curve and failed observations cannot confirm momentum",async()=>{
  const s=await setup();
  const bad=[{...s.prior,timestamp:new Date(s.f.time+1000).toISOString()},
    {...s.prior,block:s.current.block},{...s.prior,timestamp:new Date(s.f.time-120000).toISOString()},
    {...s.prior,curve:`0x${"9".repeat(40)}`},{...s.prior,sellResult:"INSUFFICIENT_EXIT_LIQUIDITY"}];
  for(const row of bad)assert.equal(entryExecutionQuality(s.quote,[row],s.f.time).reason,"ENTRY_QUOTE_MOMENTUM_UNCONFIRMED");
});
test("profit-target validation includes unavailable and losing open positions",async()=>{
  const s=await setup(),state=initialPaperState(s.f.time),c=liveCandidate(s.f.launch);c.quote={status:"AVAILABLE",quote:s.quote};
  seedLiquidityHistory(state,c,s.quote);assert.equal(enterPaper(state,c,10,s.f.time).outcome,"PAPER_BUY");const p=state.positions[0]!;
  assert.equal(p.plan.strategyVersion,PAPER_STRATEGY.version);
  state.trades=Array.from({length:30},(_,i)=>({...structuredClone(p),id:`closed-${i}`,exit:p.current,exitedAt:new Date(s.f.time).toISOString(),
    pnlUsd:.05,returnPercent:.5,exitReason:"TRAILING_EXIT" as const,exitReasoning:[]}));
  p.markStatus="UNAVAILABLE";
  let v=researchMetrics(state,s.f.time).strategyValidation;
  assert.equal(v.winRatePercent,100);assert.equal(v.status,"UNVERIFIED_OPEN_EXPOSURE");assert.equal(v.netLiquidationPnlUsd,null);
  p.markStatus="FRESH";p.current.notionalUsd=1;p.current.fillPriceUsd=1/p.quantity;
  v=researchMetrics(state,s.f.time).strategyValidation;
  assert.equal(v.status,"BELOW_TARGET");assert.ok(v.netLiquidationPnlUsd!<0);
});

test("unavailable holdings use zero sizing value, keep full exposure and retain saved marks",async()=>{
  const {accountCapacity}=await import("../src/paper-policy.js");
  const s=await setup(),state=initialPaperState(s.f.time),c=liveCandidate(s.f.launch);c.quote={status:"AVAILABLE",quote:s.quote};
  enterPaper(state,c,10,s.f.time);const p=state.positions[0]!,before=structuredClone(p);
  p.markStatus="UNAVAILABLE";p.current.notionalUsd=1000000;p.current.fillPriceUsd=p.current.notionalUsd/p.quantity;
  const capacity=accountCapacity(state,s.f.time);
  assert.equal(capacity.equityUsd,state.cash);assert.equal(capacity.exposureUsd,p.costBasisUsd);
  assert.equal(capacity.unavailablePositions,1);assert.ok(capacity.availableCapacityUsd>0);
  assert.equal(p.current.notionalUsd,1000000);assert.deepEqual(p.entry,before.entry);
  p.costBasisUsd=state.cash;
  assert.equal(accountCapacity(state,s.f.time).availableCapacityUsd,0);
});

test("an expired mark cannot inflate sizing capital even when marked FRESH",async()=>{
  const {accountCapacity}=await import("../src/paper-policy.js");
  const s=await setup(),state=initialPaperState(s.f.time),c=liveCandidate(s.f.launch);c.quote={status:"AVAILABLE",quote:s.quote};
  enterPaper(state,c,10,s.f.time);const p=state.positions[0]!;
  assert.equal(p.markStatus,"FRESH");
  assert.equal(accountCapacity(state,s.f.time+60000).equityUsd,state.cash);
  assert.equal(p.markStatus,"FRESH");
});

test("a conservatively budgeted unavailable holding does not block a separate executable entry",async()=>{
  const s=await setup(),state=initialPaperState(s.f.time),c=liveCandidate(s.f.launch);c.quote={status:"AVAILABLE",quote:s.quote};
  assert.equal(enterPaper(state,c,10,s.f.time).outcome,"PAPER_BUY");
  // A separate synthetic legacy holding, with internally matching token identities.
  const old=JSON.parse(JSON.stringify(state.positions[0]).replaceAll(c.tokenAddress,`0x${"9".repeat(40)}`));
  old.id="legacy-unavailable";old.launchId="legacy-launch";old.markStatus="UNAVAILABLE";
  state.positions=[old];const before=structuredClone(old);
  assert.equal(enterPaper(state,c,10,s.f.time).outcome,"PAPER_BUY");
  assert.equal(state.positions.length,2);assert.deepEqual(state.positions[0],before);
});

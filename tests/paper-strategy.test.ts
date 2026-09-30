import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./paper-fixtures.js";
import { enterPaper } from "./liquidity-history-fixture.js";
import { entryQuality, entryRegimeRejection, PAPER_STRATEGY } from "../src/paper-strategy.js";
import { initialPaperState, liveCandidate, markPaperPosition, monitorPaper, type Candidate } from "../src/paper.js";
import { proposeTradePlan, evaluateExit } from "../src/paper-policy.js";
import { researchMetrics } from "../src/paper-research.js";
function signal(reserves: number[]) {
  const f = fixture(), candidate = liveCandidate(f.launch);
  candidate.currentBlock = 20;
  candidate.tractionDiagnostics = { observationCount: reserves.length, verifiedObservationCount: reserves.length,
    tractionWindowSeconds: 300, positiveReserveChangeDetected: true, positiveCurveChangeDetected: true, tractionPass: true, exactFailureReason: null,
    observations: reserves.map((r,i)=>({ token:candidate.tokenAddress,symbol:candidate.symbol,sourceEventId:candidate.launchId,block:20-reserves.length+i+1,
      blockHash:`0x${"b".repeat(64)}`, timestamp:new Date(f.time-(reserves.length-i-1)*15000).toISOString(),reserve:String(BigInt(r)*10n**16n),
      previousReserve:null,reserveDelta:null,reserveDeltaPct:null,curveProgressBps:1000+i*10,previousCurveProgressBps:null,
      curveProgressDeltaBps:null,verificationStatus:"VERIFIED",quoteStatus:"AVAILABLE" })) };
  return { f, candidate };
}
test("entry needs consistent recent inflows; an old pump, flat tail and single spike fail", () => {
  for (const reserves of [[100,150,140,130,120],[100,110,120,120,120],[100,100,100,100,150],[100,100.5]]) {
    // Use integer samples in this deterministic fixture.
    const s=signal(reserves.map(Math.floor));assert.equal(entryQuality(s.candidate,undefined,s.f.time).passed,false);
  }
  const s=signal([80,85,90,95,100]);assert.equal(entryQuality(s.candidate,undefined,s.f.time).passed,true);
});
test("entry rejects future, duplicate-block and unverified confirmation evidence", () => {
  for(const change of [
    (c:Candidate,time:number)=>{c.tractionDiagnostics!.observations.at(-1)!.timestamp=new Date(time+1).toISOString();},
    (c:Candidate)=>{c.tractionDiagnostics!.observations.at(-1)!.block=c.tractionDiagnostics!.observations.at(-2)!.block;},
    (c:Candidate)=>{c.tractionDiagnostics!.observations[1]!.verificationStatus="UNAVAILABLE";}
  ]){const s=signal([80,85,90,95,100]);change(s.candidate,s.f.time);assert.equal(entryQuality(s.candidate,undefined,s.f.time).reason,"ENTRY_CONFIRMATION_INVALID");}
});
test("entry rejects expensive round trips, separated prices and fresh reserve reversal", async () => {
  const s=signal([80,85,90,95,100]),result=await s.f.buy();assert.equal(result.status,"AVAILABLE");if(result.status!=="AVAILABLE")return;
  const q=result.quote;
  q.roundTrip!.sell.notionalUsd=q.notionalUsd*.90;
  assert.equal(entryQuality(s.candidate,q,s.f.time).reason,"ENTRY_FRICTION_TOO_HIGH");
  q.roundTrip!.sell.notionalUsd=q.notionalUsd*1.02;
  assert.equal(entryQuality(s.candidate,q,s.f.time).reason,"ENTRY_PRICE_MOVED");
  q.roundTrip!.sell.notionalUsd=q.notionalUsd*.98;q.evidence!.realQuoteReserve=String(9n*10n**17n);
  assert.equal(entryQuality(s.candidate,q,s.f.time).reason,"ENTRY_SIGNAL_REVERSED");
});
test("v2 protects executable 6% gains and requires a fresh final quote", async () => {
  const s=signal([80,85,90,95,100]),state=initialPaperState(s.f.time);s.candidate.quote=await s.f.buy();
  assert.equal(enterPaper(state,s.candidate,10,s.f.time).outcome,"PAPER_BUY");const p=state.positions[0]!;
  const quote=structuredClone(p.current);quote.notionalUsd=p.costBasisUsd*1.06;quote.fillPriceUsd=quote.notionalUsd/p.quantity;
  markPaperPosition(state,p.id,{status:"AVAILABLE",quote},s.f.time);
  assert.ok(p.management.peakReturnPercent!>=5.99);assert.equal(p.management.state,"RUNNER");
  quote.notionalUsd=p.costBasisUsd*1.02;quote.fillPriceUsd=quote.notionalUsd/p.quantity;
  let calls=0;
  await monitorPaper(state,async()=>++calls===1?{status:"AVAILABLE",quote}:{status:"NOT_PAPER_TRADABLE",reason:"QUOTE_UNAVAILABLE",details:[]},()=>s.f.time);
  assert.equal(calls,2);assert.equal(state.trades.length,0);assert.equal(p.management.pendingExit?.reason,"PROFIT_PROTECTION");
});
test("v2 exits stagnant negative positions; legacy plans retain their original rules", async () => {
  const s=signal([80,85,90,95,100]),state=initialPaperState(s.f.time);s.candidate.quote=await s.f.buy();
  enterPaper(state,s.candidate,10,s.f.time);const p=state.positions[0]!;
  assert.equal(p.plan.strategyVersion,PAPER_STRATEGY.version);assert.equal(evaluateExit(p,s.f.time+120000)?.reason,"STAGNATION_EXIT");
  delete p.plan.exitPolicy.stagnationMs;delete p.plan.exitPolicy.profitFloorPercent;delete p.plan.strategyVersion;
  assert.equal(evaluateExit(p,s.f.time+120000),null);
  assert.equal(researchMetrics(state).strategyValidation.closedTrades,0);
});
test("plans account for round-trip loss inside the stop distance and preserve cash risk caps", async () => {
  const s=signal([80,85,90,95,100]),state=initialPaperState(s.f.time),r=await s.f.buy();if(r.status!=="AVAILABLE")throw Error("fixture");
  const p=proposeTradePlan(state,s.candidate,r.quote,s.f.time);
  assert.ok(p.exitPolicy.downsidePercent>r.quote.roundTrip!.lossPercent);
  assert.ok(p.proposedSizeUsd*p.exitPolicy.downsidePercent/100<=p.riskBudgetUsd+.01);
  assert.ok(p.proposedSizeUsd<=state.config.STARTING_BALANCE_USD*.005);
  assert.ok(p.exitPolicy.profitArmPercent<=6);assert.ok(p.exitPolicy.maxHoldMs<=600000);
});


test("three v2 losses pause entries without using future exits or legacy losses", async () => {
  const s=signal([80,85,90,95,100]),state=initialPaperState(s.f.time);s.candidate.quote=await s.f.buy();
  enterPaper(state,s.candidate,10,s.f.time);const p=state.positions[0]!;
  state.trades=[1,2,3].map(i=>({...structuredClone(p),id:`loss-${i}`,exit:p.current,exitedAt:new Date(s.f.time-i*1000).toISOString(),
    pnlUsd:-1,returnPercent:-10,exitReason:"DYNAMIC_RISK_EXIT" as const,exitReasoning:[]}));
  assert.equal(entryRegimeRejection(state,s.f.time),"STRATEGY_LOSS_STREAK_PAUSE");
  assert.equal(entryRegimeRejection(state,s.f.time+900000),null);
  state.trades[0]!.exitedAt=new Date(s.f.time+1000).toISOString();assert.equal(entryRegimeRejection(state,s.f.time),null);
  delete state.trades[0]!.plan.strategyVersion;assert.equal(entryRegimeRejection(state,s.f.time+1000),null);
  assert.equal(state.positions.length,1);
});

test("validation requires enough new trades and positive net PnL, with old history retained", async () => {
  const s=signal([80,85,90,95,100]),state=initialPaperState(s.f.time);s.candidate.quote=await s.f.buy();
  enterPaper(state,s.candidate,10,s.f.time);const p=state.positions[0]!;
  state.trades=Array.from({length:30},(_,i)=>({...structuredClone(p),id:`validation-${i}`,exit:p.current,
    exitedAt:new Date(s.f.time+i).toISOString(),pnlUsd:i<20?1:-3,returnPercent:i<20?10:-30,
    exitReason:"DYNAMIC_RISK_EXIT" as const,exitReasoning:[]}));
  let v=researchMetrics(state).strategyValidation;
  assert.ok(v.winRatePercent!>50);assert.equal(v.status,"BELOW_TARGET");
  state.trades.forEach(t=>{if(t.pnlUsd<0)t.pnlUsd=-.5;});
  assert.equal(researchMetrics(state).strategyValidation.status,"TARGET_MET");
  delete state.trades[0]!.plan.strategyVersion;
  v=researchMetrics(state).strategyValidation;
  assert.equal(v.closedTrades,29);assert.equal(v.status,"COLLECTING_EVIDENCE");assert.equal(state.trades.length,30);
});

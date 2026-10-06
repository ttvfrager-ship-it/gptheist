import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture } from "./paper-fixtures.js";
import { enterPaper } from "./liquidity-history-fixture.js";
import { accountSummary, performance, initialPaperState, liveCandidate, monitorPaper, isPaperTradeEligible, dailyRealizedLoss, observeSnapshot, markPaperPosition } from "../src/paper.js";
import { retainPaperState, collectionCounts, candidateLifecycle, RETENTION } from "../src/paper-retention.js";
import { entryRegimeRejection } from "../src/paper-strategy.js";
import { PaperStore } from "../src/paper-store.js";
import { PaperService } from "../src/paper-service.js";

function observing(reason="INSUFFICIENT_TRACTION") {
  const f=fixture(), s=initialPaperState(f.time), c=liveCandidate(f.launch);
  s.tractionWatchlist={[c.launchId]:f.launch};
  s.researchLedger={[c.launchId]:{firstObservedAt:new Date(f.time).toISOString(),lastObservedAt:new Date(f.time).toISOString(),observations:1,lastResult:reason,traded:false,eventMode:"LIVE",sourceEventId:c.launchId,sourceEventTimestampMs:f.launch.chronology!.launchTimestamp!*1000}};
  s.tractionHistory={[c.launchId]:[{token:c.tokenAddress,symbol:c.symbol,sourceEventId:c.launchId,block:2,blockHash:null,timestamp:new Date(f.time).toISOString(),reserve:"1",previousReserve:null,reserveDelta:null,reserveDeltaPct:null,curveProgressBps:1,previousCurveProgressBps:null,curveProgressDeltaBps:null,verificationStatus:"VERIFIED",quoteStatus:"TEST"}]};
  return {f,s,c};
}
test("permanent rejection releases heavy state immediately; tombstone expires at original launch deadline",()=>{
  const {f,s,c}=observing("UNSUPPORTED_PAIR");
  assert.equal(candidateLifecycle(s,c.launchId,f.time),"REJECTED");
  const archive=retainPaperState(s,f.time);
  assert.ok(archive.watchlist[c.launchId]); assert.equal(s.tractionWatchlist?.[c.launchId],undefined); assert.equal(s.tractionHistory?.[c.launchId],undefined);
  assert.ok(s.researchLedger?.[c.launchId]);
  retainPaperState(s,f.time+s.config.PAPER_MAX_LAUNCH_AGE_SECONDS*1000+1);
  assert.equal(s.researchLedger?.[c.launchId],undefined);
});
test("temporary momentum and traction failures retain original eligibility window, then expire",()=>{
  for(const reason of ["INSUFFICIENT_TRACTION","ENTRY_MOMENTUM_WEAK"]) {
    const {f,s,c}=observing(reason);
    retainPaperState(s,f.time); assert.equal(candidateLifecycle(s,c.launchId,f.time),"OBSERVING"); assert.ok(s.tractionWatchlist?.[c.launchId]);
    const expired=f.time+s.config.PAPER_MAX_LAUNCH_AGE_SECONDS*1000+1;
    assert.equal(candidateLifecycle(s,c.launchId,expired),"EXPIRED"); retainPaperState(s,expired);
    assert.equal(collectionCounts(s).activeCandidates,0); assert.equal(collectionCounts(s).candidateObservations,0);
  }
});
test("activity, decisions, raw frames and intermediate quote observations remain bounded",()=>{
  const {f,s,c}=observing();
  for(let i=0;i<5000;i++) s.events.push({timestamp:new Date(f.time).toISOString(),category:"PAPER",stage:"PAPER",tokenAddress:null,tokenSymbol:null,eventType:i%2?"PAPER_LAB_FRAME":"TEST",message:"",metadata:{quote:{payload:"x".repeat(100)}}});
  const archive=retainPaperState(s,f.time); assert.equal(s.events.length,RETENTION.events); assert.equal(archive.events.length,4800);
  assert.ok(!s.events.some(e=>e.eventType==="PAPER_LAB_FRAME"));
  retainPaperState(s,f.time+s.config.TRACTION_WINDOW_SECONDS*1000+1); assert.equal(s.tractionHistory?.[c.launchId],undefined);
});
test("open position, saved plan and V4 eligibility decisions are identical across retention",async()=>{
  const f=fixture(),s=initialPaperState(f.time),c=liveCandidate(f.launch); c.quote=await f.buy();
  enterPaper(s,c,10,f.time); assert.equal(s.positions.length,1);
  const position=structuredClone(s.positions),account=accountSummary(s);
  s.config.PAPER_STRATEGY_VERSION=4;
  const before=isPaperTradeEligible(c,s,2.5,f.time);
  retainPaperState(s,f.time+s.config.PAPER_MAX_LAUNCH_AGE_SECONDS*1000+1);
  assert.deepEqual(s.positions,position); assert.deepEqual(accountSummary(s),account);
  assert.deepEqual(isPaperTradeEligible(c,s,2.5,f.time),before);
});
test("closed audit trades persist across restart; account, costs, drawdown and decision gates match",async()=>{
  const f=fixture(),s=initialPaperState(f.time),c=liveCandidate(f.launch); c.quote=await f.buy(); enterPaper(s,c,10,f.time);
  s.positions[0]!.plan.exitPolicy.maxHoldMs=1;
  await monitorPaper(s,async p=>({status:"AVAILABLE",quote:p.current}),()=>f.time+2);
  assert.equal(s.trades.length,1);
  const t=s.trades[0]!;
  s.trades=Array.from({length:140},()=>({...structuredClone(t),id:randomUUID()}));
  s.cash=s.config.STARTING_BALANCE_USD+s.trades.reduce((n,t)=>n+t.pnlUsd,0);
  s.history=Array.from({length:400},(_,i)=>({timestamp:new Date(f.time+i).toISOString(),equity:1000+(i%100)-50,stalePositions:0}));
  const archivedId=s.trades[0]!.id;
  const before=accountSummary(s),stats=performance(s),loss=dailyRealizedLoss(s,f.time),regime=entryRegimeRejection(s,f.time+2);
  const directory=await mkdtemp(join(tmpdir(),"retention-history-")); let store=await PaperStore.open(directory,()=>f.time+2);
  try {
    await store.update(state=>{Object.assign(state,s);}); const saved=store.read();
    assert.equal(saved.trades.length,100); assert.deepEqual(accountSummary(saved),before);
    for(const [key,value] of Object.entries(stats)) { const actual=performance(saved)[key as keyof typeof stats]; if(typeof value==="number" && typeof actual==="number") assert.ok(Math.abs(actual-value)<1e-8,key); else assert.deepEqual(actual,value,key); }
    assert.equal(dailyRealizedLoss(saved,f.time),loss); assert.equal(entryRegimeRejection(saved,f.time+2),regime);
    const page=await store.historicalTrades(); assert.equal(page.trades.length,40);
    assert.ok((await readFile(join(directory,saved.archiveTradeHead!),"utf8")).includes(archivedId));
    await store.close(); store=await PaperStore.open(directory,()=>f.time+2);
    assert.equal(store.read().trades.length,100); assert.equal((await store.historicalTrades()).trades.length,40);
    assert.ok(Math.abs(accountSummary(store.read()).realizedPnl-before.realizedPnl)<1e-8);
  } finally {await store.close();await rm(directory,{recursive:true,force:true});}
});
test("persisted chronology rejects replay after tombstone eviction",async()=>{
  const {f,s,c}=observing("BACKFILL_EVENT");
  s.lastObservedHeadBlock=100; s.researchLedger![c.launchId]!.eventMode="BACKFILL";
  retainPaperState(s,f.time+s.config.PAPER_MAX_LAUNCH_AGE_SECONDS*1000+1);
  const snapshot={...f.snapshot,headBlock:101,fetchedAt:new Date(f.time+1000000).toISOString(),launches:[{...f.launch,chronology:{...f.launch.chronology!,eventMode:"BACKFILL" as const}}]};
  await observeSnapshot(s,snapshot,f.time+1000000);
  assert.equal(s.positions.length,0); assert.notEqual(s.decisions.at(-1)?.outcome,"PAPER_ELIGIBLE");
});
test("candidate observation owns no timer; service initialization and shutdown clean all timers and retries",async()=>{
  const f=fixture(),directory=await mkdtemp(join(tmpdir(),"retention-timers-")),store=await PaperStore.open(directory);
  const service=new PaperService(store,async()=>f.snapshot,async()=>({status:"NOT_PAPER_TRADABLE",reason:"TEST",details:[]}));
  service.start(); service.start(); await service.tick(); await service.close();
  const internal=service as unknown as {timer?:NodeJS.Timeout;monitorTimer?:NodeJS.Timeout;memoryTimer?:NodeJS.Timeout;retryAfter:Map<string,number>;inFlight:Map<string,unknown>;sellTape:unknown[]};
  for(const timer of [internal.timer,internal.monitorTimer,internal.memoryTimer]) if(timer) assert.equal((timer as unknown as {_destroyed:boolean})._destroyed,true);
  assert.equal(internal.retryAfter.size,0);assert.equal(internal.inFlight.size,0);assert.equal(internal.sellTape.length,0);
  await rm(directory,{recursive:true,force:true});
});
test("20,000 discovery cycles plateau and expired rejection state is released",()=>{
  const {f,s}=observing(); s.tractionWatchlist={};s.researchLedger={};s.tractionHistory={};
  let plateau:ReturnType<typeof collectionCounts>|undefined;
  for(let i=0;i<20000;i++) {
    const now=f.time+i*4000,id=`launch-${i}`;
    s.researchLedger![id]={firstObservedAt:new Date(now).toISOString(),lastObservedAt:new Date(now).toISOString(),observations:1,lastResult:"BACKFILL_EVENT",traded:false,eventMode:"BACKFILL",sourceEventTimestampMs:now};
    s.events.push({timestamp:new Date(now).toISOString(),category:"PAPER",stage:"PAPER",tokenAddress:null,tokenSymbol:null,eventType:"TEST",message:"",metadata:{}});
    s.history.push({timestamp:new Date(now).toISOString(),equity:1000,stalePositions:0});
    retainPaperState(s,now);
    if(i===10000) plateau=collectionCounts(s);
  }
  assert.deepEqual(collectionCounts(s),plateau);assert.equal(s.events.length,200);assert.equal(s.history.length,250);
});

test("2,000 open-position quote refreshes retain bounded evidence and never evict the holding",async()=>{
  const f=fixture(),s=initialPaperState(f.time),c=liveCandidate(f.launch);c.quote=await f.buy();enterPaper(s,c,10,f.time);
  const p=s.positions[0]!,plan=structuredClone(p.plan),entry=structuredClone(p.entry);
  for(let i=0;i<2000;i++) {
    const now=f.time+i*4000,q=structuredClone(p.current),stamp=new Date(now).toISOString();
    q.timestamp=stamp;q.blockTimestamp=stamp;q.blockNumber=100+i;if(q.evidence)q.evidence.usdTimestamp=stamp;
    assert.equal(markPaperPosition(s,p.id,{status:"AVAILABLE",quote:q},now),true);
    retainPaperState(s,now);
    assert.equal(s.positions.length,1);assert.ok(s.events.length<=RETENTION.events);assert.ok(s.history.length<=RETENTION.equity);
    assert.ok((p.management.liquidity?.observations.length??0)<=24);
  }
  assert.deepEqual(p.plan,plan);assert.deepEqual(p.entry,entry);assert.ok(p.management.lastSuccessfulQuote);
});

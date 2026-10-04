// Matched-size counterfactual: observed full-position SELL reads only, never inferred prices or rewritten fills.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { PAPER_CONFIG, initialPaperState, markPaperPosition, monitorPaper, quoteProblem } from '../dist/src/paper.js';
import { initialManagement, proposeTradePlan } from '../dist/src/paper-policy.js';
import { entryQuality, entryExecutionQuality, entryPolicyConfig, PAPER_SCALP_STRATEGY, PAPER_STRATEGY, PAPER_STRATEGY_V2 } from '../dist/src/paper-strategy.js';
const [input='runs/strategy-v2/tape.json',output='runs/strategy-v3/replay.json',version='3']=process.argv.slice(2);
if(!['2','3','4'].includes(version))throw Error('Version must be 2, 3 or 4');
const policy=version==='4'?PAPER_SCALP_STRATEGY:version==='2'?{...PAPER_STRATEGY,...PAPER_STRATEGY_V2}:PAPER_STRATEGY;
if(resolve(output)===resolve('runs/paper/state.json')||resolve(output)===resolve(input))throw Error('Replay output must be separate from evidence and account');
const tape=JSON.parse(await readFile(input,'utf8'));
const ordered=[...tape.trades].sort((a,b)=>Date.parse(a.enteredAt)-Date.parse(b.enteredAt));
const outcomes=[];
for(const original of ordered){
  const now=Date.parse(original.enteredAt), config={...PAPER_CONFIG,PAPER_STRATEGY_VERSION:version==='4'?4:3};
  const candidate=structuredClone(original.candidate), entryConfig=entryPolicyConfig(config);
  if(version==='4' && candidate.tractionDiagnostics){
    candidate.tractionDiagnostics.tractionWindowSeconds=entryConfig.TRACTION_WINDOW_SECONDS;
    candidate.tractionDiagnostics.observations=candidate.tractionDiagnostics.observations.filter(r=>now-Date.parse(r.timestamp)<=entryConfig.TRACTION_WINDOW_SECONDS*1000);
  }
  const quality=entryQuality(candidate,original.entry,now,policy);
  const executionQuality = version!=='2' ? entryExecutionQuality(original.entry,original.plan.exitLiquiditySafety?.observations??[],now,policy) : null;
  const row={executionQuality,symbol:original.symbol,id:original.id,enteredAt:original.enteredAt,originalPnlUsd:original.pnlUsd,quality};
  if(!quality.passed || (executionQuality && !executionQuality.passed)){outcomes.push({...row,status:'ENTRY_REJECTED'});continue;}
  const state=initialPaperState(now,config);
  const p=structuredClone(original);delete p.exit;delete p.exitedAt;delete p.pnlUsd;delete p.returnPercent;delete p.exitReason;delete p.exitReasoning;
  p.candidate=candidate;
  p.plan={...proposeTradePlan(state,p.candidate,p.entry,now),approvedSizeUsd:p.sizeUsd,strategyVersion:policy.version};
  p.management=initialManagement();p.current=structuredClone(p.entry);p.markStatus='UNAVAILABLE';p.markReason='REPLAY_AWAITING_QUOTE';
  state.positions=[p];state.cash-=p.costBasisUsd;
  if(p.entry.roundTrip)markPaperPosition(state,p.id,{status:'AVAILABLE',quote:p.entry.roundTrip.sell},now);
  // Only quotes from the original holding window are valid for this exact amount.
  const reads=tape.quotes.filter(r=>r.quote.tokenAddress.toLowerCase()===p.tokenAddress.toLowerCase()&&r.quote.tokenUnits===p.entry.tokenUnits&&
    Date.parse(r.observedAt)>=now&&Date.parse(r.observedAt)<=Date.parse(original.exitedAt)&&Date.parse(r.quote.timestamp)<=Date.parse(r.observedAt));
  let index=0,clock=now;
  while(index<reads.length&&state.positions.length){
    await monitorPaper(state,async()=>{
      const next=reads[index++];
      if(!next)return {status:'NOT_PAPER_TRADABLE',reason:'REPLAY_FINAL_QUOTE_MISSING',details:[]};
      clock=Date.parse(next.observedAt);
      const problem=quoteProblem(next.quote,clock,state.config.QUOTE_MAX_AGE_MS,state.config.ETH_USD_MAX_AGE_MS);
      return problem?{status:'NOT_PAPER_TRADABLE',reason:problem,details:[]}:{status:'AVAILABLE',quote:next.quote};
    },()=>clock);
  }
  const trade=state.trades[0];
  outcomes.push({...row,status:trade?'CLOSED':'UNRESOLVED',pnlUsd:trade?.pnlUsd??null,returnPercent:trade?.returnPercent??null,
    exitReason:trade?.exitReason??null,exitAt:trade?.exitedAt??null,quotesConsumed:index,originalSizeUsd:p.sizeUsd});
}
function metrics(rows,key){const values=rows.filter(r=>Number.isFinite(r[key])).map(r=>r[key]);const wins=values.filter(v=>v>0),losses=values.filter(v=>v<0);return {trades:values.length,wins:wins.length,winRatePercent:values.length?wins.length/values.length*100:null,netPnlUsd:values.reduce((a,b)=>a+b,0),profitFactor:losses.length?wins.reduce((a,b)=>a+b,0)/-losses.reduce((a,b)=>a+b,0):null};}
const midpoint=Math.floor(outcomes.length/2);
const report={generatedAt:new Date().toISOString(),policy,
  method:'Exploratory rules informed by this history; same historical entry sizes and exact recorded full-balance sell quotes; two separate exit reads; no interpolation. Not a prospective, independent holdout or full-opportunity backtest. Isolates entry quality and exits; excludes new size caps and portfolio cooldowns.',
  baseline:metrics(outcomes,'originalPnlUsd'),counterfactual:metrics(outcomes,'pnlUsd'),
  earlierPeriod:metrics(outcomes.slice(0,midpoint),'pnlUsd'),laterPeriod:metrics(outcomes.slice(midpoint),'pnlUsd'),
  rejected:outcomes.filter(r=>r.status==='ENTRY_REJECTED').length,unresolved:outcomes.filter(r=>r.status==='UNRESOLVED').length,outcomes};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,outcomes:undefined},null,2));

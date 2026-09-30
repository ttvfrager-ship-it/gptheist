// Isolated PAPER account, read-only chain requests, no HTTP server or signing.
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchLiveSnapshot, DEFAULT_RPC_URL } from '../dist/src/live.js';
import { initialPaperState, observeSnapshot, monitorPaper } from '../dist/src/paper.js';
import { PaperQuoteService } from '../dist/src/paper-quotes.js';
const state = initialPaperState(), methods = {}, attempts = [], snapshots = [];
const directory = `runs/liquidity-traps-${Date.now()}`;
await mkdir(directory, { recursive: true });
let id = 0;
const rpc = async (method, params = []) => {
  if (!['eth_chainId','eth_blockNumber','eth_getLogs','eth_call','eth_getBlockByNumber'].includes(method)) throw new Error('Read-only method required');
  methods[method] = (methods[method] ?? 0) + 1;
  const response = await fetch(process.env.RPC_URL ?? DEFAULT_RPC_URL, {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',id:++id,method,params}), signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  return result.result;
};
const quotes = new PaperQuoteService(rpc,state.config);
let failure = null;
try {
  for (let cycle=0;cycle<12;cycle++) {
    const snapshot = await fetchLiveSnapshot(rpc); snapshots.push(snapshot);
    await monitorPaper(state,p=>quotes.sell(p));
    const start = state.decisions.length;
    await observeSnapshot(state,snapshot,Date.now(),(launch,size)=>quotes.buy(launch,size),Date.now);
    const decisions = state.decisions.slice(start).filter(d=>d.candidate.eventMode==='LIVE' && d.candidate.tractionDiagnostics);
    for(const d of decisions) {
      const q=d.candidate.quote.status==='AVAILABLE'?d.candidate.quote.quote:null;
      const sell=q?.roundTrip?.sell, e=q?.evidence, se=sell?.evidence;
      const row={token:d.candidate.tokenAddress,symbol:d.candidate.symbol,launchAgeSeconds:d.candidate.tokenAgeSeconds,
        block:se?sell.blockNumber:d.candidate.currentBlock,proposedUsd:d.sizeUsd,ethInputWei:e?.amountIn??null,
        buyRawTokenOutput:e?.amountOut??null,sellRawTokenInput:se?.amountIn??null,sellRawEthOutput:se?.amountOut??null,
        realExitReserveWei:se?.realQuoteReserve??null,roundTripUsd:q?.roundTrip?.immediateExitUsd??null,
        roundTripCostPercent:q?.roundTrip?.lossPercent??null,outcome:d.outcome,reason:d.reason,details:d.details,
        observationCount:d.candidate.tractionDiagnostics.observationCount,
        verifiedObservationCount:d.candidate.tractionDiagnostics.verifiedObservationCount,
        tractionWindowSeconds:d.candidate.tractionDiagnostics.tractionWindowSeconds,
        positiveReserveChangeDetected:d.candidate.tractionDiagnostics.positiveReserveChangeDetected,
        positiveCurveChangeDetected:d.candidate.tractionDiagnostics.positiveCurveChangeDetected,
        tractionPass:d.candidate.tractionDiagnostics.tractionPass,
        exactFailureReason:d.candidate.tractionDiagnostics.exactFailureReason,
        observations:d.candidate.tractionDiagnostics.observations,
        sizingAttempts:d.plan?.sizingAttempts??[]};
      attempts.push(row); console.log(JSON.stringify(row));
    }
    if(cycle<11) for(let i=0;i<3;i++) { await new Promise(r=>setTimeout(r,5000)); await monitorPaper(state,p=>quotes.sell(p)); }
  }
} catch(error) { failure={message:error.message,cause:error.cause?.message??null,code:error.cause?.code??error.code??null}; }
const latestByToken = new Map();
for (const d of state.decisions.filter(row=>row.candidate.eventMode==='LIVE')) latestByToken.set(d.candidate.tokenAddress.toLowerCase(),d);
const outcomes=[...latestByToken.values()];
const counts={liveCandidates:latestByToken.size,
  insufficientTraction:outcomes.filter(d=>d.reason==='INSUFFICIENT_TRACTION').length,
  sizeNotExecutable:outcomes.filter(d=>d.reason==='SIZE_NOT_EXECUTABLE').length,
  backfillEvent:state.decisions.filter(d=>d.reason==='BACKFILL_EVENT').length,
  gptheistVeto:outcomes.filter(d=>d.candidate.decision==='VETO'||d.reason==='GPTHEIST_VETO').length,
  executablePaperEntry:state.positions.length+state.trades.length};
await writeFile(`${directory}/report.json`,JSON.stringify({completedAt:new Date().toISOString(),failure,methods,attempts,snapshots,counts,state},null,2));
console.log(JSON.stringify({directory,failure,counts,methods,transactions:0}));
if(failure) process.exitCode=1;

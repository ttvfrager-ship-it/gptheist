// Read-only audit of the saved account. Never opens a writer or changes paper state.
import { readFile, writeFile } from 'node:fs/promises';
import { createHttpRpcCaller } from '../dist/src/server.js';
import { readPaperExitQuote, createEthUsdProvider } from '../dist/src/paper-quotes.js';
const state = JSON.parse(await readFile('runs/paper/state.json', 'utf8'));
const rpc = createHttpRpcCaller();
const usd = createEthUsdProvider();
const report = { observedAt: new Date().toISOString(), config: state.config, positions: [] };
for (const p of state.positions) {
  const attempt = () => readPaperExitQuote(rpc, p, usd, Date.now, state.config);
  const result = await attempt();
  const row = {symbol:p.symbol,address:p.tokenAddress,quantity:p.quantity,tokenUnits:p.entry.tokenUnits,entryTime:p.enteredAt,positionAgeSeconds:(Date.now()-Date.parse(p.enteredAt))/1000,lastSuccessfulQuote:p.management.lastSuccessfulQuote,consecutiveFailures:p.management.consecutiveQuoteFailures,savedFailure:p.markReason,lastHistoricalAttempt:state.events.filter(e=>e.tokenAddress===p.tokenAddress&&['QUOTE_UNAVAILABLE','SELL_QUOTE_UPDATED'].includes(e.eventType)).at(-1)?.timestamp??null,result};
  report.positions.push(row);
  console.log(JSON.stringify({symbol:p.symbol,status:result.status,reason:result.reason,block:result.diagnostics?.currentBlock,launch:result.diagnostics?.launchTimestamp,calculation:result.diagnostics?.calculation,usd:result.diagnostics?.ethUsd,quote:result.quote}));
}
const debug = state.positions.find(p=>p.symbol==='$REVOKE')??state.positions[0];
if(debug) report.manualRepeat = {symbol:debug.symbol,result:await readPaperExitQuote(rpc, debug, createEthUsdProvider(), Date.now, state.config)};
await writeFile('runs/position-diagnostics.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({report:'runs/position-diagnostics.json',repeat:report.manualRepeat}));

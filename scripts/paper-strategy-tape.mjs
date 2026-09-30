// Read-only extraction of archived executable quotes; never opens the account writer.
import fs from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const root=process.argv[2] ?? 'runs/paper';
const output=process.argv[3] ?? 'runs/strategy-v2/tape.json';
if (resolve(output) === resolve(root, 'state.json')) throw Error('Account state cannot be an extraction output');
const state=JSON.parse(await fs.readFile(root+'/state.json','utf8'));
const addresses=new Set(state.trades.map(t=>t.tokenAddress.toLowerCase()));
const quotes=new Map();let files=0,events=0;
function collect(rows){for(const e of rows??[]){events++;if(!addresses.has(e.tokenAddress?.toLowerCase()))continue;const q=e.eventType==='SELL_QUOTE_UPDATED'?e.metadata?.quote:e.eventType==='SIMULATED_SELL'?e.metadata?.finalQuote:null;if(q){const key=[q.tokenAddress.toLowerCase(),q.tokenUnits,q.blockNumber,q.timestamp].join(':');quotes.set(key,{observedAt:e.timestamp,quote:q});}}}
const names=(await fs.readdir(root)).filter(n=>n.startsWith('audit-archive-'));
for(const name of names){collect(JSON.parse(await fs.readFile(root+'/'+name,'utf8')).events);if(++files%4000===0)console.log('scanned',files);}
collect(state.events);
await fs.mkdir(dirname(output), {recursive:true});
await fs.writeFile(output,JSON.stringify({capturedAt:new Date().toISOString(),trades:state.trades,quotes:[...quotes.values()].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)),files,events}));
console.log(JSON.stringify({trades:state.trades.length,quotes:quotes.size,files,events}));

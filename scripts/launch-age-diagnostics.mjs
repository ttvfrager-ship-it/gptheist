// Read-only chain proof. Does not load or mutate the running PAPER service.
import fs from 'node:fs';
import { createHttpRpcCaller } from '../dist/src/server.js';
import { PONS_FACTORY, TOKEN_LAUNCHED_TOPIC, decodeTokenLaunchedLog } from '../dist/src/live.js';
const state = JSON.parse(fs.readFileSync('runs/paper/state.json'));
const rpc = createHttpRpcCaller();
const head = await rpc('eth_blockNumber');
const current = await rpc('eth_getBlockByNumber', [head, false]);
const old = [...state.positions].sort((a,b)=>a.candidate.launch.blockNumber-b.candidate.launch.blockNumber)[0];
const latest = state.decisions.at(-1);
const result = { current, tokens: [] };
for (const c of [old.candidate, latest.candidate]) {
 const block = `0x${c.launch.blockNumber.toString(16)}`;
 const header = await rpc('eth_getBlockByNumber',[block,false]);
 const logs = await rpc('eth_getLogs',[{address:PONS_FACTORY,topics:[TOKEN_LAUNCHED_TOPIC,`0x${c.tokenAddress.slice(2).padStart(64,'0')}`],fromBlock:block,toBlock:block}]);
 result.tokens.push({symbol:c.symbol,address:c.tokenAddress,launchHeader:header,launchEvent:logs.map(decodeTokenLaunchedLog),ageSeconds:Number(current.timestamp)-Number(header.timestamp),entry:old.candidate.tokenAddress===c.tokenAddress?old.enteredAt:null,lastDecision:latest.candidate.tokenAddress===c.tokenAddress?latest.timestamp:null,assessment:c.launch.assessment,market:c.launch.market});
}
// Keep raw header proof compact (exclude transaction lists).
for (const h of [result.current,...result.tokens.map(t=>t.launchHeader)]) delete h.transactions;
fs.writeFileSync('runs/launch-age-proof.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({head:Number(head),currentTime:new Date(Number(current.timestamp)*1000).toISOString(),tokens:result.tokens.map(t=>({symbol:t.symbol,address:t.address,block:Number(t.launchHeader.number),time:new Date(Number(t.launchHeader.timestamp)*1000).toISOString(),ageSeconds:t.ageSeconds,entry:t.entry,lastDecision:t.lastDecision,verifiedEvents:t.launchEvent.length}))},null,2));

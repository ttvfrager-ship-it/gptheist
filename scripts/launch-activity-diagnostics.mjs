// Read-only, pinned state comparison for the tokens already captured in launch-age-proof.json.
import fs from 'node:fs';
import { createHttpRpcCaller } from '../dist/src/server.js';
import { readPonsLaunchResearch } from '../dist/src/market.js';
import { initialPaperState, liveCandidate, enterPaper } from '../dist/src/paper.js';
const proof = JSON.parse(fs.readFileSync('runs/launch-age-proof.json'));
const state = JSON.parse(fs.readFileSync('runs/paper/state.json'));
const rpc = createHttpRpcCaller();
const to = Number(proof.current.number), from = to - 1000;
const header = await rpc('eth_getBlockByNumber',[`0x${from.toString(16)}`,false]);
const launches = proof.tokens.map(t=>t.launchEvent[0]);
const before = await readPonsLaunchResearch(rpc, launches,`0x${from.toString(16)}`);
const after = await readPonsLaunchResearch(rpc, launches,`0x${to.toString(16)}`);
const results = proof.tokens.map((t,i)=>{
 const c = [...state.positions.map(p=>p.candidate),...state.decisions.map(d=>d.candidate)].find(c=>c.tokenAddress===t.address);
 const candidate = {...liveCandidate(c.launch),launchBlock:Number(t.launchHeader.number),launchTimestamp:Number(t.launchHeader.timestamp),
 currentBlock:to,currentTimestamp:Number(proof.current.timestamp),tokenAgeSeconds:t.ageSeconds,eventMode:'BACKFILL',
 launchBlockHash:t.launchHeader.hash,currentBlockHash:proof.current.hash};
 const draft=initialPaperState(Number(proof.current.timestamp)*1000);
 const policy=enterPaper(draft,candidate,10,Number(proof.current.timestamp)*1000);
 return {symbol:t.symbol,address:t.address,fromBlock:from,fromTimestamp:Number(header.timestamp),toBlock:to,toTimestamp:Number(proof.current.timestamp),before:before[i].market,after:after[i].market,policy,positionsOpened:draft.positions.length,lastVerifiedActivityTime:null};
});
fs.writeFileSync('runs/launch-activity-proof.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));

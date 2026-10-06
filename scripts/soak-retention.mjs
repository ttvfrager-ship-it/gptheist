// Run: npm run build && node --expose-gc scripts/soak-retention.mjs
import assert from 'node:assert/strict';
import { fixture } from '../dist/tests/paper-fixtures.js';
import { initialPaperState, observeSnapshot } from '../dist/src/paper.js';
import { retainPaperState, collectionCounts } from '../dist/src/paper-retention.js';
const f=fixture(),state=initialPaperState(f.time,{...initialPaperState(f.time).config,PAPER_STRATEGY_VERSION:4});
const checkpoints=[];
for(let cycle=0;cycle<12000;cycle++) {
 const now=f.time+cycle*4000,block=100+cycle;
 const launch=structuredClone(f.launch);
 launch.transactionHash=`0x${cycle.toString(16).padStart(64,'0')}`;
 launch.token=`0x${(cycle+1).toString(16).padStart(40,'0')}`;
 launch.blockNumber=block;
 launch.chronology={...launch.chronology,launchBlock:block,launchTimestamp:Math.floor(now/1000),currentBlock:block,currentTimestamp:Math.floor(now/1000),tokenAgeSeconds:0,eventMode:'LIVE',sourceEventId:`${launch.transactionHash}:0`,sourceEventTimestampMs:now,eventOccurredAtMs:now};
 await observeSnapshot(state,{...f.snapshot,headBlock:block,fetchedAt:new Date(now).toISOString(),launches:[launch]},now);
 retainPaperState(state,now);
 if([0,2000,4000,6000,8000,10000,11999].includes(cycle)) {
  global.gc?.();const mem=process.memoryUsage();
  checkpoints.push({cycle,simulatedHours:(cycle*4000/3600000).toFixed(2),...collectionCounts(state),rssMB:+(mem.rss/1048576).toFixed(2),heapUsedMB:+(mem.heapUsed/1048576).toFixed(2)});
 }
}
const settled=checkpoints.slice(1);
for(const sample of settled) for(const key of Object.keys(collectionCounts(state))) assert.equal(sample[key],settled[0][key],key);
if(global.gc) assert.ok(settled.at(-1).heapUsedMB-settled[0].heapUsedMB<10,'retained heap grows less than 10MB over settled run');
console.log(JSON.stringify({cycles:12000,simulatedHours:13.33,checkpoints},null,2));

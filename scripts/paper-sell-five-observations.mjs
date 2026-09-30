// Five independent read-only observations of an exact, persisted paper allocation.
// A closed trade remains closed; this script never writes an account.
import { readFile, writeFile } from 'node:fs/promises';
import { formatUnits } from 'viem';
import { createHttpRpcCaller } from '../dist/src/server.js';
import { createEthUsdProvider, readPaperQuote } from '../dist/src/paper-quotes.js';
const state = JSON.parse(await readFile(process.argv[2], 'utf8'));
const p = [...state.positions, ...state.trades].find(p => !process.argv[3] || p.symbol === process.argv[3]);
if (!p) throw new Error('No real persisted allocation');
const rpc = createHttpRpcCaller(), usd = createEthUsdProvider(), observations = [];
for (let i = 0; i < 5; i++) {
  const result = await readPaperQuote(rpc, usd, p.candidate.launch, {
    side: 'SELL', tokenUnits: p.entry.tokenUnits, quantity: p.quantity, tokenDecimals: p.entry.evidence.tokenDecimals
  }, Date.now, state.config);
  const q = result.status === 'AVAILABLE' ? result.quote : null;
  const row = { number: i + 1, block: result.diagnostics?.currentBlock, rawInput: p.entry.tokenUnits,
    rawOutput: q?.evidence.amountOut ?? null, ethOut: q ? formatUnits(BigInt(q.evidence.amountOut), 18) : null,
    usdOut: q?.notionalUsd ?? null, blockAgeMs: q ? Date.now() - Date.parse(q.blockTimestamp) : null,
    status: q ? 'LIVE' : 'UNAVAILABLE', failure: result.reason ?? null, result };
  observations.push(row);
  console.log(JSON.stringify({ ...row, result: undefined }));
  if (i < 4) await new Promise(resolve => setTimeout(resolve, 3000));
}
await writeFile('runs/paper-sell-five-observations.json', JSON.stringify({
  observedAt: new Date().toISOString(), symbol: p.symbol, token: p.tokenAddress,
  accountPositionStatus: p.exitedAt ? 'ALREADY_CLOSED' : 'OPEN_AT_CAPTURE',
  entry: p.entry, observations, accountWrites: 0
}, null, 2));

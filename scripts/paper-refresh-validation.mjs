// Validation against a COPY of a real paper position. Original paper account is read-only.
import { readFile, writeFile } from 'node:fs/promises';
import { createHttpRpcCaller } from '../dist/src/server.js';
import { createEthUsdProvider, readPaperQuote } from '../dist/src/paper-quotes.js';
import { markPaperPosition, initialPaperState } from '../dist/src/paper.js';
import { formatUnits } from 'viem';
const path = process.argv[2];
if (!path) throw new Error('Supply a captured paper state.json');
const saved = JSON.parse(await readFile(path, 'utf8'));
const position = saved.positions[0];
if (!position) throw new Error('No captured open position; do not invent one');
const state = initialPaperState(); state.positions = [structuredClone(position)]; state.cash -= position.costBasisUsd;
const rpc = createHttpRpcCaller(), usd = createEthUsdProvider();
const rows = [], results = [];
const observe = async (transport = rpc) => {
  const p = state.positions[0];
  const result = await readPaperQuote(transport, usd, p.candidate.launch,
    { side: 'SELL', tokenUnits: p.entry.tokenUnits, quantity: p.quantity });
  results.push(result); markPaperPosition(state, p.id, result);
  const q = p.management.lastSuccessfulQuote;
  const row = { attemptedAt: p.lastQuoteAttempt, timestamp: q?.timestamp, block: q?.blockNumber,
    token: p.tokenAddress, humanQuantity: formatUnits(BigInt(p.entry.tokenUnits), p.entry.evidence.tokenDecimals),
    rawQuantity: p.entry.tokenUnits, rawSellOutput: q?.evidence.amountOut,
    ethOutput: q ? formatUnits(BigInt(q.evidence.amountOut), 18) : null, ethUsd: q?.evidence.ethUsd,
    liquidationUsd: q?.notionalUsd, ageMs: q ? Date.now() - Date.parse(q.timestamp) : null,
    status: p.markStatus === 'FRESH' ? 'LIVE' : q ? 'STALE' : 'UNAVAILABLE', failure: p.markReason,
    cash: state.cash, closedTrades: state.trades.length };
  rows.push(row); console.log(JSON.stringify(row));
};
for (let i = 0; i < 5; i++) { await observe(); if (i < 4) await new Promise(resolve => setTimeout(resolve, 3000)); }
await observe(async () => { throw new Error('INJECTED temporary RPC failure; no network request sent'); });
await new Promise(resolve => setTimeout(resolve, 3000));
await observe();
await writeFile('runs/paper-refresh-validation.json', JSON.stringify({ originalStatePath: path, rows, results }, null, 2));

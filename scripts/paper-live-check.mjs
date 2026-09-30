// Real data only. Exercises the existing server using an isolated, persistent paper account.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createDeskServer, createHttpRpcCaller } from '../dist/src/server.js';

const directory = await mkdtemp(join(tmpdir(), 'gptheist-live-'));
const methods = {};
const transport = createHttpRpcCaller(process.env.RPC_URL);
const rpc = async (method, params) => {
  if (!['eth_chainId', 'eth_blockNumber', 'eth_getLogs', 'eth_call', 'eth_getBlockByNumber'].includes(method)) throw new Error('Non-read method forbidden');
  methods[method] = (methods[method] ?? 0) + 1;
  return transport(method, params);
};
const server = createDeskServer({ paperDirectory: join(directory, 'paper'), rpc });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const observations = [];
const snapshots = [];
const watchdog = setTimeout(() => { console.error('Validation exceeded four minutes'); process.exitCode = 1; server.close(); server.closeAllConnections(); }, 420_000);
try {
  const html = await (await fetch(`${base}/paper`)).text();
  console.log(JSON.stringify({ directory, url: `${base}/paper`, paperHtml: html.includes('PAPER MODE'), startedAt: new Date().toISOString() }));
  for (let cycle = 0; cycle < 12; cycle++) {
    try {
      const response = await fetch(`${base}/api/snapshot`, { signal: AbortSignal.timeout(35_000) });
      const snapshot = await response.json(); snapshots.push(snapshot);
      console.log(JSON.stringify({ cycle, snapshotStatus: response.status, head: snapshot.headBlock,
        launches: snapshot.launches?.length, watch: snapshot.launches?.filter(l => l.verdict === 'WATCH').length,
        veto: snapshot.launches?.filter(l => l.verdict === 'VETO').length, error: snapshot.error }));
    } catch (error) { console.log(JSON.stringify({ cycle, snapshotError: error.message })); }
    const paper = await (await fetch(`${base}/api/paper`)).json();
    observations.push(paper);
    console.log(JSON.stringify({ cycle, at: new Date().toISOString(), quoteHealth: paper.quoteHealth,
      decisions: paper.decisions?.slice(-24).map(d => ({ token: d.candidate.tokenAddress, symbol: d.candidate.symbol, gptheist: d.gptheistVerdict, paper: d.paperVerdict, reason: d.reason, size: d.sizeUsd })),
      positionQuotes: paper.positions?.map(p => ({ token: p.tokenAddress, quantity: p.quantity, tokenUnits: p.entry.tokenUnits,
        timestamp: p.management.lastSuccessfulQuoteTimestamp, block: p.current.blockNumber, rawSellOutput: p.current.evidence?.amountOut,
        ethUsd: p.current.evidence?.ethUsd, liquidationUsd: p.current.notionalUsd, status: p.quoteStatus, ageMs: p.quoteAgeMs })),
      open: paper.positions?.length, closed: paper.trades?.length, error: paper.error }));
    if (cycle < 11) await new Promise(resolve => setTimeout(resolve, 15_000));
  }
} finally {
  clearTimeout(watchdog);
  await writeFile(join(directory, 'validation.json'), JSON.stringify({ observedAt: new Date().toISOString(), methods, snapshots, observations }, null, 2));
  console.log(JSON.stringify({ report: join(directory, 'validation.json'), methods, sentTransactions: 0 }));
  server.close(); server.closeIdleConnections();
}

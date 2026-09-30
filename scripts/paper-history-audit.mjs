// Read-only reconstruction; original account and trade values are never modified.
import { readFile, writeFile } from 'node:fs/promises';
import { createHttpRpcCaller } from '../dist/src/server.js';
import { readPaperQuote } from '../dist/src/paper-quotes.js';
const state = JSON.parse(await readFile('runs/paper/state.json', 'utf8'));
const transport = createHttpRpcCaller();
const report = { auditedAt: new Date().toISOString(), trades: [] };
for (const trade of state.trades.filter(t => ['BOAR', 'PLabs'].includes(t.symbol))) {
  const row = { symbol: trade.symbol, token: trade.tokenAddress, originalReturnPercent: trade.returnPercent,
    preEntrySellEvidence: trade.entry.roundTrip ?? null, entry: trade.entry, exit: trade.exit, reconstruction: [] };
  for (const original of [trade.entry, trade.exit]) {
    const pinned = '0x' + original.blockNumber.toString(16);
    const rpc = (method, params) => method === 'eth_blockNumber' ? Promise.resolve(pinned) : transport(method, params);
    const usd = async () => ({ bid: original.evidence.ethUsd, ask: original.evidence.ethUsd,
      timestamp: original.evidence.usdTimestamp, source: 'SAVED_HISTORICAL_REFERENCE: ' + original.evidence.usdSource });
    const result = await readPaperQuote(rpc, usd, trade.candidate.launch, original.side === 'BUY' ?
      { side: 'BUY', sizeUsd: original.notionalUsd } : { side: 'SELL', tokenUnits: trade.entry.tokenUnits, quantity: trade.quantity },
      () => Date.parse(original.timestamp), state.config);
    row.reconstruction.push({ side: original.side, result,
      matchesRawOutput: result.status === 'AVAILABLE' ? result.quote.evidence.amountOut === original.evidence.amountOut : null });
  }
  // The new exact USD conversion can differ by a few wei from the historical float conversion.
  // Recompute the saved raw-input arithmetic separately, never rewrite a fill.
  row.savedArithmetic = [trade.entry, trade.exit].map(q => {
    const e = q.evidence, input = BigInt(e.amountIn), qr = BigInt(e.quoteReserve), tr = BigInt(e.tokenReserve);
    const fee = BigInt(e.feeBps), tax = BigInt(e.creatorTaxBps), snipe = BigInt(e.snipeTaxBps);
    const net = input - input * fee / 10000n - input * tax / 10000n - input * snipe / 10000n;
    const gross = input * qr / (tr + input);
    const output = q.side === 'BUY' ? net * tr / (qr + net) : gross - gross * fee / 10000n - gross * tax / 10000n;
    return { side: q.side, output: String(output), matches: String(output) === e.amountOut,
      grossSellFitsRealReserve: q.side === 'SELL' ? gross <= BigInt(e.realQuoteReserve) : null };
  });
  row.status = row.savedArithmetic.some(x => !x.matches || x.grossSellFitsRealReserve === false)
    ? 'INVALID_HISTORICAL_EXECUTION' : row.reconstruction.every(x => x.result.status === 'AVAILABLE')
      ? 'RECONSTRUCTED_WITH_SAVED_USD_REFERENCE' : 'UNVERIFIED_HISTORICAL_EXECUTION';
  report.trades.push(row);
  console.log(JSON.stringify({ symbol: row.symbol, status: row.status, savedArithmetic: row.savedArithmetic,
    reads: row.reconstruction.map(x => ({ side: x.side, status: x.result.status, reason: x.result.reason, matches: x.matchesRawOutput })) }));
}
await writeFile('runs/paper-history-audit.json', JSON.stringify(report, null, 2));

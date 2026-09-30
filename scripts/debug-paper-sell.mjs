// Reads a real persisted position. Never opens PaperStore or writes the account.
import { readFile, writeFile } from 'node:fs/promises';
import { curveAmountOut } from '../dist/src/paper-math.js';
import { createHash } from 'node:crypto';
import { parseAbi, encodeFunctionData, decodeFunctionResult, formatUnits } from 'viem';
import { createHttpRpcCaller } from '../dist/src/server.js';
import { createEthUsdProvider, readPaperQuote } from '../dist/src/paper-quotes.js';
const selector = (process.argv[2] ?? '').toLowerCase();
if (!selector) throw new Error('Usage: npm run debug:paper-sell -- <symbol|token|position-id|all>');
const file = process.env.PAPER_DEBUG_STATE ?? 'runs/paper/state.json';
const original = await readFile(file, 'utf8'), state = JSON.parse(original);
const positions = state.positions.filter(p => selector === 'all' || [p.id, p.tokenAddress, p.symbol, p.name].some(v => v.toLowerCase() === selector));
if (!positions.length) throw new Error('No matching REAL persisted OPEN paper position');
const rpc = createHttpRpcCaller(), usd = createEthUsdProvider();
const abi = parseAbi(['function decimals() view returns (uint8)', 'function getReserves() view returns (uint256,uint256)',
  'function realQuoteReserve() view returns (uint256)', 'function graduated() view returns (bool)', 'function readyToGraduate() view returns (bool)',
  'function feeBps() view returns (uint256)', 'function creatorTaxBps() view returns (uint256)']);
const report = { startedAt: new Date().toISOString(), stateFile: file, stateSha256: createHash('sha256').update(original).digest('hex'), positions: [] };
for (const p of positions) {
  const result = await readPaperQuote(rpc, usd, p.candidate.launch,
    { side: 'SELL', tokenUnits: p.entry.tokenUnits, quantity: p.quantity, tokenDecimals: p.entry.evidence?.tokenDecimals }, Date.now, state.config);
  const block = result.diagnostics?.currentBlock;
  const reads = {};
  if (block !== undefined) for (const name of ['decimals', 'getReserves', 'realQuoteReserve', 'graduated', 'readyToGraduate', 'feeBps', 'creatorTaxBps']) {
    const params = [{ to: name === 'decimals' ? p.tokenAddress : p.candidate.launch.curve, data: encodeFunctionData({ abi, functionName: name }) }, '0x' + block.toString(16)];
    try {
      const raw = await rpc('eth_call', params);
      reads[name] = { method: 'eth_call', params, rawResponse: raw, decoded: decodeFunctionResult({ abi, functionName: name, data: raw }) };
    } catch (e) { reads[name] = { method: 'eth_call', params, error: e.message }; }
  }
  const decimals = reads.decimals?.decoded, calculation = result.diagnostics?.calculation;
  const rate = result.diagnostics?.ethUsd;
  const rawQuantity = p.entry.tokenUnits;
  const qr = reads.getReserves?.decoded?.[0], tr = reads.getReserves?.decoded?.[1], real = reads.realQuoteReserve?.decoded;
  const e = p.entry.evidence;
  const entryNet = e ? BigInt(e.amountIn) - BigInt(e.feeWei) - BigInt(e.creatorTaxWei) - BigInt(e.snipeTaxWei) : null;
  const reconstructedBuyRaw = entryNet !== null ? String(curveAmountOut(entryNet, BigInt(e.quoteReserve), BigInt(e.tokenReserve))) : null;
  const independentGross = tr !== undefined && qr !== undefined ? curveAmountOut(BigInt(rawQuantity), tr, qr) : null;
  const row = { reconstructedBuyRaw, savedBuyArithmeticMatches: reconstructedBuyRaw === e?.amountOut,
    independentGrossWei: independentGross,
    directReserveMatchesService: result.diagnostics?.market?.status === 'VERIFIED' && qr !== undefined && tr !== undefined && real !== undefined ?
      String(qr) === result.diagnostics.market.quoteReserve && String(tr) === result.diagnostics.market.tokenReserve && String(real) === result.diagnostics.market.realQuoteReserve : null,
    decimalsAgree: decimals !== undefined && decimals === e?.tokenDecimals && decimals === Number(calculation?.decimals ?? result.quote?.evidence?.tokenDecimals),
    positionId: p.id, token: p.name, symbol: p.symbol, tokenAddress: p.tokenAddress, curveAddress: p.candidate.launch.curve,
    pair: p.candidate.launch.pairToken, block, blockTimestamp: result.diagnostics?.blockTimestamp,
    chainDecimals: decimals ?? null, storedDecimals: p.entry.evidence?.tokenDecimals ?? null, quoteServiceDecimals: calculation?.decimals ?? result.quote?.evidence?.tokenDecimals ?? null,
    exactHumanQuantity: typeof decimals === 'number' ? formatUnits(BigInt(rawQuantity), decimals) : null, persistedHumanQuantity: p.quantity,
    buyRawTokenOutput: p.entry.evidence?.amountOut ?? null, persistedRawQuantity: rawQuantity, sellRawTokenInput: result.diagnostics?.input.tokenUnits,
    rawQuantityMatches: p.entry.evidence?.amountOut === rawQuantity && rawQuantity === result.diagnostics?.input.tokenUnits,
    entry: { usdInput: p.entry.notionalUsd, ethUsd: p.entry.evidence?.ethUsd, ethInWei: p.entry.evidence?.amountIn,
      ethIn: p.entry.evidence ? formatUnits(BigInt(p.entry.evidence.amountIn), 18) : null, originalQuote: p.entry },
    curveState: result.diagnostics?.market ?? null, graduated: reads.graduated?.decoded ?? null, readyToGraduate: reads.readyToGraduate?.decoded ?? null,
    tokenReserveRaw: tr, tokenReserveFormatted: tr !== undefined && typeof decimals === 'number' ? formatUnits(tr, decimals) : null,
    pricingEthReserveRaw: qr, pricingEthReserve: qr !== undefined ? formatUnits(qr, 18) : null,
    availableEthRaw: real, availableEth: real !== undefined ? formatUnits(real, 18) : null,
    quoteMethod: 'PINNED_PONS_V2_INTEGER_MODEL; no on-chain SELL quote selector; view calls supply reserves and fees',
    quoteContract: p.candidate.launch.curve, independentDirectReads: reads, calculation,
    liquidityComparison: calculation ? { expression: `${calculation.grossWei} > ${calculation.realQuoteReserveWei}`, result: BigInt(calculation.grossWei) > BigInt(calculation.realQuoteReserveWei) } : null,
    // A rejected model output is NOT an executable quote or position valuation.
    rejectedModelEthOut: result.status !== 'AVAILABLE' && calculation ? formatUnits(BigInt(calculation.ethOutWei), 18) : null,
    executableEthOut: result.status === 'AVAILABLE' ? formatUnits(BigInt(result.quote.evidence.amountOut), 18) : null,
    executableUsdOut: result.status === 'AVAILABLE' ? result.quote.notionalUsd : null,
    ethUsd: rate, status: result.status, failureReason: result.reason ?? null,
    ageMsAtCompletion: result.diagnostics?.blockTimestamp ? Date.parse(result.diagnostics.completedAt) - Date.parse(result.diagnostics.blockTimestamp) : null,
    result };
  report.positions.push(row);
  console.log(JSON.stringify(row, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));
}
report.completedAt = new Date().toISOString();
report.stateFileUnchanged = original === await readFile(file, 'utf8');
report.accountWriteCalls = 0;
report.stateComparisonNote = 'This diagnostic never writes the account. A false unchanged comparison means another process changed the file during these reads.';
await writeFile('runs/paper-sell-debug.json', JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));

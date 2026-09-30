// Reconstruct actual settled sell events from pinned parent state. No hypothetical execution.
import { readFile, writeFile } from 'node:fs/promises';
import { parseAbi, decodeEventLog, encodeFunctionData, decodeFunctionResult } from 'viem';
import { createHttpRpcCaller } from '../dist/src/server.js';
import { PONS_FACTORY } from '../dist/src/live.js';
import { curveAmountOut } from '../dist/src/paper-math.js';
const captured = JSON.parse(await readFile(process.argv[2] ?? 'runs/paper-sell-contract-proof.json', 'utf8'));
const rpc = createHttpRpcCaller();
const abi = parseAbi(['event CurveSell(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 quoteOut,uint256 fee,uint256 tax)',
  'function getReserves() view returns (uint256,uint256)', 'function feeBps() view returns (uint256)',
  'function creatorTaxBps() view returns (uint256)', 'function factory() view returns (address)']);
const results = [];
for (const item of captured) {
  const log = item.rawEvent; if (!log) continue;
  const parent = '0x' + (BigInt(log.blockNumber) - 1n).toString(16), reads = {};
  try {
    for (const name of ['getReserves', 'feeBps', 'creatorTaxBps', 'factory']) {
      const raw = await rpc('eth_call', [{ to: log.address, data: encodeFunctionData({ abi, functionName: name }) }, parent]);
      reads[name] = { raw, decoded: decodeFunctionResult({ abi, functionName: name, data: raw }) };
    }
    const [qr, tr] = reads.getReserves.decoded, a = decodeEventLog({ abi, ...log }).args;
    const gross = curveAmountOut(a.tokensIn, tr, qr);
    const fee = gross * reads.feeBps.decoded / 10000n, tax = gross * reads.creatorTaxBps.decoded / 10000n;
    results.push({ rawEvent: log, parent, reads, expected: String(gross - fee - tax), actual: String(a.quoteOut),
      factoryMatches: reads.factory.decoded.toLowerCase() === PONS_FACTORY,
      matches: gross - fee - tax === a.quoteOut && fee === a.fee && tax === a.tax });
  } catch (e) { results.push({ rawEvent: log, parent, error: e.message }); }
}
await writeFile('runs/paper-sell-proof-verified.json', JSON.stringify(results, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));
console.log(JSON.stringify(results.map(r => ({ block: r.rawEvent.blockNumber, matches: r.matches, factory: r.factoryMatches, error: r.error }))));

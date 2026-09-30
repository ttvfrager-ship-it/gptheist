// Independent arithmetic check against an actual settled CurveBuy event; read-only.
import { readFile, writeFile } from 'node:fs/promises';
import { parseAbi, decodeEventLog, encodeFunctionData, decodeFunctionResult } from 'viem';
import { createHttpRpcCaller } from '../dist/src/server.js';
import { curveAmountOut } from '../dist/src/paper-math.js';
const state = JSON.parse(await readFile(process.argv[2], 'utf8'));
const p = state.positions[0] ?? state.trades[0];
const rpc = createHttpRpcCaller();
const abi = parseAbi(['event CurveBuy(address indexed buyer,address indexed recipient,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 tax)',
  'function getReserves() view returns (uint256,uint256)', 'function currentSnipeTaxBps(address) view returns (uint256)']);
const logs = await rpc('eth_getLogs', [{ address: p.candidate.launch.curve, fromBlock: '0x' + p.candidate.launch.blockNumber.toString(16), toBlock: 'latest' }]);
const results = [];
for (const log of logs) {
  let event; try { event = decodeEventLog({ abi, ...log }); } catch { continue; }
  if (Number(BigInt(log.blockNumber)) <= p.candidate.launch.blockNumber) continue;
  const parent = '0x' + (BigInt(log.blockNumber) - 1n).toString(16);
  try {
    const raw = await rpc('eth_call', [{ to: log.address, data: encodeFunctionData({ abi, functionName: 'getReserves' }) }, parent]);
    const [qr, tr] = decodeFunctionResult({ abi, functionName: 'getReserves', data: raw });
    const a = event.args;
    const output = curveAmountOut(a.quoteIn - a.fee - a.tax, qr, tr);
    results.push({ block: log.blockNumber, parent, transactionHash: log.transactionHash, rawEvent: log, rawReserves: raw,
      quoteIn: String(a.quoteIn), fee: String(a.fee), tax: String(a.tax), expected: String(output), actual: String(a.tokensOut), matches: output === a.tokensOut,
      limitation: 'No source-bytecode equivalence claim; only this actual settled trade is cross-checked. Nonzero snipe taxes require separate proof.' });
  } catch (e) { results.push({ block: log.blockNumber, error: e.message }); }
}
await writeFile('runs/paper-contract-proof.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));

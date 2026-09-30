import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult, type Hex } from "viem";
import { PONS_FACTORY, type RpcCaller } from "../src/live.js";
import { readV4SellQuote, V4, V4_ABI, v4PoolId } from "../src/uniswap-v4.js";
import { readPaperExitQuote } from "../src/paper-quotes.js";
import { initialPaperState, markPaperPosition, monitorPaper, quoteProblem, type Position } from "../src/paper.js";
import { evaluateExit } from "../src/paper-policy.js";
import { observeSnapshot } from "./liquidity-history-fixture.js";
import { fixture } from "./paper-fixtures.js";

async function setup() {
  const f = fixture(), state = initialPaperState(f.time);
  await observeSnapshot(state, f.snapshot, f.time, (_launch, size) => f.buy(size));
  const position = state.positions[0]!;
  const calls: string[] = [];
  const hook = `0x${"4".repeat(40)}` as Hex;
  // On this Arbitrum chain Solidity block.number is L1, unlike eth_blockNumber.
  const values = { amountOut: 10n ** 16n, liquidity: 10n ** 22n, reserve: 10n ** 18n, lensBlock: 100n,
    phase: 2, reorg: false, headerReads: 0, usdTime: f.time, quoterFails: false };
  const rpc: RpcCaller = async (method, params = []) => {
    calls.push(method);
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") return "0xc8";
    if (method === "eth_getBlockByNumber") return { number: "0xc8", l1BlockNumber: "0x64",
      hash: `0x${values.reorg && ++values.headerReads % 2 === 0 ? "c".repeat(64) : "b".repeat(64)}`,
      timestamp: `0x${Math.floor(f.time / 1000).toString(16)}` };
    assert.equal(method, "eth_call"); assert.equal(params[1], "0xc8");
    const c = params[0] as { to: string; data: Hex };
    // Curve unavailable: production must discover a new route.
    if (c.to.toLowerCase() === "0xca11bde05977b3631167028862be2a173976ca11") throw new Error("curve retired");
    const d = decodeFunctionData({ abi: V4_ABI, data: c.data }); calls.push(d.functionName);
    let result: unknown;
    switch (d.functionName) {
      case "getLaunchedToken": result = { token: f.launch.token, curve: f.launch.curve, deployer: f.launch.deployer,
        creatorFeeRecipient: f.launch.deployer, pairToken: f.launch.pairToken, graduationThreshold: 1n,
        poolFee: 0, tickSpacing: 200, creatorTaxBps: 200, buybackEnabled: false, phase: values.phase,
        sweptQuote: 0n, sweptTokens: 0n, sweptAt: 0n, exists: true }; break;
      case "poolManager": result = V4.manager; break;
      case "factory": result = PONS_FACTORY; break;
      case "memeHook": result = hook; break;
      case "decimals": result = 18; break;
      case "getSlot0": result = [10n ** 30n, 200000, 0, 0]; break;
      case "getLiquidity": result = values.liquidity; break;
      case "getPoolTVL": result = { coreAmount0: values.reserve, coreAmount1: 10n ** 25n,
        hookReserves0: 0n, hookReserves1: 0n, hookEffective0: 0n, hookEffective1: 0n,
        sqrtPriceX96: 10n ** 30n, tick: 200000, activeLiquidity: values.liquidity, blockNumber: values.lensBlock,
        statsProvider: hook, hookPermissions: 8260, hasCustomAccounting: true, statsStatus: 1 }; break;
      case "quoteExactInputSingle": {
        if (values.quoterFails) throw new Error("full sell reverted");
        const input = d.args![0] as { exactAmount: bigint; zeroForOne: boolean };
        assert.equal(input.exactAmount.toString(), position.entry.tokenUnits);
        assert.equal(input.zeroForOne, false);
        result = [values.amountOut, 74000n]; break;
      }
    }
    return encodeFunctionResult({ abi: V4_ABI, functionName: d.functionName, result } as Parameters<typeof encodeFunctionResult>[0]);
  };
  const usd = async () => ({ bid: 2000, ask: 2000, timestamp: new Date(values.usdTime).toISOString(), source: "TEST" });
  const quote = () => readPaperExitQuote(rpc, position, usd, () => f.time, state.config);
  return { f, state, position, rpc, usd, values, calls, quote };
}

test("retired curve migrates full balance to v4; route and executable PnL persist", async () => {
  const s = await setup(), entry = structuredClone(s.position.entry), quantity = s.position.quantity;
  const result = await s.quote(); assert.equal(result.status, "AVAILABLE");
  if (result.status !== "AVAILABLE") return;
  assert.equal(result.quote.source, "UNISWAP_V4");
  assert.equal(result.quote.v4!.route.pool, v4PoolId(result.quote.v4!.route.key));
  assert.ok(markPaperPosition(s.state, s.position.id, result, s.f.time));
  assert.equal(s.position.market, "UNISWAP_V4"); assert.equal(s.position.markStatus, "FRESH");
  assert.equal(s.position.current.notionalUsd, 20); assert.equal(s.position.management.peakLiquidationValueUsd, 20);
  assert.deepEqual(s.position.entry, entry); assert.equal(s.position.quantity, quantity);
  assert.equal(s.position.management.liquidity, undefined);
  assert.equal(s.state.events.filter(e => e.eventType === "MARKET_MIGRATION_DETECTED").length, 1);
  s.calls.length = 0; await s.quote();
  assert.ok(s.calls.includes("quoteExactInputSingle")); assert.ok(!s.calls.includes("aggregate3"));
  markPaperPosition(s.state, s.position.id, await s.quote(), s.f.time);
  assert.equal(s.state.events.filter(e => e.eventType === "MARKET_MIGRATION_DETECTED").length, 1);
  s.values.amountOut = 1n;
  markPaperPosition(s.state, s.position.id, await s.quote(), s.f.time);
  assert.equal(evaluateExit(s.position, s.f.time)?.reason, "DYNAMIC_RISK_EXIT");
});

for (const [label, mutate] of [
  ["inactive pool", (s: Awaited<ReturnType<typeof setup>>) => { s.values.liquidity = 0n; }],
  ["uncreated pool", (s: Awaited<ReturnType<typeof setup>>) => { s.values.phase = 0; }],
  ["insufficient real liquidity", (s: Awaited<ReturnType<typeof setup>>) => { s.values.reserve = 1n; }],
  ["stale USD", (s: Awaited<ReturnType<typeof setup>>) => { s.values.usdTime -= 60000; }],
  ["reorg", (s: Awaited<ReturnType<typeof setup>>) => { s.values.reorg = true; }],
  ["inconsistent lens block", (s: Awaited<ReturnType<typeof setup>>) => { s.values.lensBlock = 200n; }],
  ["full sell revert", (s: Awaited<ReturnType<typeof setup>>) => { s.values.quoterFails = true; }]
] as const) test(`v4 rejects ${label} without changing route or entry`, async () => {
  const s = await setup(); mutate(s);
  const before = structuredClone(s.position);
  const r = await s.quote(); assert.equal(r.status, "NOT_PAPER_TRADABLE");
  assert.equal(markPaperPosition(s.state, s.position.id, r, s.f.time), false);
  assert.equal(s.position.executionRoute, undefined); assert.deepEqual(s.position.entry, before.entry);
});

test("healthy original curve wins without v4 discovery", async () => {
  const s = await setup();
  const r = await readPaperExitQuote(s.f.rpc, s.position, s.usd, () => s.f.time, s.state.config);
  assert.equal(r.status, "AVAILABLE"); if (r.status === "AVAILABLE") assert.equal(r.quote.v4, undefined);
});

test("migration monitor requires a second full-balance quote before exit", async () => {
  const s = await setup(); s.values.amountOut = 1n; let attempts = 0;
  await monitorPaper(s.state, async (p: Position) => {
    attempts++;
    if (attempts === 2) { assert.equal(p.executionRoute?.market, "UNISWAP_V4"); s.values.quoterFails = true; }
    return readPaperExitQuote(s.rpc, p, s.usd, () => s.f.time, s.state.config);
  }, () => s.f.time);
  assert.equal(attempts, 2); assert.equal(s.state.positions.length, 1); assert.equal(s.state.trades.length, 0);
});

test("wrong full-balance units cannot produce a v4 sell mark", async () => {
  const s = await setup();
  const r = await readV4SellQuote(s.rpc, s.usd, s.f.launch,
    { tokenUnits: "1", quantity: s.position.quantity }, () => s.f.time, s.state.config);
  assert.equal(r.status, "NOT_PAPER_TRADABLE");
});


test("v4 evidence rejects substituted pools and fabricated output values", async () => {
  const s = await setup(), r = await s.quote(); assert.equal(r.status, "AVAILABLE");
  if (r.status !== "AVAILABLE") return;
  const altered = structuredClone(r.quote);
  altered.v4!.route.pool = `0x${"a".repeat(64)}`;
  assert.equal(quoteProblem(altered, s.f.time, 30000), "INVALID_QUOTE_EVIDENCE");
  const price = structuredClone(r.quote); price.notionalUsd *= 2; price.fillPriceUsd *= 2;
  assert.equal(quoteProblem(price, s.f.time, 30000), "INVALID_QUOTE_EVIDENCE");
});

test("v4 marks arm and trigger the existing trailing policy", async () => {
  const s = await setup();
  s.position.plan.exitPolicy.profitArmPercent = 1;
  s.position.plan.exitPolicy.trailingDrawdownPercent = 5;
  s.values.amountOut = BigInt(Math.ceil(s.position.costBasisUsd * 2 / 2000 * 1e18));
  markPaperPosition(s.state, s.position.id, await s.quote(), s.f.time);
  assert.equal(s.position.management.state, "RUNNER");
  s.values.amountOut = s.values.amountOut * 9n / 10n;
  markPaperPosition(s.state, s.position.id, await s.quote(), s.f.time);
  assert.equal(evaluateExit(s.position, s.f.time)?.reason, "TRAILING_EXIT");
});

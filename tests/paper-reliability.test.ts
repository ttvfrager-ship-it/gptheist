import { enterPaper } from "./liquidity-history-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";
import { formatUnits, parseUnits } from "viem";
import { fixture } from "./paper-fixtures.js";
import { readPaperQuote, usdToWei } from "../src/paper-quotes.js";
import { curveAmountOut } from "../src/paper-math.js";
import {  initialPaperState, liveCandidate, markPaperPosition, monitorPaper  } from "../src/paper.js";

for (const decimals of [6, 8, 9, 18]) test(`exact BUY→SELL quantity with verified ${decimals} decimals`, async () => {
  const f = fixture(); f.state.decimals = decimals;
  const result = await f.buy();
  assert.equal(result.status, "AVAILABLE"); if (result.status !== "AVAILABLE") return;
  const q = result.quote, sell = q.roundTrip!.sell;
  assert.equal(q.evidence!.tokenDecimals, decimals);
  assert.equal(parseUnits(q.humanAmountOut!, decimals).toString(), q.tokenUnits);
  assert.equal(formatUnits(BigInt(q.tokenUnits!), decimals), sell.humanAmountIn);
  assert.equal(q.tokenUnits, sell.evidence!.amountIn);
  assert.ok(q.roundTrip!.lossPercent > 0);
  assert.ok(result.diagnostics!.roundTripSell!.diagnostics!.rpc.some(r => r.method === "eth_call"));
});

test("USD conversion floors exact integer wei, including amounts beyond float precision", () => {
  assert.equal(usdToWei("10", "3000"), 3333333333333333n);
  assert.equal(usdToWei("1.000000000000000001", "1"), 1000000000000000001n);
  assert.throws(() => usdToWei("NaN", "3000"));
});
test("curve model preserves integer floor and Solidity overflow rejection", () => {
  assert.equal(curveAmountOut(7n, 13n, 29n), 10n);
  assert.throws(() => curveAmountOut(1n << 255n, 10n, 10n), /OVERFLOW/);
  assert.throws(() => curveAmountOut(1n, 100n, 1n), /INSUFFICIENT_OUTPUT/);
});
test("BUY with no executable full-quantity SELL fails before opening", async () => {
  const f = fixture(); f.state.real = 1n;
  const c = liveCandidate(f.launch); c.quote = await f.buy();
  assert.equal(c.quote.status, "NOT_PAPER_TRADABLE");
  assert.equal(c.quote.reason, "INSUFFICIENT_EXIT_LIQUIDITY");
  const state = initialPaperState(f.time); enterPaper(state, c, 10, f.time);
  assert.equal(state.positions.length, 0); assert.equal(state.cash, 1000);
});
test("all entry paths reject missing, stale, or wrong-quantity pre-entry SELL", async () => {
  for (const mode of ["missing", "stale", "quantity"] as const) {
    const f = fixture(), c = liveCandidate(f.launch); c.quote = await f.buy();
    if (c.quote.status !== "AVAILABLE") throw new Error("fixture");
    if (mode === "missing") delete c.quote.quote.roundTrip;
    else if (mode === "stale") c.quote.quote.roundTrip!.sell.timestamp = new Date(f.time - 60000).toISOString();
    else c.quote.quote.roundTrip!.sell.tokenUnits = "1";
    const state = initialPaperState(f.time);
    assert.notEqual(enterPaper(state, c, 10, f.time).outcome, "PAPER_BUY");
    assert.equal(state.positions.length, 0);
  }
});
test("success → failure → recovery retains value without fake cash, exit or -100%", async () => {
  const f = fixture(), c = liveCandidate(f.launch); c.quote = await f.buy();
  const state = initialPaperState(f.time); enterPaper(state, c, 10, f.time);
  const p = state.positions[0]!, before = structuredClone(p.current), cash = state.cash;
  assert.ok(p.management.lastSuccessfulQuote);
  markPaperPosition(state, p.id, { status: "NOT_PAPER_TRADABLE", reason: "RPC_RATE_LIMIT", details: ["429"] }, f.time);
  assert.deepEqual(p.current, before); assert.equal(p.markStatus, "UNAVAILABLE");
  assert.equal(state.cash, cash); assert.equal(state.trades.length, 0); assert.ok(p.current.notionalUsd > 0);
  const recovered = await readPaperQuote(f.rpc, async () => f.state.usd, f.launch,
    { side: "SELL", tokenUnits: p.entry.tokenUnits!, quantity: p.quantity }, () => f.time);
  assert.equal(markPaperPosition(state, p.id, recovered, f.time), true);
  assert.equal(p.markStatus, "FRESH"); assert.equal(p.management.consecutiveQuoteFailures, 0);
  assert.equal(state.trades.length, 0);
});
for (const [message, reason] of [["429 rate limit", "RPC_RATE_LIMIT"], ["request timeout", "RPC_TIMEOUT"], ["offline", "RPC_ERROR"], ["execution reverted", "CONTRACT_REVERT"]]) {
  test(`structured ${reason} preserves failures`, async () => {
    const f = fixture(); const result = await readPaperQuote(async () => { throw new Error(message); }, async () => f.state.usd,
      f.launch, { side: "BUY", sizeUsd: 10 }, () => f.time);
    assert.equal(result.status, "NOT_PAPER_TRADABLE"); assert.equal(result.reason, reason);
  });
}
test("triggered exit requires distinct final quote and remains pending on failure", async () => {
  const f = fixture(), c = liveCandidate(f.launch); c.quote = await f.buy();
  const state = initialPaperState(f.time); enterPaper(state, c, 10, f.time);
  const p = state.positions[0]!; p.plan.exitPolicy.maxHoldMs = 1;
  let calls = 0;
  await monitorPaper(state, async () => ++calls === 1 ? { status: "AVAILABLE", quote: p.current } :
    { status: "NOT_PAPER_TRADABLE", reason: "QUOTE_TIMEOUT", details: [] }, () => f.time + 2);
  assert.equal(calls, 2); assert.ok(p.management.pendingExit); assert.equal(state.trades.length, 0);
});
test("unknown or negative traction never opens a position", async () => {
  const f = fixture(), c = liveCandidate(f.launch); c.quote = await f.buy();
  c.recentTraction = { status: "UNKNOWN", lastVerifiedActivityTime: null, explanation: "No observation pair" };
  const state = initialPaperState(f.time);
  assert.equal(enterPaper(state, c, 10, f.time).reason, "INSUFFICIENT_TRACTION");
});

test("quote service deduplicates identical work and serializes different sizes for one token", async () => {
  const { PaperQuoteService } = await import("../src/paper-quotes.js");
  const { PAPER_CONFIG } = await import("../src/paper.js");
  const f = fixture(); let active = 0, peak = 0, chains = 0;
  const rpc: typeof f.rpc = async (method, params) => {
    if (method === "eth_chainId") {
      chains++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
    }
    return f.rpc(method, params);
  };
  const service = new PaperQuoteService(rpc, PAPER_CONFIG, (async () => new Response(JSON.stringify({
    bid: "2000", ask: "2000", time: f.state.usd.timestamp
  }))) as typeof fetch, () => f.time);
  const [a, b, duplicate] = await Promise.all([service.buy(f.launch, 10), service.buy(f.launch, 11), service.buy(f.launch, 10)]);
  assert.equal(a.status, "AVAILABLE"); assert.equal(b.status, "AVAILABLE"); assert.deepEqual(a, duplicate);
  assert.equal(chains, 4, "Two independent buy/sell pairs, not three"); assert.equal(peak, 1);
});

test("excursions start at measured liquidation; favorable excursion is zero until profitable", async () => {
  const f = fixture(), c = liveCandidate(f.launch); c.quote = await f.buy();
  const state = initialPaperState(f.time); enterPaper(state, c, 10, f.time);
  const p = state.positions[0]!;
  assert.equal(p.management.mfePercent, 0); assert.ok(p.management.maePercent! < 0);
  const q = structuredClone(p.current); q.notionalUsd = 12; q.fillPriceUsd = 12 / q.quantity;
  markPaperPosition(state, p.id, { status: "AVAILABLE", quote: q }, f.time);
  assert.ok(Math.abs(p.management.mfePercent! - 20) < 1e-8);
  assert.ok(p.management.maePercent! < 0); assert.equal(p.management.peakLiquidationValueUsd, 12);
});

test("integer model reproduces five actual settled Pons sells and their separately rounded fees", async () => {
  const { readFile } = await import("node:fs/promises");
  const { parseAbi, decodeEventLog } = await import("viem");
  const capture = JSON.parse(await readFile("fixtures/paper-contract-observations.json", "utf8"));
  const abi = parseAbi(["event CurveSell(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 quoteOut,uint256 fee,uint256 tax)"]);
  assert.equal(capture.sells.length, 5);
  for (const row of capture.sells) {
    assert.equal(row.factoryMatches, true);
    const a = decodeEventLog({ abi, eventName: "CurveSell", data: row.rawEvent.data, topics: row.rawEvent.topics }).args;
    const [qr, tr] = row.reads.getReserves.decoded.map(BigInt);
    const gross = curveAmountOut(a.tokensIn, tr, qr);
    const fee = gross * BigInt(row.reads.feeBps.decoded) / 10000n;
    const tax = gross * BigInt(row.reads.creatorTaxBps.decoded) / 10000n;
    assert.equal(fee, a.fee); assert.equal(tax, a.tax); assert.equal(gross - fee - tax, a.quoteOut);
  }
});

import { enterPaper } from "./liquidity-history-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./paper-fixtures.js";
import { readPaperQuote } from "../src/paper-quotes.js";
import {  initialPaperState, liveCandidate, markPaperPosition, quoteProblem  } from "../src/paper.js";

test("liquidity rejection carries exact numerical proof without diagnostics consumers", async () => {
  const f = fixture(), buy = await f.buy();
  if (buy.status !== "AVAILABLE") throw new Error("fixture");
  f.state.real = 1n;
  const result = await readPaperQuote(f.rpc, async () => f.state.usd, f.launch, {
    side: "SELL", tokenUnits: buy.quote.tokenUnits!, quantity: buy.quote.quantity, tokenDecimals: 18
  }, () => f.time);
  assert.equal(result.status, "NOT_PAPER_TRADABLE");
  if (result.status !== "NOT_PAPER_TRADABLE") throw new Error("Expected rejection");
  assert.equal(result.reason, "INSUFFICIENT_EXIT_LIQUIDITY");
  const c = result.diagnostics!.calculation!;
  assert.ok(BigInt(c.grossWei!) > BigInt(c.realQuoteReserveWei!));
  assert.ok(result.details!.some(d => d.includes(`condition: ${c.grossWei} > 1 = true`)));
});

for (const side of ["BUY", "SELL"] as const) test(`${side} rejects raw evidence contradicting retained quantity`, async () => {
  const f = fixture(), buy = await f.buy();
  if (buy.status !== "AVAILABLE") throw new Error("fixture");
  const q = structuredClone(side === "BUY" ? buy.quote : buy.quote.roundTrip!.sell);
  q.evidence![side === "BUY" ? "amountOut" : "amountIn"] = "1";
  assert.equal(quoteProblem(q, f.time, 30000), "TOKEN_QUANTITY_MISMATCH");
  const c = liveCandidate(f.launch), state = initialPaperState(f.time);
  c.quote = { status: "AVAILABLE", quote: side === "BUY" ? q : { ...buy.quote, roundTrip: { ...buy.quote.roundTrip!, sell: q } } };
  assert.equal(enterPaper(state, c, 10, f.time).reason, "TOKEN_QUANTITY_MISMATCH");
  assert.equal(state.positions.length, 0);
});

for (const failure of ["double-scaled", "human-zero", "decimals-changed"] as const) test(`${failure} is identified BEFORE insufficient liquidity`, async () => {
  const f = fixture(), buy = await f.buy();
  if (buy.status !== "AVAILABLE") throw new Error("fixture");
  f.state.real = 1n;
  const q = buy.quote;
  const result = await readPaperQuote(f.rpc, async () => f.state.usd, f.launch, {
    side: "SELL", tokenUnits: failure === "double-scaled" ? String(BigInt(q.tokenUnits!) * 10n ** 18n) : q.tokenUnits!,
    quantity: failure === "human-zero" ? 0 : q.quantity,
    tokenDecimals: failure === "decimals-changed" ? 9 : 18
  }, () => f.time);
  assert.equal(result.status, "NOT_PAPER_TRADABLE");
  assert.equal(result.reason, failure === "double-scaled" ? "TOKEN_QUANTITY_MISMATCH" : failure === "human-zero" ? "INVALID_TOKEN_AMOUNT" : "TOKEN_DECIMALS_MISMATCH");
  assert.equal(result.diagnostics?.calculation, undefined);
});

test("gas exceeding proceeds is not a liquidity shortage and cannot create a fake exit", async () => {
  const f = fixture(), c = liveCandidate(f.launch); c.quote = await f.buy();
  const s = initialPaperState(f.time); enterPaper(s, c, 10, f.time);
  const p = s.positions[0]!, before = structuredClone(p.current), q = structuredClone(p.current);
  q.costs.gasUsd = q.notionalUsd + 1;
  assert.equal(markPaperPosition(s, p.id, { status: "AVAILABLE", quote: q }, f.time), false);
  assert.equal(p.markReason, "EXIT_COST_EXCEEDS_PROCEEDS"); assert.deepEqual(p.current, before); assert.equal(s.trades.length, 0);
});

test("inconsistent reported USD liquidity is INVALID_QUOTE_LIQUIDITY, not proof of a chain shortage", async () => {
  const f = fixture(), c = liveCandidate(f.launch); c.quote = await f.buy();
  const s = initialPaperState(f.time); enterPaper(s, c, 10, f.time);
  const p = s.positions[0]!, q = structuredClone(p.current); q.liquidityUsd = q.notionalUsd / 2;
  markPaperPosition(s, p.id, { status: "AVAILABLE", quote: q }, f.time);
  assert.equal(p.markReason, "INVALID_QUOTE_LIQUIDITY");
});

test("market research RPC failure preserves its transport classification", async () => {
  const f = fixture();
  const rpc: typeof f.rpc = async (method, params) => {
    if (method === "eth_call") throw new Error("RPC connection failed");
    return f.rpc(method, params);
  };
  const result = await readPaperQuote(rpc, async () => f.state.usd, f.launch, { side: "BUY", sizeUsd: 10 }, () => f.time);
  assert.equal(result.status, "NOT_PAPER_TRADABLE"); assert.equal(result.reason, "RPC_ERROR");
});

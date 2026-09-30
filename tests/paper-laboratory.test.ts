import test from "node:test";
import assert from "node:assert/strict";
import { PaperStrategyLaboratory, type PaperMarketFrame } from "../src/paper-laboratory.js";
import { fixture } from "./paper-fixtures.js";

test("shadow laboratory rejects future information, replay, and missing sizes without fabricated fills", async () => {
  const f = fixture(), lab = new PaperStrategyLaboratory(f.time);
  const frame: PaperMarketFrame = { sequence: 1, completedAt: new Date(f.time).toISOString(), snapshot: f.snapshot, buys: [], sells: [] };
  await lab.consume(frame);
  for (const state of Object.values(lab.state.portfolios)) { assert.equal(state.positions.length, 0); assert.equal(state.cash, 1000); }
  await assert.rejects(lab.consume(frame), /NON_CHRONOLOGICAL/);
  const buy = await f.buy(); if (buy.status !== "AVAILABLE") throw new Error("fixture");
  buy.quote.timestamp = new Date(f.time + 1).toISOString();
  await assert.rejects(lab.consume({ ...frame, sequence: 2, buys: [{ token: f.launch.token, sizeUsd: 10, result: buy }] }), /FUTURE_QUOTE/);
  assert.equal(lab.state.sequence, 1);
  const restored = new PaperStrategyLaboratory(f.time, JSON.parse(JSON.stringify(lab.state)));
  assert.deepEqual(restored.metrics(), lab.metrics());
  restored.state.portfolios.CONTROL.cash = 1;
  assert.equal(lab.state.portfolios.CONTROL.cash, 1000);
  assert.equal(restored.state.portfolios.RUNNER.cash, 1000);
});

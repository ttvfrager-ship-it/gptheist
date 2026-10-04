import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync("assets/desk/paper.js", "utf8");
const renderer = source.split("\n").find(line => line.startsWith("function entryFdv("))!;
function render(entry: Record<string, unknown>) {
  return runInNewContext(`${renderer}; entryFdv(p)`, {
    p: { entry }, money: (value: unknown) => Number.isFinite(value) ? String(value) : "N/A",
    node: (_tag: string, text: string) => ({ text, title: "" })
  }) as { text: string; title: string };
}

test("curve FDV renderer preserves legacy values and prefers explicit derived valuation", () => {
  const legacy = { marketCapUsd: 36577.19068888635 };
  assert.equal(render(legacy).text, "36577.19068888635");
  assert.equal(render({ ...legacy, derivedFdvUsd: 123 }).text, "123");
  assert.equal(render({}).text, "N/A");
  assert.match(render(legacy).title, /including virtual reserves/);
  assert.match(render(legacy).title, /Pons displayed market cap is unverified/);
  assert.deepEqual(legacy, { marketCapUsd: 36577.19068888635 });
  const html = readFileSync("assets/desk/paper.html", "utf8");
  assert.equal((html.match(/ENTRY CURVE FDV/g) ?? []).length, 2);
  assert.doesNotMatch(html, /ENTRY MC/);
});

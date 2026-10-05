import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { PaperStore } from "../src/paper-store.js";
import { createDeskServer, stopDeskServer } from "../src/server.js";

test("one SCALP owner, 100 concurrent dashboard reads, idempotent startup and preserved restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paper-owner-"));
  const previous = process.env.PAPER_STRATEGY_MODE;
  process.env.PAPER_STRATEGY_MODE = "SCALP";
  let server: ReturnType<typeof createDeskServer> | undefined;
  try {
    const seed = await PaperStore.open(directory);
    await seed.update(s => { s.cash = 876; s.config.STARTING_BALANCE_USD = 876; s.history.push({ timestamp: new Date().toISOString(), equity: 876, stalePositions: 0 }); });
    const before = seed.read(); await seed.close();
    const messages: string[] = [];
    const options = { paperDirectory: directory, rpc: async (): Promise<unknown> => { throw new Error("offline fixture"); },
      paperUsdFetch: (async () => new Response("{}", { status: 503 })) as typeof fetch,
      paperLog: (message: string) => { messages.push(message); } };
    server = createDeskServer(options);
    assert.equal(createDeskServer(options), server);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const originalOpen = PaperStore.open;
    let readOwnershipAttempts = 0;
    PaperStore.open = async directory => { readOwnershipAttempts++; return originalOpen.call(PaperStore, directory); };
    const responses = await Promise.all(Array.from({ length: 100 }, (_, i) => fetch(base + (i % 2 ? "/paper" : "/api/paper"))));
    PaperStore.open = originalOpen;
    assert.equal(readOwnershipAttempts, 0);
    for (const response of responses) { assert.equal(response.status, 200); await response.arrayBuffer(); }
    const view = await (await fetch(base + "/api/paper")).json() as { cash: number; config: { PAPER_STRATEGY_VERSION: number }; monitor: { lastCompletedAt: string } };
    assert.equal(view.cash, before.cash); assert.equal(view.config.PAPER_STRATEGY_VERSION, 4);
    assert.ok(view.monitor.lastCompletedAt);
    assert.equal(messages.filter(m => m.startsWith("PAPER started:")).length, 1);
    await assert.rejects(PaperStore.open(directory), /already owned/);
    await stopDeskServer(server); server = undefined;
    const reload = await PaperStore.open(directory);
    assert.equal(reload.read().cash, before.cash);
    assert.deepEqual(reload.read().history, before.history);
    assert.equal(reload.read().config.PAPER_STRATEGY_VERSION, 4);
    await reload.close(); await reload.close();
  } finally {
    if (server) await stopDeskServer(server);
    if (previous === undefined) delete process.env.PAPER_STRATEGY_MODE; else process.env.PAPER_STRATEGY_MODE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("SIGKILL releases kernel ownership without resetting persisted state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paper-killed-"));
  const modulePath = resolve("dist/src/paper-store.js");
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `import { PaperStore } from ${JSON.stringify("file://" + modulePath)}; const store = await PaperStore.open(${JSON.stringify(directory)}); await store.update(s => { s.cash = 765; s.config.STARTING_BALANCE_USD = 765; }); console.log("ready"); setInterval(() => {}, 1000);`],
    { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await Promise.race([once(child.stdout!, "data"), once(child, "exit").then(() => { throw new Error("ownership child exited before ready"); })]);
    await assert.rejects(PaperStore.open(directory), /already owned/);
    const before = await readFile(join(directory, "state.json"), "utf8");
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    const restarted = await PaperStore.open(directory);
    assert.equal(restarted.read().cash, 765);
    const old = JSON.parse(before) as Record<string, unknown>;
    const loaded = restarted.read() as unknown as Record<string, unknown>;
    for (const key of Object.keys(old)) assert.deepEqual(loaded[key], old[key]);
    await restarted.close();
  } finally { child.kill("SIGKILL"); await rm(directory, { recursive: true, force: true }); }
});

test("legacy PID locks fail closed without an established old-runtime stop", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paper-legacy-"));
  try {
    await writeFile(join(directory, "writer.lock"), "1");
    await assert.rejects(PaperStore.open(directory), /cannot be verified safely/);
    assert.equal(await readFile(join(directory, "writer.lock"), "utf8"), "1");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

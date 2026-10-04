import assert from "node:assert/strict";
import test from "node:test";
import { PaperGasCounter } from "../src/paper-gas.js";
import { fixture } from "./paper-fixtures.js";
import { readPaperQuote } from "../src/paper-quotes.js";

test("gas uses the correct chain rate, deducts both sides and retains evidence", async () => {
  const f = fixture(); let now = f.time, calls = 0;
  const gas = new PaperGasCounter(async method => { calls++; return method === "eth_chainId" ? "0x1237" : "0x3b9aca00"; }, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({result:body.method === "eth_chainId" ? "0x1" : "0x77359400"}));
  }, () => now);
  await Promise.all([gas.refresh(), gas.refresh()]); assert.equal(calls,2);
  assert.equal(gas.status(2000).estimatedSwapUsd,.4);
  assert.equal(gas.status(2000).ethereumReferenceSwapUsd,.8);
  const result = await readPaperQuote(f.rpc,async()=>f.state.usd,f.launch,{side:"BUY",sizeUsd:10},()=>now);
  assert.equal(result.status,"AVAILABLE"); if(result.status!=="AVAILABLE") return;
  const q=result.quote, original=structuredClone(q);gas.apply(q);
  assert.equal(q.costs.gasUsd,200000*1e9/1e18*q.evidence!.ethUsd);
  assert.equal(q.gasEstimate?.chainId,4663);
  assert.equal(q.roundTrip!.entryUsd,10+q.costs.gasUsd!);
  assert.equal(q.roundTrip!.immediateExitUsd,q.roundTrip!.sell.notionalUsd-q.roundTrip!.sell.costs.gasUsd!);
  assert.equal(q.roundTrip!.lossUsd,q.roundTrip!.entryUsd-q.roundTrip!.immediateExitUsd);
  now+=31000;assert.equal(gas.status(2000).chain,null);gas.apply(original);assert.equal(original.costs.gasUsd,null);
});

test("wrong chain and failed gas data stay unknown without spoiling quotes", async()=>{
  const f=fixture(),gas=new PaperGasCounter(async()=>"0x1",async()=>new Response("{}",{status:503}),()=>f.time);
  await gas.refresh();assert.equal(gas.status(2000).status,"UNAVAILABLE");
  const result=await readPaperQuote(f.rpc,async()=>f.state.usd,f.launch,{side:"BUY",sizeUsd:10},()=>f.time);
  assert.equal(result.status,"AVAILABLE");if(result.status!=="AVAILABLE")return;
  gas.apply(result.quote);assert.equal(result.quote.costs.gasUsd,null);
});

test("production read-only RPC adapter permits gas price reads", async()=>{
  const { createHttpRpcCaller } = await import("../src/server.js");
  let method="";
  const rpc=createHttpRpcCaller("https://example.invalid",{fetch:async(_url,init)=>{
    method=JSON.parse(String(init?.body)).method;
    return new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:"0x3b9aca00"}));
  }});
  assert.equal(await rpc("eth_gasPrice"),"0x3b9aca00");assert.equal(method,"eth_gasPrice");
});

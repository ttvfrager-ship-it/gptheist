import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./paper-fixtures.js";
import { readPaperQuote } from "../src/paper-quotes.js";

test("independent quote RPC reads overlap while canonical verification remains separate",async()=>{
 const f=fixture();let releaseHead!:()=>void,releaseHeader!:()=>void;
 const headGate=new Promise<void>(resolve=>{releaseHead=resolve;});
 const headerGate=new Promise<void>(resolve=>{releaseHeader=resolve;});
 let headStarted=false,callsWhileHeaderWaiting=0,headers=0,firstHeaderReleased=false;
 const rpc:typeof f.rpc=async(method,params=[])=>{
  if(method==="eth_chainId")await headGate;
  if(method==="eth_blockNumber"){headStarted=true;releaseHead();}
  if(method==="eth_getBlockByNumber"&&params[0]==="0x2"&&++headers===1){
   setImmediate(()=>{firstHeaderReleased=true;releaseHeader();});await headerGate;
  }
  if(method==="eth_call"&&!firstHeaderReleased)callsWhileHeaderWaiting++;
  return f.rpc(method,params);
 };
 const result=await readPaperQuote(rpc,async()=>f.state.usd,f.launch,{side:"BUY",sizeUsd:10},()=>f.time);
 assert.equal(result.status,"AVAILABLE");assert.equal(headStarted,true);
 assert.ok(callsWhileHeaderWaiting>=2,"pinned contract reads must start without waiting for the header response");
 assert.ok(headers>=4,"buy and full-size SELL retain separate canonical block verification");
});

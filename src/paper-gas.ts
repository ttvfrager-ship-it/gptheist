import type { RpcCaller } from "./live.js";
import { ROBINHOOD_CHAIN_ID } from "./live.js";
import type { PaperQuote } from "./paper.js";

export const PAPER_SWAP_GAS_UNITS = 200_000;
export const ETHEREUM_GAS_RPC = "https://ethereum-rpc.publicnode.com";
export interface GasRate { chainId: number; priceWei: string; gwei: number; timestamp: string }
export class PaperGasCounter {
  private chain: GasRate | null = null;
  private ethereum: GasRate | null = null;
  private attemptedAt = -Infinity;
  private pending: Promise<void> | undefined;
  constructor(private rpc: RpcCaller, private fetcher: typeof fetch = fetch, private clock = Date.now) {}
  async refresh(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.clock() - this.attemptedAt < 10_000) return;
    this.attemptedAt = this.clock();
    const read = async (rpc: RpcCaller, expected: number): Promise<GasRate> => {
      const [id, price] = await Promise.all([rpc("eth_chainId"), rpc("eth_gasPrice")]);
      if (id !== `0x${expected.toString(16)}` || typeof price !== "string" || !/^0x[0-9a-f]+$/i.test(price)) throw new Error("Invalid gas response");
      const wei = BigInt(price), gwei = Number(wei) / 1e9;
      if (!Number.isFinite(gwei) || gwei < 0) throw new Error("Invalid gas price");
      return { chainId: expected, priceWei: wei.toString(), gwei, timestamp: new Date(this.clock()).toISOString() };
    };
    const mainnet: RpcCaller = async (method, params = []) => {
      const response = await this.fetcher(ETHEREUM_GAS_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({jsonrpc:"2.0",id:1,method,params}), signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error("Ethereum gas unavailable");
      const data = await response.json() as { result?: unknown; error?: unknown };
      if (data.error) throw new Error("Ethereum gas unavailable");
      return data.result;
    };
    this.pending = Promise.allSettled([read(this.rpc, ROBINHOOD_CHAIN_ID), read(mainnet, 1)]).then(([chain, ethereum]) => {
      this.chain = chain.status === "fulfilled" ? chain.value : null;
      this.ethereum = ethereum.status === "fulfilled" ? ethereum.value : null;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private fresh(rate: GasRate | null): GasRate | null { const age = rate ? this.clock() - Date.parse(rate.timestamp) : Infinity; return rate && age >= 0 && age <= 30_000 ? rate : null; }
  status(ethUsd: number | null) {
    const chain = this.fresh(this.chain), ethereum = this.fresh(this.ethereum);
    const cost = (rate: GasRate | null) => rate && ethUsd ? Number(BigInt(rate.priceWei) * BigInt(PAPER_SWAP_GAS_UNITS)) / 1e18 * ethUsd : null;
    return { status: chain ? "LIVE" : "UNAVAILABLE", chain, ethereum, assumedGasUnits: PAPER_SWAP_GAS_UNITS, estimatedSwapUsd: cost(chain), ethereumReferenceSwapUsd: cost(ethereum), model: "ASSUMED_SWAP_UNITS", excludes: "Approval, failed transactions and any additional chain fees; actual usage is unknown" };
  }
  apply(quote: PaperQuote): void {
    const rate = this.fresh(this.chain);
    // Migrated routes have different transaction requirements; keep these unknown.
    if (!rate || !quote.evidence || quote.evidence.chainId !== rate.chainId) return;
    const usd = Number(BigInt(rate.priceWei) * BigInt(PAPER_SWAP_GAS_UNITS)) / 1e18 * quote.evidence.ethUsd;
    if (!Number.isFinite(usd) || usd < 0) return;
    quote.costs.gasUsd = usd;
    quote.gasEstimate = { ...rate, gasUnits: PAPER_SWAP_GAS_UNITS, model: "ASSUMED_SWAP_UNITS" };
    if (quote.roundTrip) {
      this.apply(quote.roundTrip.sell);
      const rt = quote.roundTrip;
      rt.entryUsd = quote.notionalUsd + usd;
      rt.immediateExitUsd = rt.sell.notionalUsd - (rt.sell.costs.gasUsd ?? 0);
      rt.lossUsd = rt.entryUsd - rt.immediateExitUsd;
      rt.lossPercent = rt.lossUsd / rt.entryUsd * 100;
    }
  }
}

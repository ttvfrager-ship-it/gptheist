# Sell failure proof — 2026-09-28

ROOT CAUSE: Verified free ETH reserves are below the gross sized sell output for all five legacy paper allocations. Paper buys never deposited ETH on chain. Their original entries have no full-position pre-entry SELL evidence. Current quantity conversions match exactly; no unit correction is justified. This does not prove precisely when historical liquidity drained.

BEFORE: HOODS block 74944644 required 688318550541766 wei versus 1 wei available. AFTER: block 74946278 requires the same amounts and correctly rejects. No liquidity was fabricated.

## Every executable generation site

| File | Function | Line | Condition |

|---|---|---:|---|

| src/paper-quotes.ts | calculatePaperQuote | 176 | `gross > real` |

| dist/src/paper-quotes.js | calculatePaperQuote (compiled copy) | 223 | enclosing `gross > real` |

| tests/paper-flow.test.ts | injected async PaperService sell callback | 158 | unconditional test failure when callback runs |

| dist/tests/paper-flow.test.js | compiled test callback | 185 | same unconditional injection |

All remaining source occurrences are assertions or documentation, not generators. Exact search output follows.

```

./PAPER_ENGINE_AUDIT.md:19:if (gross > realQuoteReserve) reject INSUFFICIENT_EXIT_LIQUIDITY
./src/paper-quotes.ts:176:      if (gross > real) return unavailable("INSUFFICIENT_EXIT_LIQUIDITY", [
./tests/paper-sell-debug.test.ts:16:  assert.equal(result.reason, "INSUFFICIENT_EXIT_LIQUIDITY");
./tests/paper-reliability.test.ts:36:  assert.equal(c.quote.reason, "INSUFFICIENT_EXIT_LIQUIDITY");
./tests/paper-flow.test.ts:158:    return { status: "NOT_PAPER_TRADABLE", reason: "INSUFFICIENT_EXIT_LIQUIDITY", details: ["Real reserve is 1 wei"] };
./tests/paper-flow.test.ts:168:    assert.equal(p.markReason, "INSUFFICIENT_EXIT_LIQUIDITY");
./tests/paper-flow.test.ts:187:  assert.equal(result.diagnostics?.failure, "INSUFFICIENT_EXIT_LIQUIDITY");
./POSITION_QUOTE_INVESTIGATION.md:22:- Persisted consecutive failures: 51; saved underlying reason: INSUFFICIENT_EXIT_LIQUIDITY
./POSITION_QUOTE_INVESTIGATION.md:28:- Result: NOT_PAPER_TRADABLE / INSUFFICIENT_EXIT_LIQUIDITY
./POSITION_QUOTE_INVESTIGATION.md:41:- Persisted consecutive failures: 46; saved underlying reason: INSUFFICIENT_EXIT_LIQUIDITY
./POSITION_QUOTE_INVESTIGATION.md:47:- Result: NOT_PAPER_TRADABLE / INSUFFICIENT_EXIT_LIQUIDITY
./POSITION_QUOTE_INVESTIGATION.md:79:- Persisted consecutive failures: 30; saved underlying reason: INSUFFICIENT_EXIT_LIQUIDITY
./POSITION_QUOTE_INVESTIGATION.md:85:- Result: NOT_PAPER_TRADABLE / INSUFFICIENT_EXIT_LIQUIDITY
./POSITION_QUOTE_INVESTIGATION.md:98:- Persisted consecutive failures: 22; saved underlying reason: INSUFFICIENT_EXIT_LIQUIDITY
./POSITION_QUOTE_INVESTIGATION.md:104:- Result: NOT_PAPER_TRADABLE / INSUFFICIENT_EXIT_LIQUIDITY


```

## Structured real position traces

### hoods

```json

{
  "reconstructedBuyRaw": "409881356835236675132219",
  "savedBuyArithmeticMatches": true,
  "independentGrossWei": "688318550541766",
  "directReserveMatchesService": true,
  "decimalsAgree": true,
  "positionId": "07ea788b-f8d9-4a89-9f38-b5ea37a3833b",
  "token": "Hood Scan",
  "symbol": "hoods",
  "tokenAddress": "0xa1dafdefcf115e15632f5d69950ac4b52ce2ee52",
  "curveAddress": "0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
  "pair": "0x0000000000000000000000000000000000000000",
  "block": 74946278,
  "blockTimestamp": "2026-09-28T16:37:13.000Z",
  "chainDecimals": 18,
  "storedDecimals": 18,
  "quoteServiceDecimals": "18",
  "exactHumanQuantity": "409881.356835236675132219",
  "persistedHumanQuantity": 409881.35683523666,
  "buyRawTokenOutput": "409881356835236675132219",
  "persistedRawQuantity": "409881356835236675132219",
  "sellRawTokenInput": "409881356835236675132219",
  "rawQuantityMatches": true,
  "curveState": {
    "status": "VERIFIED",
    "creatorFeeRecipient": "0x5994dcf500c047af56d71b556967a5fc68fa0feb",
    "creatorTaxBps": 400,
    "buybackEnabled": false,
    "phase": "CURVE",
    "quoteReserve": "1680000000000000001",
    "tokenReserve": "1000000000000000000000000000",
    "realQuoteReserve": "1",
    "graduationThreshold": "4200000000000000000",
    "progressBps": 0,
    "currentSnipeTaxBps": 0
  },
  "graduated": false,
  "readyToGraduate": false,
  "tokenReserveRaw": "1000000000000000000000000000",
  "tokenReserveFormatted": "1000000000",
  "pricingEthReserveRaw": "1680000000000000001",
  "pricingEthReserve": "1.680000000000000001",
  "availableEthRaw": "1",
  "availableEth": "0.000000000000000001",
  "quoteMethod": "PINNED_PONS_V2_INTEGER_MODEL; no on-chain SELL quote selector; view calls supply reserves and fees",
  "quoteContract": "0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
  "independentDirectReads": {
    "decimals": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xa1dafdefcf115e15632f5d69950ac4b52ce2ee52",
          "data": "0x313ce567"
        },
        "0x47796e6"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000012",
      "decoded": 18
    },
    "getReserves": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
          "data": "0x0902f1ac"
        },
        "0x47796e6"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000017508f1956a800010000000000000000000000000000000000000000033b2e3c9fd0803ce8000000",
      "decoded": [
        "1680000000000000001",
        "1000000000000000000000000000"
      ]
    },
    "realQuoteReserve": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
          "data": "0x4f1f58fd"
        },
        "0x47796e6"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000001",
      "decoded": "1"
    },
    "graduated": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
          "data": "0xe7c2b772"
        },
        "0x47796e6"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "readyToGraduate": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
          "data": "0xc68360a5"
        },
        "0x47796e6"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "feeBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
          "data": "0x24a9d853"
        },
        "0x47796e6"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000064",
      "decoded": "100"
    },
    "creatorTaxBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
          "data": "0xc1bb8901"
        },
        "0x47796e6"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000190",
      "decoded": "400"
    }
  },
  "calculation": {
    "tokenUnits": "409881356835236675132219",
    "grossWei": "688318550541766",
    "feeWei": "6883185505417",
    "creatorTaxWei": "27532742021670",
    "ethOutWei": "653902623014679",
    "realQuoteReserveWei": "1",
    "decimals": "18"
  },
  "liquidityComparison": {
    "expression": "688318550541766 > 1",
    "result": true
  },
  "rejectedModelEthOut": "0.000653902623014679",
  "executableEthOut": null,
  "executableUsdOut": null,
  "ethUsd": {
    "status": "AVAILABLE",
    "bid": 2690.56,
    "ask": 2690.68,
    "timestamp": "2026-09-28T16:37:10.787367437Z",
    "source": "https://api.exchange.coinbase.com/products/ETH-USD/ticker"
  },
  "status": "NOT_PAPER_TRADABLE",
  "failureReason": "INSUFFICIENT_EXIT_LIQUIDITY",
  "ageMsAtCompletion": 480,
  "entry": {
    "usdInput": 2.0400000000000005,
    "ethUsd": 2690.15,
    "ethInWei": "758322026652789",
    "ethIn": "0.000758322026652789"
  },
  "buyEvidence": {
    "model": "PONS_V2_CURVE",
    "chainId": 4663,
    "curve": "0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
    "blockHash": "0xc7b23851f355c9c42b4c70c01e6fdee47eba421992bd43302b513bf76aba05b3",
    "ethUsd": 2690.15,
    "usdTimestamp": "2026-09-26T16:56:34.541762341Z",
    "usdSource": "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
    "tokenDecimals": 18,
    "quoteReserve": "1718000000000000000",
    "tokenReserve": "977881257275902211874272410",
    "realQuoteReserve": "38000000000000000",
    "feeBps": 100,
    "creatorTaxBps": 400,
    "snipeTaxBps": 0,
    "progressBps": 90,
    "amountIn": "758322026652789",
    "amountOut": "409881356835236675132219",
    "quoteAsset": "ETH",
    "feeWei": "7583220266527",
    "creatorTaxWei": "30332881066111",
    "snipeTaxWei": "0",
    "modelSource": "https://docs.ponsfamily.com/v2#getting-a-quote"
  },
  "failureDetails": [
    "block=74946278; curve=0xe5e1ba4d053a1b53a336a6000527a4f192efac5e",
    "requestedTokenAmount=409881356835236675132219; tokenReserve=1000000000000000000000000000; pricingQuoteReserveWei=1680000000000000001",
    "grossEthOutputWei=688318550541766; availableEthWei=1; condition: 688318550541766 > 1 = true",
    "feeWei=6883185505417; creatorTaxWei=27532742021670; netEthOutputWei=653902623014679 (not executable)"
  ]
}

```

### NETWORK

```json

{
  "reconstructedBuyRaw": "271089989789736212617457",
  "savedBuyArithmeticMatches": true,
  "independentGrossWei": "455307753481374",
  "directReserveMatchesService": true,
  "decimalsAgree": true,
  "positionId": "d2c5754f-92a9-41e3-b845-526be40dbdfc",
  "token": "Voxx Network",
  "symbol": "NETWORK",
  "tokenAddress": "0x16ff148dbc95a7c4160149cf0e68d6f2ea8164ac",
  "curveAddress": "0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
  "pair": "0x0000000000000000000000000000000000000000",
  "block": 74946289,
  "blockTimestamp": "2026-09-28T16:37:14.000Z",
  "chainDecimals": 18,
  "storedDecimals": 18,
  "quoteServiceDecimals": "18",
  "exactHumanQuantity": "271089.989789736212617457",
  "persistedHumanQuantity": 271089.9897897362,
  "buyRawTokenOutput": "271089989789736212617457",
  "persistedRawQuantity": "271089989789736212617457",
  "sellRawTokenInput": "271089989789736212617457",
  "rawQuantityMatches": true,
  "curveState": {
    "status": "VERIFIED",
    "creatorFeeRecipient": "0xbfe030bd89e731f9c001513a7cddc559144be261",
    "creatorTaxBps": 200,
    "buybackEnabled": false,
    "phase": "CURVE",
    "quoteReserve": "1680000000016344081",
    "tokenReserve": "999999999990271380372597917",
    "realQuoteReserve": "16344081",
    "graduationThreshold": "4200000000000000000",
    "progressBps": 0,
    "currentSnipeTaxBps": 0
  },
  "graduated": false,
  "readyToGraduate": false,
  "tokenReserveRaw": "999999999990271380372597917",
  "tokenReserveFormatted": "999999999.990271380372597917",
  "pricingEthReserveRaw": "1680000000016344081",
  "pricingEthReserve": "1.680000000016344081",
  "availableEthRaw": "16344081",
  "availableEth": "0.000000000016344081",
  "quoteMethod": "PINNED_PONS_V2_INTEGER_MODEL; no on-chain SELL quote selector; view calls supply reserves and fees",
  "quoteContract": "0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
  "independentDirectReads": {
    "decimals": {
      "method": "eth_call",
      "params": [
        {
          "to": "0x16ff148dbc95a7c4160149cf0e68d6f2ea8164ac",
          "data": "0x313ce567"
        },
        "0x47796f1"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000012",
      "decoded": 18
    },
    "getReserves": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
          "data": "0x0902f1ac"
        },
        "0x47796f1"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000017508f1957a164110000000000000000000000000000000000000000033b2e3c9fadf01c22f42c9d",
      "decoded": [
        "1680000000016344081",
        "999999999990271380372597917"
      ]
    },
    "realQuoteReserve": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
          "data": "0x4f1f58fd"
        },
        "0x47796f1"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000f96411",
      "decoded": "16344081"
    },
    "graduated": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
          "data": "0xe7c2b772"
        },
        "0x47796f1"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "readyToGraduate": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
          "data": "0xc68360a5"
        },
        "0x47796f1"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "feeBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
          "data": "0x24a9d853"
        },
        "0x47796f1"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000064",
      "decoded": "100"
    },
    "creatorTaxBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
          "data": "0xc1bb8901"
        },
        "0x47796f1"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000000000000000000c8",
      "decoded": "200"
    }
  },
  "calculation": {
    "tokenUnits": "271089989789736212617457",
    "grossWei": "455307753481374",
    "feeWei": "4553077534813",
    "creatorTaxWei": "9106155069627",
    "ethOutWei": "441648520876934",
    "realQuoteReserveWei": "16344081",
    "decimals": "18"
  },
  "liquidityComparison": {
    "expression": "455307753481374 > 16344081",
    "result": true
  },
  "rejectedModelEthOut": "0.000441648520876934",
  "executableEthOut": null,
  "executableUsdOut": null,
  "ethUsd": {
    "status": "AVAILABLE",
    "bid": 2690.56,
    "ask": 2690.68,
    "timestamp": "2026-09-28T16:37:10.787367437Z",
    "source": "https://api.exchange.coinbase.com/products/ETH-USD/ticker"
  },
  "status": "NOT_PAPER_TRADABLE",
  "failureReason": "INSUFFICIENT_EXIT_LIQUIDITY",
  "ageMsAtCompletion": 639,
  "entry": {
    "usdInput": 1.2999999999999992,
    "ethUsd": 2689.83,
    "ethInWei": "483301918708617",
    "ethIn": "0.000483301918708617"
  },
  "buyEvidence": {
    "model": "PONS_V2_CURVE",
    "chainId": 4663,
    "curve": "0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
    "blockHash": "0x8dca08cad26164875b0b2d5bd9c25855d4d296bddb568f9169da5397d2e1b499",
    "ethUsd": 2689.83,
    "usdTimestamp": "2026-09-26T16:56:38.941418925Z",
    "usdSource": "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
    "tokenDecimals": 18,
    "quoteReserve": "1704250000000000000",
    "tokenReserve": "985770866950271380372597917",
    "realQuoteReserve": "24250000000000000",
    "feeBps": 100,
    "creatorTaxBps": 200,
    "snipeTaxBps": 0,
    "progressBps": 57,
    "amountIn": "483301918708617",
    "amountOut": "271089989789736212617457",
    "quoteAsset": "ETH",
    "feeWei": "4833019187086",
    "creatorTaxWei": "9666038374172",
    "snipeTaxWei": "0",
    "modelSource": "https://docs.ponsfamily.com/v2#getting-a-quote"
  },
  "failureDetails": [
    "block=74946289; curve=0xc6f40f2163c8e6a558c13b8d8ec62402c7127460",
    "requestedTokenAmount=271089989789736212617457; tokenReserve=999999999990271380372597917; pricingQuoteReserveWei=1680000000016344081",
    "grossEthOutputWei=455307753481374; availableEthWei=16344081; condition: 455307753481374 > 16344081 = true",
    "feeWei=4553077534813; creatorTaxWei=9106155069627; netEthOutputWei=441648520876934 (not executable)"
  ]
}

```

### THECARDWALL

```json

{
  "reconstructedBuyRaw": "406881433656953733440164",
  "savedBuyArithmeticMatches": true,
  "independentGrossWei": "683282793466786",
  "directReserveMatchesService": true,
  "decimalsAgree": true,
  "positionId": "089129c4-1706-430f-917c-8f36017e9bde",
  "token": "TheCardWall",
  "symbol": "THECARDWALL",
  "tokenAddress": "0x3fc63daf84f0e2a13a0206b5bb32ad3ae38b19c3",
  "curveAddress": "0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
  "pair": "0x0000000000000000000000000000000000000000",
  "block": 74946300,
  "blockTimestamp": "2026-09-28T16:37:15.000Z",
  "chainDecimals": 18,
  "storedDecimals": 18,
  "quoteServiceDecimals": "18",
  "exactHumanQuantity": "406881.433656953733440164",
  "persistedHumanQuantity": 406881.43365695374,
  "buyRawTokenOutput": "406881433656953733440164",
  "persistedRawQuantity": "406881433656953733440164",
  "sellRawTokenInput": "406881433656953733440164",
  "rawQuantityMatches": true,
  "curveState": {
    "status": "VERIFIED",
    "creatorFeeRecipient": "0xb570889e19d9ff8cc53f9b02af0daec521c310c0",
    "creatorTaxBps": 200,
    "buybackEnabled": false,
    "phase": "CURVE",
    "quoteReserve": "1680000000007009802",
    "tokenReserve": "999999999995827499038943187",
    "realQuoteReserve": "7009802",
    "graduationThreshold": "4200000000000000000",
    "progressBps": 0,
    "currentSnipeTaxBps": 0
  },
  "graduated": false,
  "readyToGraduate": false,
  "tokenReserveRaw": "999999999995827499038943187",
  "tokenReserveFormatted": "999999999.995827499038943187",
  "pricingEthReserveRaw": "1680000000007009802",
  "pricingEthReserve": "1.680000000007009802",
  "availableEthRaw": "7009802",
  "availableEth": "0.000000000007009802",
  "quoteMethod": "PINNED_PONS_V2_INTEGER_MODEL; no on-chain SELL quote selector; view calls supply reserves and fees",
  "quoteContract": "0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
  "independentDirectReads": {
    "decimals": {
      "method": "eth_call",
      "params": [
        {
          "to": "0x3fc63daf84f0e2a13a0206b5bb32ad3ae38b19c3",
          "data": "0x313ce567"
        },
        "0x47796fc"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000012",
      "decoded": 18
    },
    "getReserves": {
      "method": "eth_call",
      "params": [
        {
          "to": "0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
          "data": "0x0902f1ac"
        },
        "0x47796fc"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000017508f195712f60a0000000000000000000000000000000000000000033b2e3c9fc1ad5ed26427d3",
      "decoded": [
        "1680000000007009802",
        "999999999995827499038943187"
      ]
    },
    "realQuoteReserve": {
      "method": "eth_call",
      "params": [
        {
          "to": "0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
          "data": "0x4f1f58fd"
        },
        "0x47796fc"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000000000000006af60a",
      "decoded": "7009802"
    },
    "graduated": {
      "method": "eth_call",
      "params": [
        {
          "to": "0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
          "data": "0xe7c2b772"
        },
        "0x47796fc"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "readyToGraduate": {
      "method": "eth_call",
      "params": [
        {
          "to": "0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
          "data": "0xc68360a5"
        },
        "0x47796fc"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "feeBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
          "data": "0x24a9d853"
        },
        "0x47796fc"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000064",
      "decoded": "100"
    },
    "creatorTaxBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
          "data": "0xc1bb8901"
        },
        "0x47796fc"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000000000000000000c8",
      "decoded": "200"
    }
  },
  "calculation": {
    "tokenUnits": "406881433656953733440164",
    "grossWei": "683282793466786",
    "feeWei": "6832827934667",
    "creatorTaxWei": "13665655869335",
    "ethOutWei": "662784309662784",
    "realQuoteReserveWei": "7009802",
    "decimals": "18"
  },
  "liquidityComparison": {
    "expression": "683282793466786 > 7009802",
    "result": true
  },
  "rejectedModelEthOut": "0.000662784309662784",
  "executableEthOut": null,
  "executableUsdOut": null,
  "ethUsd": {
    "status": "AVAILABLE",
    "bid": 2690.56,
    "ask": 2690.68,
    "timestamp": "2026-09-28T16:37:10.787367437Z",
    "source": "https://api.exchange.coinbase.com/products/ETH-USD/ticker"
  },
  "status": "NOT_PAPER_TRADABLE",
  "failureReason": "INSUFFICIENT_EXIT_LIQUIDITY",
  "ageMsAtCompletion": 777,
  "entry": {
    "usdInput": 1.9800000000000002,
    "ethUsd": 2689.23,
    "ethInWei": "736270233486909",
    "ethIn": "0.000736270233486909"
  },
  "buyEvidence": {
    "model": "PONS_V2_CURVE",
    "chainId": 4663,
    "curve": "0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
    "blockHash": "0x9b4a15a6abdac96935c27ff6eb03184cd909dc9a995d76ce89f66af5ea1413bf",
    "ethUsd": 2689.23,
    "usdTimestamp": "2026-09-26T17:05:07.394365011Z",
    "usdSource": "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
    "tokenDecimals": 18,
    "quoteReserve": "1716860000000000000",
    "tokenReserve": "978530573255827499038943187",
    "realQuoteReserve": "36860000000000000",
    "feeBps": 100,
    "creatorTaxBps": 200,
    "snipeTaxBps": 0,
    "progressBps": 87,
    "amountIn": "736270233486909",
    "amountOut": "406881433656953733440164",
    "quoteAsset": "ETH",
    "feeWei": "7362702334869",
    "creatorTaxWei": "14725404669738",
    "snipeTaxWei": "0",
    "modelSource": "https://docs.ponsfamily.com/v2#getting-a-quote"
  },
  "failureDetails": [
    "block=74946300; curve=0x9d78fccab3bad1e5192e80765fc9a4d6acd5a492",
    "requestedTokenAmount=406881433656953733440164; tokenReserve=999999999995827499038943187; pricingQuoteReserveWei=1680000000007009802",
    "grossEthOutputWei=683282793466786; availableEthWei=7009802; condition: 683282793466786 > 7009802 = true",
    "feeWei=6832827934667; creatorTaxWei=13665655869335; netEthOutputWei=662784309662784 (not executable)"
  ]
}

```

### CLANKCAP

```json

{
  "reconstructedBuyRaw": "1255299966393095046707635",
  "savedBuyArithmeticMatches": true,
  "independentGrossWei": "2106259955489059",
  "directReserveMatchesService": true,
  "decimalsAgree": true,
  "positionId": "fe68a85d-63c0-4a16-8157-a5bff669e68a",
  "token": "Clankcap",
  "symbol": "CLANKCAP",
  "tokenAddress": "0x91db55e83f88de1d5da026ebe2a4f55bed6d8d08",
  "curveAddress": "0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
  "pair": "0x0000000000000000000000000000000000000000",
  "block": 74946312,
  "blockTimestamp": "2026-09-28T16:37:16.000Z",
  "chainDecimals": 18,
  "storedDecimals": 18,
  "quoteServiceDecimals": "18",
  "exactHumanQuantity": "1255299.966393095046707635",
  "persistedHumanQuantity": 1255299.966393095,
  "buyRawTokenOutput": "1255299966393095046707635",
  "persistedRawQuantity": "1255299966393095046707635",
  "sellRawTokenInput": "1255299966393095046707635",
  "rawQuantityMatches": true,
  "curveState": {
    "status": "VERIFIED",
    "creatorFeeRecipient": "0x4f8ae39856548446cf43c8015e83d900dc86946f",
    "creatorTaxBps": 200,
    "buybackEnabled": false,
    "phase": "CURVE",
    "quoteReserve": "1680000000000000006",
    "tokenReserve": "1000000000000000000000000000",
    "realQuoteReserve": "6",
    "graduationThreshold": "4200000000000000000",
    "progressBps": 0,
    "currentSnipeTaxBps": 0
  },
  "graduated": false,
  "readyToGraduate": false,
  "tokenReserveRaw": "1000000000000000000000000000",
  "tokenReserveFormatted": "1000000000",
  "pricingEthReserveRaw": "1680000000000000006",
  "pricingEthReserve": "1.680000000000000006",
  "availableEthRaw": "6",
  "availableEth": "0.000000000000000006",
  "quoteMethod": "PINNED_PONS_V2_INTEGER_MODEL; no on-chain SELL quote selector; view calls supply reserves and fees",
  "quoteContract": "0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
  "independentDirectReads": {
    "decimals": {
      "method": "eth_call",
      "params": [
        {
          "to": "0x91db55e83f88de1d5da026ebe2a4f55bed6d8d08",
          "data": "0x313ce567"
        },
        "0x4779708"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000012",
      "decoded": 18
    },
    "getReserves": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
          "data": "0x0902f1ac"
        },
        "0x4779708"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000017508f1956a800060000000000000000000000000000000000000000033b2e3c9fd0803ce8000000",
      "decoded": [
        "1680000000000000006",
        "1000000000000000000000000000"
      ]
    },
    "realQuoteReserve": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
          "data": "0x4f1f58fd"
        },
        "0x4779708"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000006",
      "decoded": "6"
    },
    "graduated": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
          "data": "0xe7c2b772"
        },
        "0x4779708"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "readyToGraduate": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
          "data": "0xc68360a5"
        },
        "0x4779708"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "feeBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
          "data": "0x24a9d853"
        },
        "0x4779708"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000064",
      "decoded": "100"
    },
    "creatorTaxBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
          "data": "0xc1bb8901"
        },
        "0x4779708"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000000000000000000c8",
      "decoded": "200"
    }
  },
  "calculation": {
    "tokenUnits": "1255299966393095046707635",
    "grossWei": "2106259955489059",
    "feeWei": "21062599554890",
    "creatorTaxWei": "42125199109781",
    "ethOutWei": "2043072156824388",
    "realQuoteReserveWei": "6",
    "decimals": "18"
  },
  "liquidityComparison": {
    "expression": "2106259955489059 > 6",
    "result": true
  },
  "rejectedModelEthOut": "0.002043072156824388",
  "executableEthOut": null,
  "executableUsdOut": null,
  "ethUsd": {
    "status": "AVAILABLE",
    "bid": 2690.56,
    "ask": 2690.68,
    "timestamp": "2026-09-28T16:37:10.787367437Z",
    "source": "https://api.exchange.coinbase.com/products/ETH-USD/ticker"
  },
  "status": "NOT_PAPER_TRADABLE",
  "failureReason": "INSUFFICIENT_EXIT_LIQUIDITY",
  "ageMsAtCompletion": 878,
  "entry": {
    "usdInput": 6.759999999999999,
    "ethUsd": 2687.04,
    "ethInWei": "2515779445039895",
    "ethIn": "0.002515779445039895"
  },
  "buyEvidence": {
    "model": "PONS_V2_CURVE",
    "chainId": 4663,
    "curve": "0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
    "blockHash": "0x7a3c617a300e96c7e1e768f7425aed3d29f74dce3f52d4e9c3301f867883097e",
    "ethUsd": 2687.04,
    "usdTimestamp": "2026-09-26T17:15:24.640408553Z",
    "usdSource": "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
    "tokenDecimals": 18,
    "quoteReserve": "1805967000000000008",
    "tokenReserve": "930249556055010967840499607",
    "realQuoteReserve": "125967000000000008",
    "feeBps": 100,
    "creatorTaxBps": 200,
    "snipeTaxBps": 0,
    "progressBps": 299,
    "amountIn": "2515779445039895",
    "amountOut": "1255299966393095046707635",
    "quoteAsset": "ETH",
    "feeWei": "25157794450398",
    "creatorTaxWei": "50315588900797",
    "snipeTaxWei": "0",
    "modelSource": "https://docs.ponsfamily.com/v2#getting-a-quote"
  },
  "failureDetails": [
    "block=74946312; curve=0xba534ff82bbbced6ded75fc2d7ab75450eaaa98e",
    "requestedTokenAmount=1255299966393095046707635; tokenReserve=1000000000000000000000000000; pricingQuoteReserveWei=1680000000000000006",
    "grossEthOutputWei=2106259955489059; availableEthWei=6; condition: 2106259955489059 > 6 = true",
    "feeWei=21062599554890; creatorTaxWei=42125199109781; netEthOutputWei=2043072156824388 (not executable)"
  ]
}

```

### CELCIUS

```json

{
  "reconstructedBuyRaw": "1757829155833184821365663",
  "savedBuyArithmeticMatches": true,
  "independentGrossWei": "2947970952508881",
  "directReserveMatchesService": true,
  "decimalsAgree": true,
  "positionId": "5f156574-c0b4-4d95-a0f5-a0a7015cffb2",
  "token": "Celcius",
  "symbol": "CELCIUS",
  "tokenAddress": "0xdc57901c2721d2ce07d5b3ba5ff815e3c558098f",
  "curveAddress": "0xecf5d9dea14fc71be990feb795445fc09974f3a2",
  "pair": "0x0000000000000000000000000000000000000000",
  "block": 74946323,
  "blockTimestamp": "2026-09-28T16:37:17.000Z",
  "chainDecimals": 18,
  "storedDecimals": 18,
  "quoteServiceDecimals": "18",
  "exactHumanQuantity": "1757829.155833184821365663",
  "persistedHumanQuantity": 1757829.1558331847,
  "buyRawTokenOutput": "1757829155833184821365663",
  "persistedRawQuantity": "1757829155833184821365663",
  "sellRawTokenInput": "1757829155833184821365663",
  "rawQuantityMatches": true,
  "curveState": {
    "status": "VERIFIED",
    "creatorFeeRecipient": "0xb4f24ce8f6fb45c33bd387a562e5ae7eeeb2e7b0",
    "creatorTaxBps": 200,
    "buybackEnabled": false,
    "phase": "CURVE",
    "quoteReserve": "1680000000000000004",
    "tokenReserve": "1000000000000000000000000000",
    "realQuoteReserve": "4",
    "graduationThreshold": "4200000000000000000",
    "progressBps": 0,
    "currentSnipeTaxBps": 0
  },
  "graduated": false,
  "readyToGraduate": false,
  "tokenReserveRaw": "1000000000000000000000000000",
  "tokenReserveFormatted": "1000000000",
  "pricingEthReserveRaw": "1680000000000000004",
  "pricingEthReserve": "1.680000000000000004",
  "availableEthRaw": "4",
  "availableEth": "0.000000000000000004",
  "quoteMethod": "PINNED_PONS_V2_INTEGER_MODEL; no on-chain SELL quote selector; view calls supply reserves and fees",
  "quoteContract": "0xecf5d9dea14fc71be990feb795445fc09974f3a2",
  "independentDirectReads": {
    "decimals": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xdc57901c2721d2ce07d5b3ba5ff815e3c558098f",
          "data": "0x313ce567"
        },
        "0x4779713"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000012",
      "decoded": 18
    },
    "getReserves": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xecf5d9dea14fc71be990feb795445fc09974f3a2",
          "data": "0x0902f1ac"
        },
        "0x4779713"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000017508f1956a800040000000000000000000000000000000000000000033b2e3c9fd0803ce8000000",
      "decoded": [
        "1680000000000000004",
        "1000000000000000000000000000"
      ]
    },
    "realQuoteReserve": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xecf5d9dea14fc71be990feb795445fc09974f3a2",
          "data": "0x4f1f58fd"
        },
        "0x4779713"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000004",
      "decoded": "4"
    },
    "graduated": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xecf5d9dea14fc71be990feb795445fc09974f3a2",
          "data": "0xe7c2b772"
        },
        "0x4779713"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "readyToGraduate": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xecf5d9dea14fc71be990feb795445fc09974f3a2",
          "data": "0xc68360a5"
        },
        "0x4779713"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "decoded": false
    },
    "feeBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xecf5d9dea14fc71be990feb795445fc09974f3a2",
          "data": "0x24a9d853"
        },
        "0x4779713"
      ],
      "rawResponse": "0x0000000000000000000000000000000000000000000000000000000000000064",
      "decoded": "100"
    },
    "creatorTaxBps": {
      "method": "eth_call",
      "params": [
        {
          "to": "0xecf5d9dea14fc71be990feb795445fc09974f3a2",
          "data": "0xc1bb8901"
        },
        "0x4779713"
      ],
      "rawResponse": "0x00000000000000000000000000000000000000000000000000000000000000c8",
      "decoded": "200"
    }
  },
  "calculation": {
    "tokenUnits": "1757829155833184821365663",
    "grossWei": "2947970952508881",
    "feeWei": "29479709525088",
    "creatorTaxWei": "58959419050177",
    "ethOutWei": "2859531823933616",
    "realQuoteReserveWei": "4",
    "decimals": "18"
  },
  "liquidityComparison": {
    "expression": "2947970952508881 > 4",
    "result": true
  },
  "rejectedModelEthOut": "0.002859531823933616",
  "executableEthOut": null,
  "executableUsdOut": null,
  "ethUsd": {
    "status": "AVAILABLE",
    "bid": 2690.56,
    "ask": 2690.68,
    "timestamp": "2026-09-28T16:37:10.787367437Z",
    "source": "https://api.exchange.coinbase.com/products/ETH-USD/ticker"
  },
  "status": "NOT_PAPER_TRADABLE",
  "failureReason": "INSUFFICIENT_EXIT_LIQUIDITY",
  "ageMsAtCompletion": 1002,
  "entry": {
    "usdInput": 10.2,
    "ethUsd": 2687.94,
    "ethInWei": "3794727560883055",
    "ethIn": "0.003794727560883055"
  },
  "buyEvidence": {
    "model": "PONS_V2_CURVE",
    "chainId": 4663,
    "curve": "0xecf5d9dea14fc71be990feb795445fc09974f3a2",
    "blockHash": "0x6d47687b8700009ba52e8d65fc63eac16a199e7b8e60cfbdcdf73a784a7f2adf",
    "ethUsd": 2687.94,
    "usdTimestamp": "2026-09-26T17:36:28.506145451Z",
    "usdSource": "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
    "tokenDecimals": 18,
    "quoteReserve": "1873770190000000000",
    "tokenReserve": "896588070920265841138181415",
    "realQuoteReserve": "193770190000000000",
    "feeBps": 100,
    "creatorTaxBps": 200,
    "snipeTaxBps": 0,
    "progressBps": 461,
    "amountIn": "3794727560883055",
    "amountOut": "1757829155833184821365663",
    "quoteAsset": "ETH",
    "feeWei": "37947275608830",
    "creatorTaxWei": "75894551217661",
    "snipeTaxWei": "0",
    "modelSource": "https://docs.ponsfamily.com/v2#getting-a-quote"
  },
  "failureDetails": [
    "block=74946323; curve=0xecf5d9dea14fc71be990feb795445fc09974f3a2",
    "requestedTokenAmount=1757829155833184821365663; tokenReserve=1000000000000000000000000000; pricingQuoteReserveWei=1680000000000000004",
    "grossEthOutputWei=2947970952508881; availableEthWei=4; condition: 2947970952508881 > 4 = true",
    "feeWei=29479709525088; creatorTaxWei=58959419050177; netEthOutputWei=2859531823933616 (not executable)"
  ]
}

```

## Conversion audit

The BUY model returns raw bigint tokens. `units.toString()` persists them unchanged. `formatUnits(units, decimals)` divides ONCE for display; Number conversion is display/consistency only. SELL parses the retained integer with BigInt and prices it directly: ZERO decimal multiplications (correct for already-raw input). No parseUnits/parseEther or human-to-raw reconstruction exists in the production sell path. Native ETH output is divided once by 10^18 using formatUnits for USD conversion. USD BUY sizing uses rational integer division in usdToWei; the 10^18 multiplication there applies to ETH, not tokens. Math.floor/round in position sizing and policy apply to USD sizing or policy numbers, not sell token input. Human floats are never converted back into raw amounts. Every selected position has matching chain/stored/service decimals=18, reconstructed BUY raw output, stored raw units, and SELL raw input.

Exact conversion search:

```

src/paper-quotes.ts:2:import { decodeFunctionResult, encodeFunctionData, formatUnits, parseAbi, type Hex } from "viem";
src/paper-quotes.ts:14:    return [BigInt(whole! + fraction), 10n ** BigInt(fraction.length)];
src/paper-quotes.ts:28:  "function decimals() view returns (uint8)"
src/paper-quotes.ts:68:        const bid = Number(data.bid), ask = Number(data.ask);
src/paper-quotes.ts:100:    if (typeof block !== "string" || !/^0x[0-9a-f]+$/i.test(block) || !Number.isSafeInteger(Number(BigInt(block)))) return unavailable("INVALID_BLOCK");
src/paper-quotes.ts:101:    if (diagnostics) diagnostics.currentBlock = Number(BigInt(block));
src/paper-quotes.ts:103:    const blockTimestamp = new Date(Number(BigInt(h.timestamp)) * 1000).toISOString();
src/paper-quotes.ts:139:      const human = Number(formatUnits(BigInt(order.tokenUnits), decimals));
src/paper-quotes.ts:142:    const qr = BigInt(market.quoteReserve), tr = BigInt(market.tokenReserve), real = BigInt(market.realQuoteReserve);
src/paper-quotes.ts:143:    const tax = BigInt(market.creatorTaxBps);
src/paper-quotes.ts:146:    const rawSnipe = BigInt(market.currentSnipeTaxBps);
src/paper-quotes.ts:154:    const toUsd = (wei: bigint): number => Number(formatUnits(wei, 18)) * ethUsd;
src/paper-quotes.ts:168:      impact = Number(net) / Number(qr + net) * 100;
src/paper-quotes.ts:171:      units = BigInt(order.tokenUnits);
src/paper-quotes.ts:177:        `block=${Number(BigInt(block))}; curve=${launch.curve}`,
src/paper-quotes.ts:184:      impact = Number(units) / Number(tr + units) * 100;
src/paper-quotes.ts:186:    const quantity = Number(formatUnits(units, decimals));
src/paper-quotes.ts:190:      humanAmountIn: formatUnits(amountIn, order.side === "BUY" ? 18 : decimals), humanAmountOut: formatUnits(amountOut, order.side === "BUY" ? decimals : 18),
src/paper-quotes.ts:193:      source: "Pons v2 sized curve model + Coinbase ETH/USD", blockNumber: Number(BigInt(block)),
src/paper-quotes.ts:194:      rawPriceUsd: toUsd(qr) / Number(formatUnits(tr, decimals)), fillPriceUsd: notionalUsd / quantity,
src/paper-quotes.ts:200:        feeBps: Number(fee), creatorTaxBps: Number(tax), snipeTaxBps: Number(snipe), progressBps: market.progressBps,
src/paper-quotes.ts:241:        const time = Number(BigInt(h.timestamp)) * 1000;
src/paper-quotes.ts:260:      knownFeesUsd: [buy, sell.quote].reduce((sum, q) => sum + Number(formatUnits(BigInt(q.evidence!.feeWei), 18)) * q.evidence!.ethUsd, 0),
src/paper-quotes.ts:261:      knownTaxesUsd: [buy, sell.quote].reduce((sum, q) => sum + Number(formatUnits(BigInt(q.evidence!.creatorTaxWei) + BigInt(q.evidence!.snipeTaxWei), 18)) * q.evidence!.ethUsd, 0) };
src/paper.ts:366:    probeSize = Math.floor(probeSize * 50) / 100; candidate.quote = await get(probeSize);
src/paper.ts:404:    size = Math.floor(size * 50) / 100;
src/paper-store.ts:68:        const pid = Number(await readSafe(lock));
src/paper-store.ts:81:        if (Number(raw.schemaVersion) === 1) {
src/paper-store.ts:93:        state.config.PAPER_MAX_LAUNCH_AGE_SECONDS = Number(process.env.PAPER_MAX_LAUNCH_AGE_SECONDS);
src/paper-store.ts:97:        const interval = Number(process.env.PAPER_QUOTE_REFRESH_MS);


```

## Pons contract verification

Official quote specification: https://docs.ponsfamily.com/v2#getting-a-quote . It specifies local integer pricing; no curve quote view function exists. Reads use pinned getReserves(), realQuoteReserve(), graduation flags, decimals and identity checks. Reserve order is quote then token; SELL reverses them for pricing. Pricing includes phantom ETH, while the execution bound uses real free ETH.

Public Solidity inspected: https://github.com/ponsdotdev/pons-labs/blob/6bca41795baab5a5a8ee797e1ad31cd0bd4686b2/contractsV2/src/v2/PonsV2BondingCurve.sol . getReserves lines 301–304 and realQuoteReserve lines 317–319 establish reserve semantics. sell lines 446–470 prices raw tokens, floors fee and creator tax independently, accrues both and sends net ETH. Therefore free reserve consumption is net+fee+tax=gross. Protocol share is distributed inside the fee, not an additional sell charge. No sell snipe tax. Graduation and readyToGraduate reject. The math library preserves uint256 intermediate bounds and integer floor.

This public revision is not verified deployed bytecode and lacks the current snipe implementation. Existing captured settled-event regression fixtures corroborate normal sell arithmetic. Fresh historical parent-state reconstruction was attempted for five events; all returned RPC HTTP 403. No claim of fresh archival execution proof is made. These failures are RPC_ERROR, never evidence of insufficient liquidity.

## Error classification and entry validation

Only the verified gross > real branch emits the liquidity reason. Transport errors/timeouts/reverts, unavailable curve state, changed decimals, graduation, stale quotes and unavailable USD remain distinct. Raw evidence inconsistent with retained token units now returns TOKEN_QUANTITY_MISMATCH. Unsupported pairs and graduation remain rejected, not guessed.

The pre-existing uncommitted implementation already requires BUY → exact raw output → independent full-position SELL → fresh round-trip validation → admission. This turn adds raw evidence equality validation in quoteProblem so mismatched BUY amountOut or SELL amountIn cannot bypass it. Existing drained-reserve and missing/stale/wrong-quantity round-trip tests pass. No gate can guarantee liquidity remains available after admission.

## New live launch and five observations

Token Summer: 0xedfa59ac21ef27bbb7e6340976765b87b1d0fac9. Isolated paper account: /tmp/gptheist-live-XHAEBf/paper. It entered under existing gates and then closed through DYNAMIC_RISK_EXIT. Five observations below are read-only quotes of its original exact allocation after closure; they do not reopen it or represent five held-position monitor marks.

```json

{
  "entry": {
    "quoteRequestedAt": "2026-09-28T16:36:43.095Z",
    "quoteMethod": "PINNED_PONS_V2_INTEGER_MODEL",
    "humanAmountIn": "0.004091643904342494",
    "humanAmountOut": "872134.504035866051899794",
    "quoteAssetDecimals": 18,
    "graduationState": "CURVE",
    "tokenAddress": "0xedfa59ac21ef27bbb7e6340976765b87b1d0fac9",
    "side": "BUY",
    "timestamp": "2026-09-28T16:36:43.571Z",
    "blockTimestamp": "2026-09-28T16:36:43.000Z",
    "source": "Pons v2 sized curve model + Coinbase ETH/USD",
    "blockNumber": 74945982,
    "rawPriceUsd": 1.2479847151027263e-05,
    "fillPriceUsd": 1.262419953464795e-05,
    "quantity": 872134.504035866,
    "tokenUnits": "872134504035866051899794",
    "notionalUsd": 11.01,
    "liquidityUsd": 2990.480204962438,
    "costs": {
      "feesUsd": 0.11009999999999746,
      "priceImpactPercent": 0.1449067835065093,
      "slippageUsd": null,
      "gasUsd": null
    },
    "evidence": {
      "model": "PONS_V2_CURVE",
      "chainId": 4663,
      "curve": "0xa9ace4bb425684bfd8fb479552549351c31bff8d",
      "blockHash": "0x2dd7d506190731bfa4712171c0340e5726ec5a80c191fd50d41f3caafb79fe12",
      "ethUsd": 2690.85,
      "usdTimestamp": "2026-09-28T16:36:37.333793769Z",
      "usdSource": "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
      "tokenDecimals": 18,
      "quoteReserve": "2791351507873883198",
      "tokenReserve": "601858990263688616855167806",
      "realQuoteReserve": "1111351507873883198",
      "feeBps": 100,
      "creatorTaxBps": 0,
      "snipeTaxBps": 0,
      "progressBps": 2646,
      "amountIn": "4091643904342494",
      "amountOut": "872134504035866051899794",
      "quoteAsset": "ETH",
      "feeWei": "40916439043424",
      "creatorTaxWei": "0",
      "snipeTaxWei": "0",
      "modelSource": "https://docs.ponsfamily.com/v2#getting-a-quote"
    },
    "roundTrip": {
      "sell": {
        "quoteRequestedAt": "2026-09-28T16:36:43.571Z",
        "quoteMethod": "PINNED_PONS_V2_INTEGER_MODEL",
        "humanAmountIn": "872134.504035866051899794",
        "humanAmountOut": "0.003998614845399004",
        "quoteAssetDecimals": 18,
        "graduationState": "CURVE",
        "tokenAddress": "0xedfa59ac21ef27bbb7e6340976765b87b1d0fac9",
        "side": "SELL",
        "timestamp": "2026-09-28T16:36:44.054Z",
        "blockTimestamp": "2026-09-28T16:36:43.000Z",
        "source": "Pons v2 sized curve model + Coinbase ETH/USD",
        "blockNumber": 74945987,
        "rawPriceUsd": 1.2478965953279821e-05,
        "fillPriceUsd": 1.233630015798438e-05,
        "quantity": 872134.504035866,
        "tokenUnits": "872134504035866051899794",
        "notionalUsd": 10.758913019921282,
        "liquidityUsd": 2990.2690481759423,
        "costs": {
          "feesUsd": 0.1086758890901132,
          "priceImpactPercent": 0.14469710758208515,
          "slippageUsd": null,
          "gasUsd": null
        },
        "evidence": {
          "model": "PONS_V2_CURVE",
          "chainId": 4663,
          "curve": "0xa9ace4bb425684bfd8fb479552549351c31bff8d",
          "blockHash": "0xe322946efda4dc34b5837211a60665a50a6d68ac56ea70786961bf7c2dd337aa",
          "ethUsd": 2690.66,
          "usdTimestamp": "2026-09-28T16:36:37.333793769Z",
          "usdSource": "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
          "tokenDecimals": 18,
          "quoteReserve": "2791351507873883198",
          "tokenReserve": "601858990263688616855167806",
          "realQuoteReserve": "1111351507873883198",
          "feeBps": 100,
          "creatorTaxBps": 0,
          "snipeTaxBps": 0,
          "progressBps": 2646,
          "amountIn": "872134504035866051899794",
          "amountOut": "3998614845399004",
          "quoteAsset": "ETH",
          "feeWei": "40390048943424",
          "creatorTaxWei": "0",
          "snipeTaxWei": "0",
          "modelSource": "https://docs.ponsfamily.com/v2#getting-a-quote"
        }
      },
      "entryUsd": 11.01,
      "immediateExitUsd": 10.758913019921282,
      "lossUsd": 0.25108698007871766,
      "lossPercent": 2.2805356955378553,
      "knownFeesUsd": 0.21877588909011067,
      "knownTaxesUsd": 0
    }
  },
  "observations": [
    {
      "number": 1,
      "block": 74946524,
      "rawInput": "872134504035866051899794",
      "rawOutput": "8070087978573485",
      "ethOut": "0.008070087978573485",
      "usdOut": 21.706841943887174,
      "blockAgeMs": 1237,
      "status": "LIVE",
      "failure": null
    },
    {
      "number": 2,
      "block": 74946558,
      "rawInput": "872134504035866051899794",
      "rawOutput": "7773995484035270",
      "ethOut": "0.00777399548403527",
      "usdOut": 20.910415313003227,
      "blockAgeMs": 664,
      "status": "LIVE",
      "failure": null
    },
    {
      "number": 3,
      "block": 74946592,
      "rawInput": "872134504035866051899794",
      "rawOutput": "6216472690518470",
      "ethOut": "0.00621647269051847",
      "usdOut": 16.72523327965923,
      "blockAgeMs": 1088,
      "status": "LIVE",
      "failure": null
    },
    {
      "number": 4,
      "block": 74946625,
      "rawInput": "872134504035866051899794",
      "rawOutput": "6044386494975663",
      "ethOut": "0.006044386494975663",
      "usdOut": 16.26224053313717,
      "blockAgeMs": 508,
      "status": "LIVE",
      "failure": null
    },
    {
      "number": 5,
      "block": 74946660,
      "rawInput": "872134504035866051899794",
      "rawOutput": "8780301667124185",
      "ethOut": "0.008780301667124185",
      "usdOut": 23.619713908697427,
      "blockAgeMs": 944,
      "status": "LIVE",
      "failure": null
    }
  ]
}

```

## Changes and verification

Changed this turn: src/paper-quotes.ts (numerical rejection details); src/paper.ts (raw evidence equality); tests/paper-sell-debug.test.ts (three new regressions); tests/paper.test.ts and tests/paper-policy.test.ts (consistent synthetic quote evidence); scripts/paper-sell-five-observations.mjs (read-only proof command); this report. Earlier dirty-worktree changes were preserved, not claimed as new.

Existing command verified: `npm run debug:paper-sell -- HOODS` or `-- all`. It loads the real persisted account without writing it, reads direct decimals/reserves and prints raw RPC requests/responses and comparisons.

Build passed. Paper tests 95/95. Full suite 135/137; two existing doctor tests fail because runtime dependency codex is outside the allowlist. git diff --check passed. No strategy, retry, freshness, wallet, signing or broadcast changes; no commits or pushes.

All full raw RPC observations and logs are preserved under runs/sell-root-cause-2026-09-28/.

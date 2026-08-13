import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { collectSnapshot } from "../dist/research/collect.js";

const CONFIG = {
  apiBaseUrl: "https://example.invalid",
  solanaRpcUrl: "https://rpc.invalid",
  stateDir: null,
  requestTimeoutMs: 5000,
  userAgent: "test",
};

const ASSET = {
  mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  label: "TSLAx",
  registered: {
    id: "asset_tslax",
    symbol: "TSLAx",
    name: "Tesla xStock",
    assetType: "tokenized_equity",
    chain: "solana",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
    referenceTicker: "TSLA",
    issuerName: "Backed Assets",
  },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stub every source the collector touches. `dexStatus` drives the aggregator. */
function stubSources({ dexStatus = 200, tokenStats = true } = {}) {
  globalThis.fetch = async (url, init) => {
    const target = String(url);

    if (init?.method === "POST") {
      const method = JSON.parse(String(init.body)).method;
      if (method === "getTokenSupply") {
        return json({
          result: {
            context: { slot: 100 },
            value: { amount: "1000", decimals: 8, uiAmountString: "1000" },
          },
        });
      }
      if (method === "getTokenLargestAccounts") {
        return json({
          result: { value: [{ address: "Acct1", uiAmountString: "400" }] },
        });
      }
      return json({ result: null });
    }

    if (target.includes("dexscreener")) {
      if (dexStatus !== 200) return new Response("rate limited", { status: dexStatus });
      return json({
        pairs: [
          {
            chainId: "solana",
            dexId: "orca",
            pairAddress: "Pool1",
            priceUsd: "100",
            baseToken: { symbol: "TSLAx", address: ASSET.mint },
            quoteToken: { symbol: "USDC", address: "USDC" },
            liquidity: { usd: 500_000 },
            volume: { h24: 250_000 },
            txns: { h24: { buys: 10, sells: 10 }, h1: { buys: 2, sells: 3 } },
            priceChange: { h24: 1.5 },
          },
        ],
      });
    }

    if (target.includes("/tokens/v2/search")) {
      if (!tokenStats) return new Response("nope", { status: 500 });
      return json([
        {
          id: ASSET.mint,
          liquidity: 111_000,
          holderCount: 4321,
          stats24h: { buyVolume: 60_000, sellVolume: 40_000, priceChange: -2 },
        },
      ]);
    }

    if (target.includes("/price/v3")) {
      return json({
        [ASSET.mint]: {
          usdPrice: 100,
          priceChange24h: 1,
          stockData: { price: 101, updatedAt: "2026-08-13T00:00:00.000Z" },
        },
      });
    }

    throw new Error(`unexpected fetch: ${target}`);
  };
}

test("a healthy aggregator stays authoritative for pool numbers", async () => {
  stubSources();
  const snapshot = await collectSnapshot(ASSET, CONFIG);

  assert.equal(snapshot.liquidityUsd, 500_000);
  assert.equal(snapshot.volume24hUsd, 250_000);
  assert.equal(snapshot.txnsH1, 5);
  assert.equal(snapshot.dexPriceUsd, 100);
  // The standby is still read, because only it counts holder wallets.
  assert.equal(snapshot.holderCount, 4321);
  assert.deepEqual(snapshot.failedSources, []);
});

test("a rate-limited aggregator is filled in, without inventing what it alone measures", async () => {
  stubSources({ dexStatus: 429 });
  const snapshot = await collectSnapshot(ASSET, CONFIG);

  assert.equal(snapshot.liquidityUsd, 111_000);
  assert.equal(snapshot.volume24hUsd, 100_000);
  assert.equal(snapshot.holderCount, 4321);
  // Transaction counts, pool count, and the second venue price are the
  // aggregator's alone. They stay null.
  assert.equal(snapshot.txnsH1, null);
  assert.equal(snapshot.txns24h, null);
  assert.equal(snapshot.pairCount, null);
  assert.equal(snapshot.dexPriceUsd, null);
  // The failure is recorded, not hidden by the fallback.
  assert.equal(snapshot.failedSources.length, 1);
  assert.match(snapshot.failedSources[0], /dexscreener/);
  assert.ok(
    snapshot.evidence.some((e) => e.title.includes("standing in for")),
    "the fallback fetch should be cited as its own evidence",
  );
});

test("losing both market sources leaves the snapshot degraded but usable", async () => {
  stubSources({ dexStatus: 429, tokenStats: false });
  const snapshot = await collectSnapshot(ASSET, CONFIG);

  assert.equal(snapshot.liquidityUsd, null);
  assert.equal(snapshot.holderCount, null);
  assert.equal(snapshot.supplyUiAmount, 1000);
  assert.equal(snapshot.premiumBps !== null, true);
  assert.equal(snapshot.failedSources.length, 2);
});

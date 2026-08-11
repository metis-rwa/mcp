import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSnapshot, scoreConfidence } from "../dist/research/analyze.js";

function snapshot(overrides = {}) {
  return {
    assetLabel: "Test xStock",
    symbol: "TESTx",
    mint: "So11111111111111111111111111111111111111112",
    referenceTicker: "TEST",
    capturedAt: "2026-08-12T10:00:00.000Z",
    supplyUiAmount: 1000,
    supplySlot: 1,
    tokenPriceUsd: 100,
    referencePriceUsd: 100,
    premiumBps: 0,
    priceChange24hPct: 0,
    dexPriceUsd: 100,
    liquidityUsd: 500_000,
    volume24hUsd: 250_000,
    txns24h: 400,
    txnsH1: 20,
    pairCount: 3,
    topPoolDex: "orca",
    top5HolderShare: 0.4,
    evidence: [
      {
        id: "ev_1",
        sourceId: "solana_rpc",
        sourceType: "onchain",
        title: "supply",
        url: "https://solscan.io/token/x",
        publisher: "Solana mainnet (direct RPC)",
        retrievedAt: "2026-08-12T10:00:00.000Z",
        dataHash: "sha256:abc",
        reliability: "primary",
      },
      {
        id: "ev_2",
        sourceId: "jupiter",
        sourceType: "market",
        title: "price",
        url: "https://lite-api.jup.ag",
        publisher: "Jupiter price service",
        retrievedAt: "2026-08-12T10:00:00.000Z",
        dataHash: "sha256:def",
        reliability: "high",
      },
    ],
    failedSources: [],
    ...overrides,
  };
}

function baselinePoint(overrides = {}) {
  return {
    capturedAt: "2026-08-12T09:00:00.000Z",
    supplyUiAmount: 1000,
    premiumBps: 2,
    liquidityUsd: 500_000,
    volume24hUsd: 250_000,
    txnsH1: 20,
    top5HolderShare: 0.4,
    ...overrides,
  };
}

test("a quiet snapshot with history produces observations and no detections", () => {
  const result = analyzeSnapshot(snapshot(), [baselinePoint()]);
  assert.equal(result.detections.length, 0);
  assert.equal(result.conflicts.length, 0);
  assert.ok(result.observations.length >= 4);
});

test("premium past the threshold fires, and triples into material", () => {
  const notable = analyzeSnapshot(snapshot({ premiumBps: 30 }), []);
  assert.equal(notable.detections.length, 1);
  assert.equal(notable.detections[0].kind, "premium_divergence");
  assert.equal(notable.detections[0].severity, "notable");

  const material = analyzeSnapshot(snapshot({ premiumBps: -400 }), []);
  assert.equal(material.detections[0].severity, "material");
});

test("supply, liquidity, activity, and concentration need a baseline", () => {
  const moved = snapshot({
    supplyUiAmount: 1100,
    liquidityUsd: 700_000,
    txnsH1: 200,
    top5HolderShare: 0.5,
  });
  assert.equal(analyzeSnapshot(moved, []).detections.length, 0);

  const kinds = analyzeSnapshot(moved, [baselinePoint()]).detections.map((d) => d.kind);
  assert.deepEqual(kinds.sort(), [
    "activity_spike",
    "concentration_change",
    "liquidity_shift",
    "supply_change",
  ]);
});

test("venue price disagreement is recorded as a conflict, not a detection", () => {
  const result = analyzeSnapshot(snapshot({ dexPriceUsd: 101 }), []);
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0], /100bps/);
  assert.equal(result.detections.length, 0);
});

test("confidence rewards coverage and agreement, and penalizes failures", () => {
  const clean = scoreConfidence(snapshot(), analyzeSnapshot(snapshot(), []), 10);
  const degraded = scoreConfidence(
    snapshot({ failedSources: ["dexscreener: HTTP 500", "jupiter: timeout"] }),
    { observations: [], detections: [], conflicts: ["sources disagree"] },
    0,
  );
  assert.ok(clean.score > degraded.score);
  assert.equal(clean.band, "high");
  assert.equal(degraded.band, "low");
});

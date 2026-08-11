import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { HistoryStore } from "../dist/history.js";

const dir = mkdtempSync(join(tmpdir(), "metis-mcp-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function point(index) {
  return {
    capturedAt: new Date(Date.UTC(2026, 7, 12, index)).toISOString(),
    supplyUiAmount: 1000 + index,
    premiumBps: index,
    liquidityUsd: 500_000,
    volume24hUsd: 250_000,
    txnsH1: 20,
    top5HolderShare: 0.4,
  };
}

test("points round-trip through the file store in order", () => {
  const store = new HistoryStore(dir);
  store.append("MintA", point(0));
  store.append("MintA", point(1));

  const points = store.read("MintA");
  assert.equal(points.length, 2);
  assert.equal(points[1].premiumBps, 1);
  assert.equal(store.read("MintB").length, 0);
});

test("reads are capped by the requested limit, newest last", () => {
  const store = new HistoryStore(dir);
  for (let i = 0; i < 5; i += 1) store.append("MintC", point(i));

  const points = store.read("MintC", 2);
  assert.equal(points.length, 2);
  assert.equal(points[0].premiumBps, 3);
  assert.equal(points[1].premiumBps, 4);
});

test("history stays in memory when no state directory is configured", () => {
  const store = new HistoryStore(null);
  store.append("MintD", point(0));
  assert.equal(store.read("MintD").length, 1);
  assert.match(store.location(), /memory only/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { assetRegistry, looksLikeMint, resolveAsset } from "../dist/registry.js";

test("registry entries carry a mint and a reference ticker", () => {
  const assets = assetRegistry();
  assert.ok(assets.length >= 3);
  for (const asset of assets) {
    assert.ok(looksLikeMint(asset.mint), `${asset.symbol} has an invalid mint`);
    assert.equal(asset.chain, "solana");
  }
});

test("ids, symbols, and mints are unique", () => {
  const assets = assetRegistry();
  for (const field of ["id", "symbol", "mint"]) {
    const values = assets.map((a) => a[field]);
    assert.equal(
      new Set(values).size,
      values.length,
      `duplicate ${field} in the registry`,
    );
  }
});

test("every entry tracks a ticker derived from its symbol", () => {
  for (const asset of assetRegistry()) {
    assert.ok(asset.symbol.endsWith("x"), `${asset.symbol} is not an xStock symbol`);
    assert.equal(asset.referenceTicker, asset.symbol.slice(0, -1));
    assert.equal(asset.decimals, 8);
    assert.ok(asset.name.includes("xStock"));
  }
});

test("symbols resolve regardless of case", () => {
  const upper = resolveAsset("TSLAX");
  const exact = resolveAsset("TSLAx");
  assert.equal(upper.mint, exact.mint);
  assert.equal(upper.registered.referenceTicker, "TSLA");
});

test("an unregistered mint still resolves, without issuer context", () => {
  const resolved = resolveAsset("So11111111111111111111111111111111111111112");
  assert.equal(resolved.registered, null);
  assert.equal(resolved.mint, "So11111111111111111111111111111111111111112");
});

test("anything that is neither a symbol nor a mint is rejected", () => {
  assert.throws(() => resolveAsset("not an asset"), /neither a known symbol/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeControls } from "../dist/token-controls.js";

function controls(overrides = {}) {
  return {
    record: {
      sourceId: "solana_rpc",
      url: "https://solscan.io/token/x",
      retrievedAt: "2026-08-12T10:00:00.000Z",
      payloadHash: "sha256:abc",
      latencyMs: 10,
    },
    program: "spl-token-2022",
    decimals: 8,
    supplyRaw: "100000",
    mintAuthority: null,
    freezeAuthority: null,
    extensions: [],
    ...overrides,
  };
}

test("revoked authorities read as informational", () => {
  const summary = summarizeControls(controls());
  const severities = summary.findings.map((f) => f.severity);
  assert.deepEqual(severities, ["info", "info"]);
  assert.match(summary.verdict, /No issuer power/);
});

test("live mint and freeze authorities are called out", () => {
  const summary = summarizeControls(
    controls({ mintAuthority: "Auth1", freezeAuthority: "Auth2" }),
  );
  const high = summary.findings.filter((f) => f.severity === "high");
  assert.equal(high.length, 2);
  assert.equal(high[0].authority, "Auth1");
  assert.match(summary.verdict, /mint authority, freeze authority/);
});

test("a permanent delegate and a transfer hook are holder-facing controls", () => {
  const summary = summarizeControls(
    controls({
      extensions: [
        { extension: "permanentDelegate", state: { delegate: "Deleg1" } },
        { extension: "transferHook", state: { programId: "Hook1", authority: null } },
      ],
    }),
  );
  const keys = summary.findings.filter((f) => f.severity === "high").map((f) => f.key);
  assert.deepEqual(keys, ["permanentDelegate", "transferHook"]);
  assert.match(
    summary.findings.find((f) => f.key === "transferHook").detail,
    /Hook1/,
  );
});

test("default account state matters only when new accounts start frozen", () => {
  const permissioned = summarizeControls(
    controls({
      extensions: [{ extension: "defaultAccountState", state: { accountState: "frozen" } }],
    }),
  );
  assert.equal(
    permissioned.findings.find((f) => f.key === "defaultAccountState").severity,
    "high",
  );

  const open = summarizeControls(
    controls({
      extensions: [
        { extension: "defaultAccountState", state: { accountState: "initialized" } },
      ],
    }),
  );
  assert.equal(
    open.findings.find((f) => f.key === "defaultAccountState").severity,
    "info",
  );
});

test("extensions this build does not describe are surfaced, not swallowed", () => {
  const summary = summarizeControls(
    controls({ extensions: [{ extension: "somethingNew", state: {} }] }),
  );
  assert.deepEqual(summary.unrecognizedExtensions, ["somethingNew"]);
});

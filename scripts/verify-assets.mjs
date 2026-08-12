#!/usr/bin/env node
// Read every registered mint back from Solana and report anything that drifted
// from what src/assets.ts claims. Run it before releasing, or whenever the
// issuer is rumoured to have changed something.
//
//   npm run verify-assets
//
// SOLANA_RPC_URL is honoured. Public endpoints refuse large getMultipleAccounts
// batches, so the batch size is small and paced by default.

import { XSTOCKS } from "../dist/assets.js";

const RPC = process.env.SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com";
const BATCH = Number(process.env.VERIFY_BATCH ?? 10);
const PAUSE_MS = Number(process.env.VERIFY_PAUSE_MS ?? 1200);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${method}`);
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const problems = [];
let checked = 0;

for (let i = 0; i < XSTOCKS.length; i += BATCH) {
  const batch = XSTOCKS.slice(i, i + BATCH);
  const result = await rpc("getMultipleAccounts", [
    batch.map((a) => a.mint),
    { encoding: "jsonParsed" },
  ]);

  result.value.forEach((account, index) => {
    const asset = batch[index];
    checked += 1;
    const parsed = account?.data?.parsed;
    if (!parsed || parsed.type !== "mint") {
      problems.push(`${asset.symbol}: mint account does not parse as a mint`);
      return;
    }
    const info = parsed.info;
    if (info.decimals !== asset.decimals) {
      problems.push(
        `${asset.symbol}: decimals are ${info.decimals} on chain, ${asset.decimals} in the registry`,
      );
    }
    const metadata = (info.extensions ?? []).find(
      (e) => e.extension === "tokenMetadata",
    );
    const onChainSymbol = metadata?.state?.symbol ?? null;
    const onChainName = metadata?.state?.name ?? null;
    if (onChainSymbol !== asset.symbol) {
      problems.push(
        `${asset.symbol}: on-chain symbol is ${onChainSymbol ?? "absent"}`,
      );
    }
    if (onChainName !== asset.name) {
      problems.push(
        `${asset.symbol}: on-chain name is ${onChainName ?? "absent"}, registry says ${asset.name}`,
      );
    }
  });

  process.stderr.write(`checked ${checked}/${XSTOCKS.length}\n`);
  if (i + BATCH < XSTOCKS.length) await sleep(PAUSE_MS);
}

if (problems.length === 0) {
  process.stdout.write(`All ${checked} registered mints match the chain.\n`);
  process.exit(0);
}

process.stdout.write(`${problems.length} problem(s) found:\n`);
for (const problem of problems) process.stdout.write(`  ${problem}\n`);
process.exit(1);

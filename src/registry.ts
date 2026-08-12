import { readFileSync } from "node:fs";
import { XSTOCKS } from "./assets.js";

export interface RegisteredAsset {
  id: string;
  symbol: string;
  name: string;
  assetType:
    | "tokenized_equity"
    | "stablecoin"
    | "fund"
    | "commodity"
    | "bond"
    | "other";
  chain: "solana";
  mint: string;
  decimals: number;
  /** Ticker of the security or instrument the token tracks, when there is one. */
  referenceTicker?: string;
  issuerName: string;
}

/** The built-in universe. An unverified mint address is worse than no address,
 *  so nothing lands here without being read back from the chain first. Anything
 *  outside this list still works: tools accept a raw mint, and
 *  METIS_ASSETS_FILE registers extra assets by symbol. */
const BUILT_IN: RegisteredAsset[] = XSTOCKS;

function loadExtraAssets(path: string): RegisteredAsset[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`${path} must contain a JSON array of assets`);
  }
  return raw.map((entry, index) => {
    const asset = entry as Partial<RegisteredAsset>;
    if (!asset.symbol || !asset.mint) {
      throw new Error(`${path}[${index}] needs at least "symbol" and "mint"`);
    }
    return {
      id: asset.id ?? `asset_${asset.symbol.toLowerCase()}`,
      symbol: asset.symbol,
      name: asset.name ?? asset.symbol,
      assetType: asset.assetType ?? "other",
      chain: "solana",
      mint: asset.mint,
      decimals: asset.decimals ?? 0,
      referenceTicker: asset.referenceTicker,
      issuerName: asset.issuerName ?? "unknown",
    } satisfies RegisteredAsset;
  });
}

let cached: RegisteredAsset[] | null = null;

export function assetRegistry(env: NodeJS.ProcessEnv = process.env): RegisteredAsset[] {
  if (cached) return cached;
  const extraPath = env.METIS_ASSETS_FILE?.trim();
  const extra = extraPath ? loadExtraAssets(extraPath) : [];
  const merged = [...BUILT_IN];
  for (const asset of extra) {
    const existing = merged.findIndex(
      (a) => a.mint === asset.mint || a.symbol.toLowerCase() === asset.symbol.toLowerCase(),
    );
    if (existing >= 0) merged[existing] = asset;
    else merged.push(asset);
  }
  cached = merged;
  return merged;
}

/** Solana addresses are base58 and 32 to 44 characters long. */
const MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function looksLikeMint(value: string): boolean {
  return MINT_PATTERN.test(value);
}

export function findAsset(
  symbolOrMint: string,
  env: NodeJS.ProcessEnv = process.env,
): RegisteredAsset | undefined {
  const needle = symbolOrMint.trim().toLowerCase();
  return assetRegistry(env).find(
    (a) =>
      a.symbol.toLowerCase() === needle ||
      a.id.toLowerCase() === needle ||
      a.mint.toLowerCase() === needle,
  );
}

export interface ResolvedAsset {
  mint: string;
  label: string;
  registered: RegisteredAsset | null;
}

/** Accept a registry symbol or any raw mint address. Unregistered mints still
 *  work; they simply carry no reference ticker or issuer context. */
export function resolveAsset(
  symbolOrMint: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAsset {
  const asset = findAsset(symbolOrMint, env);
  if (asset) {
    return { mint: asset.mint, label: asset.symbol, registered: asset };
  }
  const candidate = symbolOrMint.trim();
  if (looksLikeMint(candidate)) {
    return { mint: candidate, label: candidate, registered: null };
  }
  const known = assetRegistry(env)
    .map((a) => a.symbol)
    .join(", ");
  throw new Error(
    `"${symbolOrMint}" is neither a known symbol (${known}) nor a Solana mint address.`,
  );
}

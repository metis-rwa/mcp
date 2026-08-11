import type { Config } from "../config.js";
import type { ResolvedAsset } from "../registry.js";
import { DexScreenerSource } from "../sources/dexscreener.js";
import type { SourceFetchRecord } from "../sources/http.js";
import { JupiterSource } from "../sources/jupiter.js";
import { SolanaSource } from "../sources/solana.js";
import type { EvidenceRow, SignalSnapshot, SourceClass } from "./types.js";

const PUBLISHERS: Record<string, string> = {
  solana_rpc: "Solana mainnet (direct RPC)",
  dexscreener: "DexScreener aggregated venue data",
  jupiter: "Jupiter price service",
};

function evidenceFrom(
  record: SourceFetchRecord,
  title: string,
  sourceType: SourceClass,
  reliability: EvidenceRow["reliability"],
): EvidenceRow {
  return {
    id: `ev_${record.sourceId}_${record.retrievedAt.replaceAll(/[:.]/g, "")}`,
    sourceId: record.sourceId,
    sourceType,
    title,
    url: record.url,
    publisher: PUBLISHERS[record.sourceId] ?? record.sourceId,
    retrievedAt: record.retrievedAt,
    dataHash: record.payloadHash,
    reliability,
  };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read every source for one asset and assemble the cycle snapshot. A single
 *  source failing degrades the snapshot instead of failing it, and the failure
 *  is recorded so downstream confidence can see it. */
export async function collectSnapshot(
  asset: ResolvedAsset,
  config: Config,
): Promise<SignalSnapshot> {
  const httpOptions = {
    timeoutMs: config.requestTimeoutMs,
    userAgent: config.userAgent,
  };
  const solana = new SolanaSource({ rpcUrl: config.solanaRpcUrl, ...httpOptions });
  const dex = new DexScreenerSource(httpOptions);
  const jupiter = new JupiterSource(httpOptions);

  const evidence: EvidenceRow[] = [];
  const failedSources: string[] = [];
  const label = asset.label;

  const supply = await solana.getSupply(asset.mint).catch((error) => {
    failedSources.push(`solana_rpc: ${reason(error)}`);
    return null;
  });
  if (supply) {
    evidence.push(
      evidenceFrom(
        supply.record,
        `${label} token supply at slot ${supply.slot}`,
        "onchain",
        "primary",
      ),
    );
  }

  const [holders, market, price] = await Promise.all([
    supply
      ? solana
          .getLargestAccounts(asset.mint, supply.uiAmount, false)
          .catch((error) => {
            failedSources.push(`solana_rpc: ${reason(error)}`);
            return null;
          })
      : Promise.resolve(null),
    dex.getMarketState(asset.mint).catch((error) => {
      failedSources.push(`dexscreener: ${reason(error)}`);
      return null;
    }),
    jupiter.getPriceState(asset.mint).catch((error) => {
      failedSources.push(`jupiter: ${reason(error)}`);
      return null;
    }),
  ]);

  if (holders) {
    evidence.push(
      evidenceFrom(
        holders.record,
        `${label} largest token accounts`,
        "onchain",
        "primary",
      ),
    );
  }
  if (market) {
    evidence.push(
      evidenceFrom(
        market.record,
        `${label} DEX pools, liquidity, and volume`,
        "market",
        "high",
      ),
    );
  }
  if (price) {
    evidence.push(
      evidenceFrom(
        price.record,
        asset.registered?.referenceTicker
          ? `${label} token price and ${asset.registered.referenceTicker} reference price`
          : `${label} token price`,
        "market",
        "high",
      ),
    );
  }

  return {
    assetLabel: asset.registered?.name ?? label,
    symbol: asset.registered?.symbol ?? label,
    mint: asset.mint,
    referenceTicker: asset.registered?.referenceTicker ?? null,
    capturedAt: new Date().toISOString(),
    supplyUiAmount: supply?.uiAmount ?? null,
    supplySlot: supply?.slot ?? null,
    tokenPriceUsd: price?.tokenPriceUsd ?? null,
    referencePriceUsd: price?.referencePriceUsd ?? null,
    premiumBps: price?.premiumBps ?? null,
    priceChange24hPct: price?.priceChange24hPct ?? null,
    dexPriceUsd: market?.priceUsd ?? null,
    liquidityUsd: market?.liquidityUsd ?? null,
    volume24hUsd: market?.volume24hUsd ?? null,
    txns24h: market?.txns24h ?? null,
    txnsH1: market?.txnsH1 ?? null,
    pairCount: market?.pairCount ?? null,
    topPoolDex: market?.topPoolDex ?? null,
    top5HolderShare: holders?.top5Share ?? null,
    evidence,
    failedSources,
  };
}

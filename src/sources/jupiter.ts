import {
  SourceError,
  fetchJsonWithRecord,
  type FetchOptions,
  type SourceFetchRecord,
} from "./http.js";

const BASE = "https://lite-api.jup.ag";

interface JupiterPriceEntry {
  usdPrice?: number;
  priceChange24h?: number;
  /** Present for tokenized equities: the price of the security the token
   *  tracks, republished by the price service. */
  stockData?: { price?: number; updatedAt?: string };
}

interface JupiterTokenEntry {
  id?: string;
  liquidity?: number;
  holderCount?: number;
  stats24h?: { buyVolume?: number; sellVolume?: number; priceChange?: number };
}

/** Pool-side numbers for one mint, as the price service's token endpoint
 *  reports them. Thinner than a venue aggregator, but it answers for many
 *  mints in one request and from hosts the aggregator turns away. */
export interface TokenStats {
  mint: string;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  priceChange24hPct: number | null;
}

export interface PriceSnapshot {
  record: SourceFetchRecord;
  tokenPriceUsd: number | null;
  referencePriceUsd: number | null;
  premiumBps: number | null;
  priceChange24hPct: number | null;
  referenceUpdatedAt: string | null;
}

export class JupiterSource {
  constructor(private readonly options: Omit<FetchOptions, "init">) {}

  /** Token price in USD and, for tokenized equities, the reference price of
   *  the underlying security. The gap between the two is the premium, which
   *  is the core divergence signal and needs no paid market-data key. */
  async getPriceState(mint: string): Promise<PriceSnapshot> {
    const { json, record } = await fetchJsonWithRecord(
      "jupiter",
      `${BASE}/price/v3?ids=${mint}`,
      this.options,
    );
    const entry = (json as Record<string, JupiterPriceEntry | undefined>)[mint];
    if (!entry) throw new SourceError("jupiter", `no price entry for ${mint}`);

    const tokenPriceUsd = entry.usdPrice ?? null;
    const referencePriceUsd = entry.stockData?.price ?? null;
    const premiumBps =
      tokenPriceUsd !== null && referencePriceUsd !== null && referencePriceUsd > 0
        ? ((tokenPriceUsd - referencePriceUsd) / referencePriceUsd) * 10_000
        : null;

    return {
      record,
      tokenPriceUsd,
      referencePriceUsd,
      premiumBps,
      // Already expressed in percent by the price service.
      priceChange24hPct: entry.priceChange24h ?? null,
      referenceUpdatedAt: entry.stockData?.updatedAt ?? null,
    };
  }

  /** Liquidity, 24h volume, and holder count for one or more mints in a single
   *  call. This is the standby for pool data: the venue aggregator is the
   *  better source and measures more, but it rate-limits datacenter traffic, so
   *  a server running anywhere other than a laptop needs somewhere else to go. */
  async getTokenStats(
    mints: string[],
  ): Promise<{ record: SourceFetchRecord; stats: Map<string, TokenStats> }> {
    const { json, record } = await fetchJsonWithRecord(
      "jupiter",
      `${BASE}/tokens/v2/search?query=${mints.join(",")}`,
      this.options,
    );
    const entries = Array.isArray(json) ? (json as JupiterTokenEntry[]) : [];
    const wanted = new Set(mints);
    const stats = new Map<string, TokenStats>();

    for (const entry of entries) {
      // A search can return near matches; keep only what was asked for.
      if (!entry.id || !wanted.has(entry.id) || stats.has(entry.id)) continue;
      const buy = entry.stats24h?.buyVolume;
      const sell = entry.stats24h?.sellVolume;
      stats.set(entry.id, {
        mint: entry.id,
        liquidityUsd: entry.liquidity ?? null,
        volume24hUsd:
          buy === undefined && sell === undefined ? null : (buy ?? 0) + (sell ?? 0),
        holderCount: entry.holderCount ?? null,
        priceChange24hPct: entry.stats24h?.priceChange ?? null,
      });
    }
    return { record, stats };
  }
}

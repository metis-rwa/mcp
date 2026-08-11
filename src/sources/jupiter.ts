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
}

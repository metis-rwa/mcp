import {
  SourceError,
  fetchJsonWithRecord,
  type FetchOptions,
  type SourceFetchRecord,
} from "./http.js";

const BASE = "https://api.dexscreener.com";

interface DexPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  priceUsd?: string;
  baseToken?: { symbol?: string; address?: string };
  quoteToken?: { symbol?: string; address?: string };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: {
    h24?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
  };
  priceChange?: { h24?: number };
}

export interface PoolRow {
  dex: string;
  pairAddress: string | null;
  pair: string;
  /** Price of the pool's base token, which is only this asset's price when
   *  assetIsBase is true. */
  priceUsd: number | null;
  assetIsBase: boolean;
  liquidityUsd: number;
  volume24hUsd: number;
  txns24h: number;
}

export interface MarketSnapshot {
  record: SourceFetchRecord;
  priceUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  txns24h: number;
  txnsH1: number;
  pairCount: number;
  topPoolDex: string | null;
  topPoolAddress: string | null;
  priceChange24hPct: number | null;
  pools: PoolRow[];
}

export class DexScreenerSource {
  constructor(private readonly options: Omit<FetchOptions, "init">) {}

  /** Aggregated Solana market state for a mint across every listed pool. */
  async getMarketState(mint: string): Promise<MarketSnapshot> {
    const { json, record } = await fetchJsonWithRecord(
      "dexscreener",
      `${BASE}/latest/dex/tokens/${mint}`,
      this.options,
    );
    const pairs = (json as { pairs?: DexPair[] | null }).pairs ?? [];
    const solanaPairs = pairs.filter((p) => p.chainId === "solana");
    if (solanaPairs.length === 0) {
      throw new SourceError("dexscreener", `no Solana pairs listed for ${mint}`);
    }
    const byLiquidity = [...solanaPairs].sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    );
    // priceUsd on a pair is the price of its base token, so a pool where this
    // mint sits on the quote side would report the other token's price. Price
    // and price change come from the deepest pool where the mint is the base.
    const top =
      byLiquidity.find((p) => p.baseToken?.address === mint) ?? byLiquidity[0]!;
    const priced = top.baseToken?.address === mint;
    const sum = (fn: (p: DexPair) => number) =>
      solanaPairs.reduce((acc, p) => acc + fn(p), 0);

    return {
      record,
      priceUsd: priced && top.priceUsd ? Number(top.priceUsd) : null,
      liquidityUsd: sum((p) => p.liquidity?.usd ?? 0),
      volume24hUsd: sum((p) => p.volume?.h24 ?? 0),
      txns24h: sum((p) => (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0)),
      txnsH1: sum((p) => (p.txns?.h1?.buys ?? 0) + (p.txns?.h1?.sells ?? 0)),
      pairCount: solanaPairs.length,
      topPoolDex: top.dexId ?? null,
      topPoolAddress: top.pairAddress ?? null,
      priceChange24hPct: priced ? (top.priceChange?.h24 ?? null) : null,
      pools: byLiquidity.map((p) => ({
        dex: p.dexId ?? "unknown",
        pairAddress: p.pairAddress ?? null,
        pair: `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}`,
        priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
        assetIsBase: p.baseToken?.address === mint,
        liquidityUsd: p.liquidity?.usd ?? 0,
        volume24hUsd: p.volume?.h24 ?? 0,
        txns24h: (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0),
      })),
    };
  }
}

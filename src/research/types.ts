export type SourceClass = "onchain" | "market";

export interface EvidenceRow {
  id: string;
  sourceId: string;
  sourceType: SourceClass;
  title: string;
  url: string;
  publisher: string;
  retrievedAt: string;
  dataHash: string;
  reliability: "primary" | "high" | "medium" | "low";
}

/** One observation cycle for an asset, assembled from every source. */
export interface SignalSnapshot {
  assetLabel: string;
  symbol: string;
  mint: string;
  referenceTicker: string | null;
  capturedAt: string;
  supplyUiAmount: number | null;
  supplySlot: number | null;
  tokenPriceUsd: number | null;
  referencePriceUsd: number | null;
  premiumBps: number | null;
  priceChange24hPct: number | null;
  dexPriceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  txns24h: number | null;
  txnsH1: number | null;
  pairCount: number | null;
  topPoolDex: string | null;
  top5HolderShare: number | null;
  evidence: EvidenceRow[];
  /** Sources that failed this cycle, recorded rather than imputed. */
  failedSources: string[];
}

/** The subset of a snapshot kept as history and used as baseline. */
export interface BaselinePoint {
  capturedAt: string;
  supplyUiAmount: number | null;
  premiumBps: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  txnsH1: number | null;
  top5HolderShare: number | null;
}

export function toBaselinePoint(snapshot: SignalSnapshot): BaselinePoint {
  return {
    capturedAt: snapshot.capturedAt,
    supplyUiAmount: snapshot.supplyUiAmount,
    premiumBps: snapshot.premiumBps,
    liquidityUsd: snapshot.liquidityUsd,
    volume24hUsd: snapshot.volume24hUsd,
    txnsH1: snapshot.txnsH1,
    top5HolderShare: snapshot.top5HolderShare,
  };
}

export type DetectionKind =
  | "premium_divergence"
  | "supply_change"
  | "liquidity_shift"
  | "activity_spike"
  | "concentration_change";

export interface Detection {
  kind: DetectionKind;
  category: "flow" | "market";
  severity: "informational" | "notable" | "material";
  message: string;
  metricName: string;
  metricValue: number;
  baselineValue?: number;
}

export interface ObservationRow {
  kind: string;
  statement: string;
  metric?: {
    name: string;
    value: number;
    unit: string;
    baseline?: number;
    delta?: number;
  };
}

export interface AnalysisResult {
  observations: ObservationRow[];
  detections: Detection[];
  /** Cross-source disagreements that were found and left unresolved. */
  conflicts: string[];
}

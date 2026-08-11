import type {
  AnalysisResult,
  BaselinePoint,
  Detection,
  ObservationRow,
  SignalSnapshot,
} from "./types.js";

export interface DetectionThresholds {
  /** Absolute token-versus-reference divergence that counts as a signal. */
  premiumBpsAbs: number;
  supplyChangeRatio: number;
  liquidityChangeRatio: number;
  txnH1SpikeFactor: number;
  concentrationDelta: number;
  /** Price disagreement between venues that is recorded as a conflict. */
  venueDisagreementBps: number;
}

export const defaultThresholds: DetectionThresholds = {
  premiumBpsAbs: 25,
  supplyChangeRatio: 0.005,
  liquidityChangeRatio: 0.1,
  txnH1SpikeFactor: 3,
  concentrationDelta: 0.03,
  venueDisagreementBps: 40,
};

function average(values: Array<number | null>): number | null {
  const usable = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Turn one snapshot plus its history into observations, threshold
 *  detections, and recorded conflicts. Pure and deterministic: the same
 *  inputs always produce the same output, which is what makes it testable
 *  and auditable. */
export function analyzeSnapshot(
  snapshot: SignalSnapshot,
  baseline: BaselinePoint[],
  thresholds: DetectionThresholds = defaultThresholds,
): AnalysisResult {
  const observations: ObservationRow[] = [];
  const detections: Detection[] = [];
  const conflicts: string[] = [];
  const prior = baseline.length > 0 ? baseline[baseline.length - 1] : undefined;

  if (snapshot.premiumBps !== null) {
    const premium = round(snapshot.premiumBps);
    const baselinePremium = average(baseline.map((b) => b.premiumBps));
    const reference = snapshot.referenceTicker ?? "reference";
    observations.push({
      kind: "price_divergence",
      statement: `${snapshot.symbol} trades ${premium >= 0 ? "+" : ""}${premium}bps versus the ${reference} reference price.`,
      metric: {
        name: "premium_bps",
        value: premium,
        unit: "bps",
        baseline: baselinePremium ?? undefined,
      },
    });
    if (Math.abs(snapshot.premiumBps) >= thresholds.premiumBpsAbs) {
      detections.push({
        kind: "premium_divergence",
        category: "market",
        severity:
          Math.abs(snapshot.premiumBps) >= thresholds.premiumBpsAbs * 3
            ? "material"
            : "notable",
        message: `Token price diverges ${premium}bps from the reference price.`,
        metricName: "premium_bps",
        metricValue: premium,
        baselineValue: baselinePremium ?? undefined,
      });
    }
  }

  if (snapshot.supplyUiAmount !== null && prior?.supplyUiAmount) {
    const ratio =
      (snapshot.supplyUiAmount - prior.supplyUiAmount) / prior.supplyUiAmount;
    const pct = round(ratio * 100, 2);
    observations.push({
      kind: "supply_change",
      statement: `Circulating supply is ${snapshot.supplyUiAmount.toLocaleString("en-US")} tokens (${pct >= 0 ? "+" : ""}${pct}% versus the prior observation).`,
      metric: {
        name: "supply_ui_amount",
        value: snapshot.supplyUiAmount,
        unit: "tokens",
        baseline: prior.supplyUiAmount,
        delta: ratio,
      },
    });
    if (Math.abs(ratio) >= thresholds.supplyChangeRatio) {
      detections.push({
        kind: "supply_change",
        category: "flow",
        severity:
          Math.abs(ratio) >= thresholds.supplyChangeRatio * 10
            ? "material"
            : "notable",
        message: `Supply moved ${pct}% since the prior observation, past the ${round(thresholds.supplyChangeRatio * 100, 2)}% threshold. Mints and redemptions are how a backed token tracks demand.`,
        metricName: "supply_change_ratio",
        metricValue: ratio,
        baselineValue: 0,
      });
    }
  } else if (snapshot.supplyUiAmount !== null) {
    observations.push({
      kind: "supply_level",
      statement: `Circulating supply stands at ${snapshot.supplyUiAmount.toLocaleString("en-US")} tokens.`,
      metric: {
        name: "supply_ui_amount",
        value: snapshot.supplyUiAmount,
        unit: "tokens",
      },
    });
  }

  if (snapshot.liquidityUsd !== null) {
    const baselineLiquidity = average(baseline.map((b) => b.liquidityUsd));
    observations.push({
      kind: "liquidity_level",
      statement: `Tracked DEX liquidity totals $${Math.round(snapshot.liquidityUsd).toLocaleString("en-US")} across ${snapshot.pairCount ?? "an unknown number of"} pools.`,
      metric: {
        name: "liquidity_usd",
        value: Math.round(snapshot.liquidityUsd),
        unit: "USD",
        baseline: baselineLiquidity ? Math.round(baselineLiquidity) : undefined,
      },
    });
    if (
      baselineLiquidity &&
      Math.abs(snapshot.liquidityUsd - baselineLiquidity) / baselineLiquidity >=
        thresholds.liquidityChangeRatio
    ) {
      const pct = round(
        ((snapshot.liquidityUsd - baselineLiquidity) / baselineLiquidity) * 100,
      );
      detections.push({
        kind: "liquidity_shift",
        category: "market",
        severity: "notable",
        message: `Pooled liquidity moved ${pct}% versus its recent average.`,
        metricName: "liquidity_usd",
        metricValue: snapshot.liquidityUsd,
        baselineValue: baselineLiquidity,
      });
    }
  }

  if (snapshot.txnsH1 !== null) {
    const baselineTxns = average(baseline.map((b) => b.txnsH1));
    if (
      baselineTxns !== null &&
      baselineTxns > 0 &&
      snapshot.txnsH1 >= baselineTxns * thresholds.txnH1SpikeFactor &&
      snapshot.txnsH1 >= 20
    ) {
      detections.push({
        kind: "activity_spike",
        category: "market",
        severity: "notable",
        message: `Hourly transaction count (${snapshot.txnsH1}) is ${round(snapshot.txnsH1 / baselineTxns)}x the recent average.`,
        metricName: "txns_h1",
        metricValue: snapshot.txnsH1,
        baselineValue: baselineTxns,
      });
    }
  }

  if (snapshot.top5HolderShare !== null) {
    const share = round(snapshot.top5HolderShare * 100);
    observations.push({
      kind: "holder_concentration",
      statement: `The five largest token accounts hold ${share}% of supply, pools and custodial accounts included.`,
      metric: {
        name: "top5_account_share",
        value: snapshot.top5HolderShare,
        unit: "ratio",
        baseline: prior?.top5HolderShare ?? undefined,
      },
    });
    if (
      prior?.top5HolderShare &&
      Math.abs(snapshot.top5HolderShare - prior.top5HolderShare) >=
        thresholds.concentrationDelta
    ) {
      detections.push({
        kind: "concentration_change",
        category: "flow",
        severity: "notable",
        message: `Top-5 account share moved ${round((snapshot.top5HolderShare - prior.top5HolderShare) * 100)} points since the prior observation.`,
        metricName: "top5_account_share",
        metricValue: snapshot.top5HolderShare,
        baselineValue: prior.top5HolderShare,
      });
    }
  }

  if (
    snapshot.tokenPriceUsd !== null &&
    snapshot.dexPriceUsd !== null &&
    snapshot.tokenPriceUsd > 0
  ) {
    const disagreementBps =
      (Math.abs(snapshot.dexPriceUsd - snapshot.tokenPriceUsd) /
        snapshot.tokenPriceUsd) *
      10_000;
    if (disagreementBps >= thresholds.venueDisagreementBps) {
      conflicts.push(
        `Price sources disagree by ${Math.round(disagreementBps)}bps (price service $${snapshot.tokenPriceUsd} versus top pool $${snapshot.dexPriceUsd}).`,
      );
    }
  }

  if (snapshot.volume24hUsd !== null && snapshot.liquidityUsd) {
    const turnover = round(snapshot.volume24hUsd / snapshot.liquidityUsd, 2);
    observations.push({
      kind: "volume_context",
      statement: `24h DEX volume of $${Math.round(snapshot.volume24hUsd).toLocaleString("en-US")} implies ${turnover}x turnover of pooled liquidity.`,
      metric: {
        name: "volume_24h_usd",
        value: Math.round(snapshot.volume24hUsd),
        unit: "USD",
      },
    });
  }

  return { observations, detections, conflicts };
}

/** Deterministic confidence rubric. A model's own stated confidence never
 *  feeds this: only source coverage, cross-source agreement, and how much
 *  history the baseline holds. */
export function scoreConfidence(
  snapshot: SignalSnapshot,
  analysis: AnalysisResult,
  baselineCount: number,
): { score: number; band: "low" | "moderate" | "high"; factors: string[] } {
  const factors: string[] = [];
  let score = 0.5;

  const sourceCount = new Set(snapshot.evidence.map((e) => e.sourceId)).size;
  const coverage = Math.min(sourceCount * 0.08, 0.24);
  score += coverage;
  factors.push(`${sourceCount} independent source(s) answered (+${round(coverage, 2)})`);

  if (snapshot.failedSources.length > 0) {
    const penalty = 0.08 * snapshot.failedSources.length;
    score -= penalty;
    factors.push(
      `${snapshot.failedSources.length} source failure(s) (-${round(penalty, 2)})`,
    );
  }

  if (analysis.conflicts.length > 0) {
    const penalty = 0.1 * analysis.conflicts.length;
    score -= penalty;
    factors.push(
      `${analysis.conflicts.length} unresolved cross-source conflict(s) (-${round(penalty, 2)})`,
    );
  } else if (snapshot.tokenPriceUsd !== null && snapshot.dexPriceUsd !== null) {
    score += 0.08;
    factors.push("independent price sources agree within tolerance (+0.08)");
  }

  const history = Math.min(baselineCount * 0.01, 0.08);
  score += history;
  factors.push(`${baselineCount} prior observation(s) as baseline (+${round(history, 2)})`);

  score = Math.max(0.05, Math.min(0.95, round(score, 2)));
  return {
    score,
    band: score >= 0.75 ? "high" : score >= 0.55 ? "moderate" : "low",
    factors,
  };
}

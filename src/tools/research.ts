import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bps, num, pct, section, table, timeAgo, usd } from "../format.js";
import { resolveAsset } from "../registry.js";
import {
  analyzeSnapshot,
  defaultThresholds,
  scoreConfidence,
} from "../research/analyze.js";
import { collectSnapshot } from "../research/collect.js";
import { toBaselinePoint } from "../research/types.js";
import {
  ASSET_ARG_DESCRIPTION,
  READ_ONLY,
  guard,
  ok,
  type ToolContext,
} from "./shared.js";

const CATEGORIES = ["flow", "market", "event", "synthesis"] as const;

export function registerResearchTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "observe_asset",
    {
      title: "Run an observation cycle",
      description:
        "Run one full research cycle on a tokenized asset: read supply and holder concentration from Solana, read pooled liquidity and volume from DEX venues, read the token and reference prices, then compare all of it against the observations already stored for this asset. Returns the observations, any threshold detections, cross-source conflicts, a deterministic confidence score, and a hash of every payload used. The cycle is appended to local history, so calling it repeatedly deepens the baseline that supply, liquidity, activity, and concentration detections need.",
      inputSchema: {
        asset: z.string().describe(ASSET_ARG_DESCRIPTION),
        baselineLimit: z
          .number()
          .int()
          .min(0)
          .max(500)
          .default(50)
          .describe("How many stored observations to use as baseline. 0 skips history entirely."),
        record: z
          .boolean()
          .default(true)
          .describe("Append this cycle to the local observation history."),
      },
      annotations: { ...READ_ONLY, readOnlyHint: false, idempotentHint: false },
    },
    async ({ asset, baselineLimit, record }) =>
      guard(async () => {
        const resolved = resolveAsset(asset);
        const baseline =
          baselineLimit > 0 ? ctx.history.read(resolved.mint, baselineLimit) : [];
        const snapshot = await collectSnapshot(resolved, ctx.config);

        if (snapshot.evidence.length === 0) {
          return ok(
            `Every source failed for ${resolved.label}, so there is nothing to analyze:\n${snapshot.failedSources.map((f) => `- ${f}`).join("\n")}`,
          );
        }

        const analysis = analyzeSnapshot(snapshot, baseline);
        const confidence = scoreConfidence(snapshot, analysis, baseline.length);
        if (record) ctx.history.append(resolved.mint, toBaselinePoint(snapshot));

        const parts: string[] = [
          `# ${snapshot.assetLabel} observation cycle`,
          `Captured ${snapshot.capturedAt} against ${baseline.length} prior observation(s). Confidence ${confidence.score} (${confidence.band}).`,
          section(
            "Snapshot",
            table(
              ["Metric", "Value"],
              [
                ["Token price", usd(snapshot.tokenPriceUsd, 4)],
                ["Reference price", usd(snapshot.referencePriceUsd, 4)],
                ["Premium", bps(snapshot.premiumBps)],
                ["Supply", num(snapshot.supplyUiAmount, 2)],
                ["Pooled liquidity", usd(snapshot.liquidityUsd)],
                ["24h volume", usd(snapshot.volume24hUsd)],
                ["Txns 24h / 1h", `${num(snapshot.txns24h)} / ${num(snapshot.txnsH1)}`],
                ["Pools", num(snapshot.pairCount)],
                ["Top 5 account share", pct(snapshot.top5HolderShare)],
              ],
            ),
          ),
          section(
            "Observations",
            analysis.observations.length > 0
              ? analysis.observations.map((o) => `- ${o.statement}`).join("\n")
              : "No observations could be formed from the sources that answered.",
          ),
          section(
            "Detections",
            analysis.detections.length > 0
              ? analysis.detections
                  .map((d) => `- [${d.severity}] ${d.kind}: ${d.message}`)
                  .join("\n")
              : baseline.length === 0
                ? "None. With no stored history, only the premium threshold can fire. Call this tool again later to build a baseline."
                : "None. Every metric sits inside its threshold.",
          ),
        ];

        if (analysis.conflicts.length > 0) {
          parts.push(
            section("Conflicts", analysis.conflicts.map((c) => `- ${c}`).join("\n")),
          );
        }
        if (snapshot.failedSources.length > 0) {
          parts.push(
            section(
              "Source failures",
              snapshot.failedSources.map((f) => `- ${f}`).join("\n"),
            ),
          );
        }

        parts.push(
          section(
            "Confidence factors",
            confidence.factors.map((f) => `- ${f}`).join("\n"),
          ),
          section(
            "Evidence",
            table(
              ["Source", "What was read", "Retrieved", "Payload hash"],
              snapshot.evidence.map((e) => [
                e.publisher,
                e.title,
                e.retrievedAt,
                e.dataHash,
              ]),
            ),
          ),
          "Thresholds in force: " +
            Object.entries(defaultThresholds)
              .map(([key, value]) => `${key}=${value}`)
              .join(", "),
        );

        return ok(parts.join("\n\n"));
      }),
  );

  server.registerTool(
    "get_observation_history",
    {
      title: "Read stored observations",
      description:
        "Read the observation history this server has stored for an asset, newest last, with the trend across premium, supply, liquidity, and concentration. History is written by observe_asset and lives on the machine running the server, not on any remote service.",
      inputSchema: {
        asset: z.string().describe(ASSET_ARG_DESCRIPTION),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(20)
          .describe("How many stored points to return."),
      },
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    async ({ asset, limit }) =>
      guard(async () => {
        const resolved = resolveAsset(asset);
        const points = ctx.history.read(resolved.mint, limit);
        if (points.length === 0) {
          return ok(
            `No observations stored for ${resolved.label} yet. Run observe_asset first. History location: ${ctx.history.location()}`,
          );
        }

        const first = points[0]!;
        const last = points[points.length - 1]!;
        const delta = (a: number | null, b: number | null) =>
          a === null || b === null || a === 0 ? "n/a" : `${(((b - a) / Math.abs(a)) * 100).toFixed(2)}%`;

        return ok(
          [
            `# ${resolved.label} observation history`,
            `${points.length} point(s) from ${first.capturedAt} to ${last.capturedAt}. Stored at ${ctx.history.location()}.`,
            table(
              ["Captured", "Premium", "Supply", "Liquidity", "Txns 1h", "Top 5 share"],
              points.map((p) => [
                p.capturedAt,
                bps(p.premiumBps),
                num(p.supplyUiAmount, 2),
                usd(p.liquidityUsd),
                num(p.txnsH1),
                pct(p.top5HolderShare),
              ]),
            ),
            section(
              "Change across the window",
              [
                `Supply: ${delta(first.supplyUiAmount, last.supplyUiAmount)}`,
                `Liquidity: ${delta(first.liquidityUsd, last.liquidityUsd)}`,
                `Premium: ${bps(first.premiumBps)} to ${bps(last.premiumBps)}`,
                `Top 5 share: ${pct(first.top5HolderShare)} to ${pct(last.top5HolderShare)}`,
              ]
                .map((l) => `- ${l}`)
                .join("\n"),
            ),
          ].join("\n\n"),
        );
      }),
  );

  server.registerTool(
    "list_research",
    {
      title: "List published research",
      description:
        "List research objects published by the Metis agent, newest first. Each entry carries its confidence band, impact, and content hash. Use get_research to pull the full evidence graph behind one of them.",
      inputSchema: {
        asset: z
          .string()
          .optional()
          .describe("Filter to one asset symbol, for example TSLAx."),
        category: z
          .enum(CATEGORIES)
          .optional()
          .describe("Filter by research category."),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: READ_ONLY,
    },
    async ({ asset, category, limit }) =>
      guard(async () => {
        const objects = await ctx.api.listResearch({ asset, category });
        if (objects.length === 0) {
          return ok("No published research matches that filter.");
        }
        const rows = objects
          .slice(0, limit)
          .map((o) => [
            o.publishedAt.slice(0, 16).replace("T", " "),
            o.assets.map((a) => a.symbol).join(", ") || "n/a",
            o.category,
            o.title,
            `${o.confidence.band} ${o.confidence.score}`,
            o.impact,
            o.id,
          ]);
        return ok(
          [
            table(
              ["Published", "Asset", "Category", "Title", "Confidence", "Impact", "Id"],
              rows,
            ),
            `${objects.length} object(s) published in total. Fetch one with get_research using its id or slug.`,
          ].join("\n\n"),
        );
      }),
  );

  server.registerTool(
    "get_research",
    {
      title: "Get one research object",
      description:
        "Fetch a full published research object: thesis, claims with the evidence each one rests on, methodology, confidence rubric, limitations, and provenance including the content hash and the models used. Returned as JSON because the object model, not the prose, is the source of truth.",
      inputSchema: {
        id: z.string().describe("Research object id or slug, from list_research."),
      },
      annotations: READ_ONLY,
    },
    async ({ id }) =>
      guard(async () => {
        const object = await ctx.api.getResearch(id);
        return ok(JSON.stringify(object, null, 2));
      }),
  );

  server.registerTool(
    "get_research_status",
    {
      title: "Read agent runtime status",
      description:
        "Read what the Metis research agent is doing right now: the investigation in flight and its stage, what is queued, the health of each source class, and the most recent public runtime events.",
      inputSchema: {
        events: z
          .number()
          .int()
          .min(0)
          .max(50)
          .default(10)
          .describe("How many recent events to include."),
      },
      annotations: READ_ONLY,
    },
    async ({ events }) =>
      guard(async () => {
        const live = await ctx.api.getLive();
        const active = live.runtime.activeInvestigation;
        const parts = [
          `# Runtime is ${live.runtime.status}`,
          active
            ? [
                `Active investigation ${active.runId} at stage ${active.stage}.`,
                `- Subject: ${active.subject}`,
                `- Assets: ${active.assetSymbols.join(", ")}`,
                `- Started ${timeAgo(active.startedAt)}, last update ${timeAgo(active.lastUpdateAt)}`,
                `- ${active.observationCount} observation(s), ${active.verifiedSourceCount} verified source(s), ${active.conflictingSignalCount} conflicting signal(s)`,
              ].join("\n")
            : "No investigation is in flight.",
          section(
            "Source health",
            table(
              ["Source", "State", "Checked"],
              live.runtime.sourceHealth.map((s) => [
                s.label,
                s.state,
                timeAgo(s.lastCheckedAt),
              ]),
            ),
          ),
        ];

        if (live.runtime.queuedInvestigations.length > 0) {
          parts.push(
            section(
              "Queued",
              live.runtime.queuedInvestigations
                .map((q) => `- ${q.category}: ${q.subject} (${q.scheduledFor})`)
                .join("\n"),
            ),
          );
        }
        if (events > 0 && live.events.length > 0) {
          parts.push(
            section(
              "Recent events",
              live.events
                .slice(0, events)
                .map((e) => `- ${timeAgo(e.occurredAt)} [${e.stage}] ${e.kind}: ${e.message}`)
                .join("\n"),
            ),
          );
        }
        return ok(parts.join("\n\n"));
      }),
  );

  server.registerTool(
    "check_sources",
    {
      title: "Check source health",
      description:
        "Probe every data source this server depends on (Solana RPC, DEX venue data, and the price service) and report which answered and how fast. Run this when a research tool returns partial data.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      guard(async () => {
        const probeMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
        const started = Date.now();
        const [chain, dex, price] = await Promise.all([
          ctx.solana.health(),
          ctx.dex
            .getMarketState(probeMint)
            .then(() => ({ ok: true, error: undefined as string | undefined }))
            .catch((error: unknown) => ({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })),
          ctx.jupiter
            .getPriceState(probeMint)
            .then(() => ({ ok: true, error: undefined as string | undefined }))
            .catch((error: unknown) => ({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })),
        ]);

        return ok(
          [
            table(
              ["Source", "State", "Detail"],
              [
                [
                  "Solana RPC",
                  chain.ok ? "healthy" : "down",
                  chain.ok ? `${chain.latencyMs}ms` : (chain.error ?? "unknown error"),
                ],
                ["DEX venue data", dex.ok ? "healthy" : "down", dex.error ?? "probe pair resolved"],
                ["Price service", price.ok ? "healthy" : "down", price.error ?? "probe price resolved"],
              ],
            ),
            `Probed in ${Date.now() - started}ms. History: ${ctx.history.location()}.`,
          ].join("\n\n"),
        );
      }),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bps, num, pct, section, shortAddress, table, usd } from "../format.js";
import { assetRegistry, resolveAsset } from "../registry.js";
import { summarizeControls } from "../token-controls.js";
import {
  ASSET_ARG_DESCRIPTION,
  READ_ONLY,
  guard,
  ok,
  type ToolContext,
} from "./shared.js";

const SEVERITY_MARK = { high: "!!", medium: "!", info: "." } as const;

export function registerOnChainTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_rwa_assets",
    {
      title: "List tokenized assets",
      description:
        "List the tokenized real-world assets this server knows by symbol, with their Solana mint and the security each one tracks. Every other tool also accepts a raw mint address, so this list is a starting point rather than a limit.",
      inputSchema: {},
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    async () =>
      guard(async () => {
        const assets = assetRegistry();
        const body = table(
          ["Symbol", "Name", "Type", "Tracks", "Issuer", "Mint"],
          assets.map((a) => [
            a.symbol,
            a.name,
            a.assetType.replaceAll("_", " "),
            a.referenceTicker ?? "n/a",
            a.issuerName,
            a.mint,
          ]),
        );
        return ok(
          `${body}\n\nAdd more assets with a JSON file at METIS_ASSETS_FILE. Mints listed here were verified on Solana mainnet before being added.`,
        );
      }),
  );

  server.registerTool(
    "get_token_supply",
    {
      title: "Read on-chain supply",
      description:
        "Read circulating supply for a tokenized asset directly from Solana, along with decimals, the slot the read was taken at, and the token program that owns the mint. For a backed asset this is the number the issuer's reserves have to cover.",
      inputSchema: {
        asset: z.string().describe(ASSET_ARG_DESCRIPTION),
      },
      annotations: READ_ONLY,
    },
    async ({ asset }) =>
      guard(async () => {
        const resolved = resolveAsset(asset);
        const supply = await ctx.solana.getSupply(resolved.mint);
        const controls = await ctx.solana
          .getMintControls(resolved.mint)
          .catch(() => null);

        const lines = [
          `Supply: ${num(supply.uiAmount, 4)} tokens`,
          `Raw amount: ${supply.rawAmount} (${supply.decimals} decimals)`,
          `Read at slot: ${num(supply.slot)}`,
          `Token program: ${controls?.program ?? "unknown"}`,
          `Supply cap: ${
            controls
              ? controls.mintAuthority
                ? `open, mint authority ${controls.mintAuthority} can issue more`
                : "fixed, mint authority is revoked"
              : "unknown"
          }`,
        ];
        return ok(
          `# ${resolved.registered?.name ?? resolved.label}\n\nMint \`${resolved.mint}\`\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\nSource: Solana RPC ${supply.record.retrievedAt}, payload ${supply.record.payloadHash}`,
        );
      }),
  );

  server.registerTool(
    "get_token_controls",
    {
      title: "Inspect issuer controls",
      description:
        "Inspect the powers an issuer holds over a token: mint authority, freeze authority, and every Token-2022 extension on the mint, each translated into what it means for someone holding the token. This is the first check to run on any real-world-asset token, because permissioned controls such as a permanent delegate, a transfer hook, or frozen-by-default accounts change what ownership is worth.",
      inputSchema: {
        asset: z.string().describe(ASSET_ARG_DESCRIPTION),
      },
      annotations: READ_ONLY,
    },
    async ({ asset }) =>
      guard(async () => {
        const resolved = resolveAsset(asset);
        const controls = await ctx.solana.getMintControls(resolved.mint);
        const summary = summarizeControls(controls);

        const findings = table(
          ["", "Control", "Authority", "What it means"],
          summary.findings.map((f) => [
            SEVERITY_MARK[f.severity],
            f.label,
            f.authority ? shortAddress(f.authority) : f.authority === null ? "revoked" : "n/a",
            f.detail,
          ]),
        );

        const parts = [
          `# ${resolved.registered?.name ?? resolved.label} issuer controls`,
          `Mint \`${resolved.mint}\` on ${summary.program}.`,
          `**${summary.verdict}**`,
          section("Controls", findings),
        ];
        if (summary.unrecognizedExtensions.length > 0) {
          parts.push(
            section(
              "Unrecognized extensions",
              `This build has no description for: ${summary.unrecognizedExtensions.join(", ")}. Read them from the raw mint account before relying on this summary.`,
            ),
          );
        }
        parts.push(
          `Marks: !! holder position can be moved, frozen, or blocked by the issuer. ! economics or displayed balances can change. . informational.\n\nSource: Solana RPC ${controls.record.retrievedAt}, payload ${controls.record.payloadHash}`,
        );
        return ok(parts.join("\n\n"));
      }),
  );

  server.registerTool(
    "get_holder_concentration",
    {
      title: "Read holder concentration",
      description:
        "List the largest token accounts for an asset with each one's share of supply, the wallet that owns it, and whether it is frozen. Concentration is the practical exit-risk measure for a tokenized asset, though the top of this list is usually liquidity pools and custodians rather than end investors.",
      inputSchema: {
        asset: z.string().describe(ASSET_ARG_DESCRIPTION),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe("How many accounts to list. The RPC returns at most 20."),
        resolveOwners: z
          .boolean()
          .default(true)
          .describe("Resolve the wallet behind each token account. Costs one extra RPC read."),
      },
      annotations: READ_ONLY,
    },
    async ({ asset, limit, resolveOwners }) =>
      guard(async () => {
        const resolved = resolveAsset(asset);
        const supply = await ctx.solana.getSupply(resolved.mint);
        const holders = await ctx.solana.getLargestAccounts(
          resolved.mint,
          supply.uiAmount,
          resolveOwners,
        );

        const rows = holders.largest.slice(0, limit).map((account, index) => [
          String(index + 1),
          shortAddress(account.address),
          num(account.uiAmount, 2),
          pct(account.share),
          account.owner ? shortAddress(account.owner) : "n/a",
          account.frozen === undefined ? "n/a" : account.frozen ? "frozen" : "active",
        ]);

        const parts = [
          `# ${resolved.registered?.name ?? resolved.label} concentration`,
          `Top 5 accounts hold ${pct(holders.top5Share)} of supply, top 10 hold ${pct(holders.top10Share)}. Supply is ${num(supply.uiAmount, 2)} tokens.`,
          table(
            ["#", "Token account", "Balance", "Share", "Owner", "State"],
            rows,
          ),
          "These are token accounts, not beneficial owners. Liquidity pools, bridges, and custodial accounts usually occupy the top places, so a high share here is not by itself evidence of a concentrated investor base.",
          `Source: Solana RPC ${holders.record.retrievedAt}, payload ${holders.record.payloadHash}`,
        ];
        if (resolveOwners && !holders.ownersResolved) {
          parts.splice(3, 0, "Owner resolution failed this call, so the owner column is empty.");
        }
        return ok(parts.join("\n\n"));
      }),
  );

  server.registerTool(
    "get_token_market",
    {
      title: "Read DEX market state",
      description:
        "Read aggregated on-chain market state for a tokenized asset: pooled liquidity, 24h volume, transaction counts, and the individual pools behind those totals. Thin liquidity relative to supply is the usual reason a tokenized asset cannot be exited at its reference price.",
      inputSchema: {
        asset: z.string().describe(ASSET_ARG_DESCRIPTION),
        pools: z
          .number()
          .int()
          .min(1)
          .max(25)
          .default(5)
          .describe("How many pools to list, largest first."),
      },
      annotations: READ_ONLY,
    },
    async ({ asset, pools }) =>
      guard(async () => {
        const resolved = resolveAsset(asset);
        const market = await ctx.dex.getMarketState(resolved.mint);
        const turnover =
          market.liquidityUsd > 0 ? market.volume24hUsd / market.liquidityUsd : null;

        const totals = [
          `Pooled liquidity: ${usd(market.liquidityUsd)} across ${market.pairCount} pools`,
          `24h volume: ${usd(market.volume24hUsd)}${turnover !== null ? ` (${turnover.toFixed(2)}x turnover of liquidity)` : ""}`,
          `Transactions: ${num(market.txns24h)} in 24h, ${num(market.txnsH1)} in the last hour`,
          `Deepest pool: ${market.topPoolDex ?? "unknown"} at ${usd(market.priceUsd, 4)}`,
          `24h price change: ${market.priceChange24hPct !== null ? `${market.priceChange24hPct.toFixed(2)}%` : "n/a"}`,
        ];

        return ok(
          [
            `# ${resolved.registered?.name ?? resolved.label} market state`,
            totals.map((l) => `- ${l}`).join("\n"),
            table(
              ["Venue", "Pair", "Price", "Liquidity", "24h volume", "24h txns"],
              market.pools
                .slice(0, pools)
                .map((p) => [
                  p.dex,
                  p.pair,
                  p.assetIsBase ? usd(p.priceUsd, 4) : "quote side",
                  usd(p.liquidityUsd),
                  usd(p.volume24hUsd),
                  num(p.txns24h),
                ]),
            ),
            'Pools marked "quote side" price the other token in the pair, not this asset. Totals cover every listed Solana pool, including those.',
            `Source: DexScreener ${market.record.retrievedAt}, payload ${market.record.payloadHash}`,
          ].join("\n\n"),
        );
      }),
  );

  server.registerTool(
    "get_reference_premium",
    {
      title: "Compare token price to its reference",
      description:
        "Compare a tokenized asset's on-chain price against the price of the security it tracks, and report the gap in basis points. A persistent premium or discount is the clearest sign that the mint and redeem path is not clearing, whether because of venue friction, market hours, or issuer limits.",
      inputSchema: {
        asset: z.string().describe(ASSET_ARG_DESCRIPTION),
      },
      annotations: READ_ONLY,
    },
    async ({ asset }) =>
      guard(async () => {
        const resolved = resolveAsset(asset);
        const price = await ctx.jupiter.getPriceState(resolved.mint);
        const reference = resolved.registered?.referenceTicker ?? "the reference";

        if (price.referencePriceUsd === null) {
          return ok(
            `${resolved.label} trades at ${usd(price.tokenPriceUsd, 4)}. No reference price is published for this mint, so there is no premium to compute. This is expected for tokens that do not track a listed security.\n\nSource: Jupiter ${price.record.retrievedAt}, payload ${price.record.payloadHash}`,
          );
        }

        const direction =
          price.premiumBps === null
            ? "flat to"
            : price.premiumBps > 0
              ? "above"
              : "below";
        return ok(
          [
            `# ${resolved.registered?.name ?? resolved.label} versus ${reference}`,
            [
              `Token price: ${usd(price.tokenPriceUsd, 4)}`,
              `Reference price: ${usd(price.referencePriceUsd, 4)}${price.referenceUpdatedAt ? ` (updated ${price.referenceUpdatedAt})` : ""}`,
              `Premium: ${bps(price.premiumBps)}, trading ${direction} the reference`,
              `24h token price change: ${price.priceChange24hPct !== null ? `${price.priceChange24hPct.toFixed(2)}%` : "n/a"}`,
            ]
              .map((l) => `- ${l}`)
              .join("\n"),
            "The reference price is republished by a third party and can be stale outside market hours, which alone can produce a premium that is not an arbitrage.",
            `Source: Jupiter ${price.record.retrievedAt}, payload ${price.record.payloadHash}`,
          ].join("\n\n"),
        );
      }),
  );
}

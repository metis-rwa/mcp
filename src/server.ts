import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetisApi } from "./api.js";
import { SERVER_NAME, SERVER_VERSION, loadConfig, type Config } from "./config.js";
import { HistoryStore } from "./history.js";
import { assetRegistry } from "./registry.js";
import { defaultThresholds } from "./research/analyze.js";
import { registerOnChainTools } from "./tools/onchain.js";
import { registerResearchTools } from "./tools/research.js";
import { createContext } from "./tools/shared.js";

const METHODOLOGY = `# How this server produces answers

Every number comes from a live read. Nothing is cached between calls and nothing
is inferred from a model's memory.

## Sources

1. Solana JSON-RPC, read directly. Supply, mint authorities, Token-2022
   extensions, and the largest token accounts. This is primary evidence: it is
   the chain state itself.
2. DEX venue data, aggregated across every listed Solana pool for the mint.
   Pooled liquidity, 24h volume, and transaction counts.
3. A public price service. Token price in USD and, for tokenized equities, the
   republished price of the security the token tracks.

Each read is stamped with its source, the time it was taken, and a SHA-256 hash
of the raw payload, so any figure can be traced back later.

## Detection

An observation cycle compares the current read against the observations already
stored for that asset. A detection fires when a metric crosses a threshold:

${Object.entries(defaultThresholds)
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

With no stored history only the premium threshold can fire, because the rest are
defined against a baseline. History builds as observe_asset is called.

## Confidence

Confidence is computed, never asserted. It starts at 0.5 and moves on source
coverage, source failures, cross-source price agreement, and how much history
backs the comparison. A model's own stated confidence is not an input.

## Limitations that apply to every answer

- Largest token accounts are accounts, not beneficial owners. Pools, bridges,
  and custodial accounts sit at the top of most lists.
- A republished reference price can be stale outside market hours, which can
  show up as a premium that is not tradable.
- Aggregated venue data covers listed pools only. Over the counter and internal
  flow is invisible here.
- This is informational research, not financial advice, and it can be wrong.`;

export function createServer(config: Config = loadConfig()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: `Research tools for tokenized real-world assets on Solana.

Start with get_token_controls when the question is whether a token is safe to
hold: it reports the powers the issuer keeps over holder positions. Use
observe_asset for a full research cycle across chain state, market state, and
price, and call it more than once to build the baseline that change detections
need. Use list_research and get_research to read what the Metis agent has
already published, and get_research_status to see what it is working on now.

Every tool accepts either a registry symbol or a raw Solana mint address. Read
the metis://methodology resource before presenting figures as conclusions.`,
    },
  );

  const api = new MetisApi(config);
  const history = new HistoryStore(config.stateDir);
  const ctx = createContext(config, api, history);

  registerOnChainTools(server, ctx);
  registerResearchTools(server, ctx);

  server.registerResource(
    "asset-registry",
    "metis://registry",
    {
      title: "Tokenized asset registry",
      description: "Assets this server knows by symbol, with verified Solana mints.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(assetRegistry(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "methodology",
    "metis://methodology",
    {
      title: "Methodology and limitations",
      description:
        "Where the numbers come from, how detections fire, how confidence is computed, and what the answers cannot tell you.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: METHODOLOGY }],
    }),
  );

  server.registerPrompt(
    "rwa_due_diligence",
    {
      title: "Due diligence on a tokenized asset",
      description:
        "Walk an asset through issuer controls, supply, concentration, market depth, and reference premium, then state what would have to be true for the token to be worth its reference price.",
      argsSchema: {
        asset: z
          .string()
          .describe("Registry symbol such as TSLAx, or a Solana mint address."),
      },
    },
    ({ asset }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Work through ${asset} in this order and report what you find at each step.

1. get_token_controls. State plainly whether the issuer can mint, freeze, seize,
   or block transfers, and what that means for a holder.
2. get_token_supply and get_holder_concentration. Is supply fixed or open, and
   how much of it sits in the top accounts? Say which of those accounts look
   like pools or custodians rather than investors.
3. get_token_market. Could a position of meaningful size be exited into this
   liquidity, and at what cost?
4. get_reference_premium. Is the token trading away from the security it
   tracks, and is that gap explainable by market hours or venue friction?
5. observe_asset for the full cycle, and list_research to see whether the Metis
   agent has already published on this asset.

Finish with the conditions that would have to hold for this token to be worth
its reference price, and name the ones you could not verify from on-chain data.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "premium_watch",
    {
      title: "Watch a premium or discount",
      description:
        "Take an observation cycle, compare it against stored history, and judge whether a price gap is opening or closing.",
      argsSchema: {
        asset: z.string().describe("Registry symbol or Solana mint address."),
      },
    },
    ({ asset }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Run observe_asset on ${asset}, then get_observation_history for the same asset.

Report the current premium against the reference price, how it compares with the
stored window, and whether liquidity and hourly transaction counts moved with it.
If there is no stored history yet, say so and treat the reading as a single
point rather than a trend. Do not present the premium as an arbitrage without
saying what would have to be true to capture it.`,
          },
        },
      ],
    }),
  );

  return server;
}

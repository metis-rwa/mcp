# Metis MCP

An MCP server for researching tokenized real-world assets on Solana.

It gives an assistant twelve tools: six that read chain and market state live,
and six that reach the research the [Metis](https://metisagent.co) agent has
already published. Every figure it returns comes from a fresh read, stamped with
its source, the time it was taken, and a hash of the raw payload.

The point is the first question anyone should ask about a tokenized asset and
almost nobody can answer quickly: who controls this token, and what happens to
my position if they use that control?

## Install

Run it straight from the repository with npx:

```bash
npx -y github:metis-rwa/mcp
```

Or clone and build:

```bash
git clone https://github.com/metis-rwa/mcp.git
cd mcp
npm install
npm run build
node dist/index.js
```

The server speaks MCP over stdio.

## Connect it

Claude Code:

```bash
claude mcp add metis -- npx -y github:metis-rwa/mcp
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "metis": {
      "command": "npx",
      "args": ["-y", "github:metis-rwa/mcp"],
      "env": {
        "SOLANA_RPC_URL": "https://your-endpoint.example/rpc"
      }
    }
  }
}
```

Any other MCP client works the same way: run `metis-mcp` (or
`node dist/index.js`) and speak MCP on stdin and stdout.

## Tools

On-chain checks:

| Tool | What it answers |
| --- | --- |
| `list_rwa_assets` | Which assets this server knows by symbol, and their mints |
| `get_token_controls` | Can the issuer mint, freeze, seize, pause, or gate transfers |
| `get_token_supply` | How many tokens exist, and whether supply is capped |
| `get_holder_concentration` | Who holds the supply, and is any of it frozen |
| `get_token_market` | How deep the liquidity is, pool by pool |
| `get_reference_premium` | Is the token trading away from the security it tracks |

Research:

| Tool | What it answers |
| --- | --- |
| `observe_asset` | One full research cycle: read everything, compare against history, report detections and confidence |
| `get_observation_history` | What this server has recorded for the asset so far, and the trend |
| `list_research` | What the Metis agent has published, filtered by asset or category |
| `get_research` | The full object behind one publication: claims, evidence, methodology, provenance |
| `get_research_status` | What the agent is investigating right now, and source health |
| `check_sources` | Which data sources are answering, and how fast |

Every tool takes either a registry symbol (`TSLAx`) or a raw Solana mint
address, so assets outside the registry work too.

The registry ships with the 72 xStocks on Solana, from `AAPLx` through `XOMx`,
including the index and commodity fund shares (`SPYx`, `QQQx`, `GLDx`, `PPLTx`,
`TBLLx`) and the private-market listings (`SPCXx`, `VCXx`). Filter it with
`list_rwa_assets`, by substring or by asset type.

Two prompts ship with the server: `rwa_due_diligence` walks an asset through
controls, supply, concentration, depth, and premium, and `premium_watch` reads a
price gap against stored history. Two resources are exposed as well:
`metis://registry` and `metis://methodology`.

## What `get_token_controls` is for

A tokenized equity is a claim on something held off chain, so the issuer keeps
powers a plain token does not have. Token-2022 makes those powers explicit on
the mint, and this tool translates each one into what it means for a holder:

- **Permanent delegate**: tokens can be moved or burned out of any account
  without the holder signing.
- **Freeze authority**: any account can be frozen, which blocks selling and
  redemption.
- **Transfer hook**: every transfer runs through a program that can reject it,
  which is how an allowlist is enforced.
- **Default account state frozen**: new accounts cannot transact until the
  issuer thaws them, so the token is permissioned by default.
- **Pausable**: transfers can be halted chain-wide.
- **Scaled UI amount**: displayed balances are rescaled, which is how splits
  and similar corporate actions land on chain.

None of these are defects. Redeemable backed assets need most of them. They are
simply facts about the asset that belong in any answer about whether it is worth
its reference price.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SOLANA_RPC_URL` | a public node | Solana JSON-RPC endpoint |
| `METIS_API_URL` | `https://metisagent.co` | Metis research API |
| `METIS_ASSETS_FILE` | none | JSON file of extra assets to register |
| `METIS_MCP_STATE_DIR` | `~/.metis-mcp` | Where observation history is stored. Set to `off` for memory only |
| `METIS_MCP_TIMEOUT_MS` | `20000` | Network timeout per request |

Set `SOLANA_RPC_URL` to an endpoint you control if you can. Public nodes
throttle the heavier reads, and `get_holder_concentration` is the first one they
refuse.

`METIS_ASSETS_FILE` takes an array. Only `symbol` and `mint` are required:

```json
[
  {
    "symbol": "AAPLx",
    "name": "Apple xStock",
    "mint": "<mint address>",
    "decimals": 8,
    "assetType": "tokenized_equity",
    "referenceTicker": "AAPL",
    "issuerName": "Backed Assets"
  }
]
```

Verify a mint against the chain before adding it. A wrong address returns
confident, wrong answers. Everything already in the registry was read back from
Solana first: the names and symbols in `src/assets.ts` are the ones written into
each mint's own Token-2022 metadata, not labels copied from a token list. Check
them again at any time:

```bash
npm run verify-assets
```

## How an observation cycle works

`observe_asset` reads supply and holder concentration from Solana, pooled
liquidity and volume from DEX venues, and the token and reference prices from a
public price service. It compares the result against the observations already
stored for that asset, then reports:

- **Observations**: what is true right now, each tied to the reads behind it.
- **Detections**: metrics that crossed a threshold, with the baseline they
  crossed it against.
- **Conflicts**: sources that disagree, recorded rather than averaged away.
- **Confidence**: computed from source coverage, source failures, cross-source
  agreement, and how much history backs the comparison. A model's own stated
  confidence is never an input.

History lives on the machine running the server. The first call on an asset has
no baseline, so only the premium threshold can fire. Call it again over time and
supply, liquidity, activity, and concentration detections come alive.

## Limits worth stating

- Largest token accounts are accounts, not beneficial owners. Pools, bridges,
  and custodial accounts sit at the top of most lists.
- A republished reference price can be stale outside market hours, and that
  alone can look like a premium.
- Aggregated venue data covers listed pools. Anything traded over the counter
  or internally is invisible here.
- This is informational research produced by software. It is not financial
  advice, and it can be wrong.

## Development

```bash
npm install
npm run typecheck
npm test
npm run inspector
```

Tests cover the analysis rules, the control translations, the registry, and the
history store. They run against the build, so `npm test` builds first.

## Releasing

The package publishes to npm as `@metis-rwa/mcp`, and `server.json` describes it
for the MCP registry. The registry proves ownership by matching `mcpName` in
`package.json` against the server name in `server.json`, so those two strings
have to stay in step.

1. Bump the version in `package.json` and in both places in `server.json`, then
   add a `CHANGELOG.md` entry.
2. `npm run verify-assets` to confirm the registry still matches the chain.
3. `npm test`.
4. `npm publish --access public`.
5. `mcp-publisher login github` then `mcp-publisher publish` to list the release
   in the MCP registry.

## License

MIT

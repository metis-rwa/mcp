# Metis plugin

Research tokenized real-world assets on Solana from inside Claude. The plugin
connects to the hosted Metis research server, so there is nothing to install,
no key to configure, and no local process to run.

## Install

In Claude Code:

```
/plugin marketplace add metis-rwa/mcp
```

```
/plugin install metis@metis-rwa
```

In Claude Desktop or on the web, open Customize, then Plugins, then add from a
repository and give it `https://github.com/metis-rwa/mcp.git`.

## What you get

Twelve tools, from `https://metisagent.co/mcp`:

| Tool | What it answers |
| --- | --- |
| `get_token_controls` | Can the issuer mint, freeze, seize, pause, or gate transfers |
| `get_token_supply` | How many tokens exist, and whether supply is capped |
| `get_holder_concentration` | Who holds the supply, and how many wallets |
| `get_token_market` | How deep the liquidity is, pool by pool |
| `get_reference_premium` | Is the token trading away from the security it tracks |
| `list_rwa_assets` | Which assets are under continuous observation |
| `observe_asset` | A live cycle compared against stored history |
| `get_observation_history` | What has been recorded for an asset, and the trend |
| `list_research`, `get_research` | Published research with its evidence graph |
| `get_research_status`, `check_sources` | What the agent is doing, and source health |

And three skills:

- `/metis:due-diligence TSLAx` walks an asset through controls, supply,
  concentration, depth, premium, and published research, then closes with the
  conditions it could not verify rather than a recommendation.
- `/metis:premium-watch SPYx` reads the current gap against stored history.
- `token-safety` runs on its own whenever you ask whether a token is safe to
  hold, who controls it, or whether your tokens can be frozen.

## Try it

> Can the issuer of TSLAx freeze or seize my tokens?

The answer, today, is that four separate controls say yes: mint authority,
freeze authority, a permanent delegate that can move tokens without the holder
signing, and a pause switch. None of that makes it a scam. A redeemable backed
asset needs most of those powers. It is simply worth knowing before you decide
what the token is worth.

## Running it locally instead

The same tools ship as an npm package if you want your own RPC endpoint, your
own asset list, or observation history kept on your machine:

```bash
npx -y @metisagent/mcp
```

The hosted endpoint has history going back to when the research agent went
live, which a fresh local install cannot have. The local server has all 72
xStocks in its registry and answers from wherever you run it.

See the [repository](https://github.com/metis-rwa/mcp) for configuration.

## Limits

Largest token accounts are accounts, not beneficial owners. A republished
reference price can be stale outside market hours, and that alone looks like a
premium. This is informational research produced by software, it can be wrong,
and it is not financial advice.

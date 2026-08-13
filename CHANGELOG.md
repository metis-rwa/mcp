# Changelog

## Unreleased

- Pool data survives a rate-limited venue aggregator. DexScreener refuses
  datacenter traffic, so a server running anywhere but a laptop used to lose
  liquidity and volume entirely. Those two fields now fall back to the price
  service, while transaction counts, pool count, and the second venue price
  stay null rather than being invented from a source that does not measure
  them. The failure is still reported and the fallback is cited as its own
  evidence at lower reliability.
- Snapshots and history carry a holder wallet count, and
  `get_holder_concentration` reports it alongside the largest accounts.

## 0.1.0

First release.

- Twelve tools over stdio. On chain: `get_token_controls`, `get_token_supply`,
  `get_holder_concentration`, `get_token_market`, `get_reference_premium`,
  `list_rwa_assets`. Research: `observe_asset`, `get_observation_history`,
  `list_research`, `get_research`, `get_research_status`, `check_sources`.
- `get_token_controls` translates mint and freeze authorities and every
  Token-2022 extension into what the issuer can do to a holder's position.
- Observation cycles compare live reads against local history, report threshold
  detections and cross-source conflicts, and score confidence deterministically.
- Registry ships the 72 xStocks on Solana. Every mint was read back from the
  chain, and `npm run verify-assets` re-checks them against their own on-chain
  metadata.
- Resources `metis://registry` and `metis://methodology`, prompts
  `rwa_due_diligence` and `premium_watch`.

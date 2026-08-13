---
name: premium-watch
description: Read a tokenized asset's premium or discount against the security it tracks, compared with the observation history, to judge whether the gap is opening or closing.
disable-model-invocation: true
---

# Premium watch on $ARGUMENTS

A tokenized equity should track the security it represents. When it does not,
the gap is the most informative number available about whether the mint and
redeem path is clearing.

For the asset in `$ARGUMENTS`, or the one the user names if the argument is
empty:

1. `observe_asset` for the current cycle, which reads the token price, the
   reference price, and the pool state together at one moment.
2. `get_observation_history` for the stored window, so the current reading has
   something to sit against.

## What to report

- The premium now, in basis points, and which side of the reference it sits on.
- Where it sits inside the stored window: is this the widest it has been, is it
  converging, or is it noise around zero?
- Whether liquidity and hourly transaction counts moved with it. A premium that
  widens while liquidity drains is a different story from one that widens on
  heavy two-sided volume.
- Any detection the cycle fired, with the baseline it crossed.

## What not to do

Do not present a premium as an arbitrage. Say what would have to be true to
capture it: someone would need to mint or redeem at the reference price, in
size, at that moment, and the reference itself has to be live rather than a
stale republished quote from outside market hours. Most visible gaps on
tokenized equities are one of those two things rather than free money.

If the asset has little or no stored history, say so and treat the reading as a
single point rather than a trend.

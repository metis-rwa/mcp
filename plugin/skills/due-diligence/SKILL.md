---
name: due-diligence
description: Full due-diligence pass on a tokenized real-world asset: issuer controls, supply, holder concentration, market depth, reference premium, and the research already published on it.
disable-model-invocation: true
---

# Due diligence on $ARGUMENTS

Work the asset named in `$ARGUMENTS` through every step below, in order, and
report what you find at each one. If no asset was named, call
`list_rwa_assets` and ask which one.

Run the steps as you go rather than collecting everything and summarizing at
the end. Each answer should be readable on its own.

## 1. Who controls it

`get_token_controls`. State plainly whether the issuer can mint, freeze, seize,
pause, or gate transfers, and what each of those means for a holder. Do not
editorialize: a backed asset needs most of these powers.

## 2. What exists

`get_token_supply`. Is supply capped or open? For a backed asset, this is the
number the reserves have to cover.

## 3. Who holds it

`get_holder_concentration`. Report the top-5 and top-10 share and the holder
wallet count. Then say which of the top accounts look like pools, bridges, or
custodians rather than investors, because concentration among venues means
something very different from concentration among holders.

## 4. Could you get out

`get_token_market`. Compare pooled liquidity against the size someone might
actually hold. Say what a meaningful exit would cost in slippage terms, and
whether volume suggests anyone is trading it at all. If the tool returns the
partial view, say which numbers are missing rather than working around it.

## 5. What is it worth right now

`get_reference_premium`. Is the token trading away from the security it tracks?
Before calling a gap an opportunity, check whether it is explainable: the
reference price is republished by a third party and goes stale outside market
hours, which alone produces a premium nobody can capture.

## 6. What has already been observed

`observe_asset` for the current cycle against stored history, then
`list_research` filtered to this asset for anything the research agent has
published on it. `get_research` on the most relevant object gives you its
claims with the evidence each one rests on.

## Finish with conditions, not a verdict

Do not end with a recommendation. End with the conditions that would have to
hold for this token to be worth its reference price, and name the ones you
could not verify from on-chain data: reserve existence, custodian solvency,
whether redemption works in practice, and who the issuer answers to.

State clearly that this is informational research produced by software, that it
can be wrong, and that it is not financial advice.

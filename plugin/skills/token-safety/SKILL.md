---
name: token-safety
description: Answer whether an issuer can freeze, seize, pause, or dilute a tokenized asset, and what a holder is actually exposed to. Use whenever someone asks if a token is safe to hold, who controls it, whether their tokens can be taken or frozen, what happens if the issuer disappears, or whether a tokenized stock is really backed.
---

# What the issuer can do to a holder

Someone is asking what they are exposed to if they hold this token. Answer with
what the chain says, not with reassurance and not with alarm.

## Read the controls first

Call `get_token_controls` with the symbol or mint. It returns mint authority,
freeze authority, and every Token-2022 extension, each marked:

- `!!` the issuer can move, freeze, or block a holder's position
- `!` economics or displayed balances can change
- `.` informational

Report every `!!` finding in plain language. The ones that matter most:

- **Permanent delegate**: tokens can be transferred or burned out of any
  account without the holder signing anything.
- **Freeze authority**: any account can be frozen, which blocks selling and
  redemption from that account.
- **Pausable**: transfers can be halted chain-wide.
- **Transfer hook**: every transfer runs through a program that can reject it,
  which is how an allowlist is enforced. Say whether a hook program is actually
  set, since the extension can be present with none configured.
- **Default account state frozen**: new accounts cannot transact until the
  issuer thaws them. The token is permissioned by default.
- **Mint authority**: supply is not capped and can be issued at any time.

## Then say what it means

Give the honest reading, which is usually not a scandal. A redeemable
asset-backed token needs most of these powers: an issuer that cannot mint
cannot honour a new deposit, and one that cannot freeze cannot comply with a
court order or a sanctions list. The right conclusion is almost never "this is
a scam" and almost never "this is fine". It is: here is who can act on your
position, and here is what you are trusting them not to do.

Never call a token a scam or a rug on the strength of its extensions alone.
Never tell someone to buy or sell. If asked for a verdict, give the conditions
instead: what would have to be true about the issuer for these powers to be
acceptable.

## Fill in the rest when it is asked for

If the question is broader than control, add:

- `get_token_supply` for whether supply is fixed and what backing has to cover.
- `get_holder_concentration` for how much sits in the top accounts. Say plainly
  that these are token accounts, not owners: pools, bridges, and custodians
  occupy the top of every list, so a high share is not automatically a
  concentrated investor base.
- `get_token_market` for whether a position could actually be exited, and at
  what depth.

## Close with the limits

On-chain data cannot tell you whether the reserves exist, whether the custodian
is solvent, or whether redemption works in practice. Say which parts of the
answer you verified on chain and which parts you could not.

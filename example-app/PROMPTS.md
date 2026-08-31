# Learner Prompts

## Aiken owner and deadline

> Use the kuber-aiken skill to create an Aiken spending validator. The datum contains an
> owner verification key hash and an integer deadline. Spending is allowed only when the
> owner signed and the transaction's finite lower validity bound is at or after the
> deadline. Create the complete project under `contracts/owner-deadline`, compile only that
> project through Kuber MCP, and save the complete unmodified compiler response as
> `contracts/owner-deadline/compiled.json` if it is too large to return inline.

This request already fixes the purpose, authorization rule, and time boundary, so the agent
should proceed without asking unrelated questions.

## Ambiguous token request

> Use the appropriate Kuber contract skill to help me require exactly one token named
> `MEMBERSHIP`.

The request does not say whether the contract mints the token or spends a UTxO containing an
existing token. The agent should ask that question before choosing a pattern or writing code.

## Plutus owner and deadline

> Use the kuber-plutus skill to create one self-contained `Contract.hs`. The datum contains
> an owner public-key hash and a POSIX deadline. Spending requires the owner's signature and
> a validity range contained in `from deadline`. Write the positive and negative behaviour
> cases, compile only `Contract.hs`, and return the complete normalized `scripts[0]` object.

This prompt requires `KUBERIDE_API_KEY` in the MCP host environment.

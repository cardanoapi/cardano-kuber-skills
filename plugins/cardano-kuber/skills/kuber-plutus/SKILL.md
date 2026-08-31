---
name: kuber-plutus
description: Author, compile, and repair one-file Plutus V2 contracts in legacy Haskell through hosted Kuber MCP. Use when creating Plutus spending validators, minting policies, datum and redeemer rules, or resolving hosted Plutus compiler diagnostics. Route Aiken contracts to kuber-aiken.
---

# Author and Compile Plutus Contracts with Kuber

Develop one complete `Contract.hs` from on-chain requirements and compile the authored
source through hosted Kuber MCP. The workflow does not require a local installation of GHC,
Cabal, Cardano CLI, a Cardano node, or the Plutus toolchain.

Hosted compilation verifies source compatibility and artifact consistency. It does not prove
that a contract is vulnerability-free or production-ready, and it does not construct, sign,
submit, or execute transactions.

This workflow targets Kuber's legacy Plutus V2 compiler. Aiken contracts use
`kuber-aiken`; its project structure, syntax, and compiler rules do not apply here.

## When to use

- Creating a Plutus V2 spending validator or minting policy in legacy Haskell
- Translating contract requirements into datum, redeemer, authorization, value, time, and
  state-transition rules
- Defining positive and negative behaviour cases for a Plutus contract
- Compiling one self-contained `Contract.hs` through Kuber MCP
- Repairing hosted compiler diagnostics or interpreting normalized Plutus artifacts

## When NOT to use

- Aiken authoring or Aiken compiler diagnostics; use `kuber-aiken`
- Security review of an existing contract when no implementation work is requested
- Off-chain transaction construction without on-chain contract changes
- Wallet signing, submission, deployment, or mainnet-readiness assessment
- Modern Plinth source that requires a different compiler or package set

## Key principles

1. **Purpose first:** Distinguish spending from minting before selecting a pattern.
2. **Requirements before source:** Resolve only missing decisions that change on-chain
   behaviour.
3. **Explicit invariants:** Define every allowed action and the rejected cases that protect
   it before implementation.
4. **One-file boundary:** Produce one self-contained `Contract.hs` using the hosted
   compiler's legacy API.
5. **Diagnostic classification:** Repair source failures; preserve contract logic when
   credentials, infrastructure, conversion, or validation fails.
6. **Evidence boundaries:** Report compilation, behaviour-case execution, baked parameters,
   and deployability as separate facts.

## Workflow

### Step 1: Define the on-chain requirements

Establish:

- script purpose: spending validator or minting policy;
- datum fields and which values are mutable;
- redeemer variants and who may invoke each action;
- required signatures or other authorization evidence;
- controlled values, currency symbols, token names, and quantity rules;
- validity intervals and inclusive or exclusive time boundaries;
- output identity, payout rules, and permitted continuing-state transitions;
- values baked into the compiled script, such as an output reference or token name.

Ask only for unresolved information that materially changes transaction acceptance. Proceed
directly when the request already determines the invariant. A request for a “token,”
“quantity,” or “NFT” is incomplete until it distinguishes minting or burning from spending
an existing asset.

Record the resulting invariant, baked parameters, and explicit assumptions before writing
source.

### Step 2: Select the closest contract pattern

Choose by ledger purpose first, then by business rule:

| Requirement | Purpose | Reference pattern |
|---|---|---|
| Owner unlocks after a deadline | `spend` | owner plus deadline |
| Require a threshold of authorized signatures | `spend` | signature-threshold multisig |
| Joint release or timed refund | `spend` | two-party escrow |
| Move a script UTxO through states | `spend` | state transition |
| Create one unique NFT from a UTxO | `mint` | one-shot NFT |
| Require a named token amount in a payout | `spend` | token quantity |

Read the selected section in [contract patterns](references/contract-patterns.md). Consult a
second pattern only when the contract combines both invariants. Adapt the invariant and
author contract-specific source rather than copying a reference fragment unchanged.

### Step 3: Specify invariant checks and behaviour cases

For each redeemer path, define the allowed transaction shape and corresponding rejection
conditions. Apply every relevant check:

- required signatures;
- datum and redeemer decoding;
- permitted actions and rejection of unsupported branches;
- value preservation or explicit payout rules;
- validity-range containment and exact time boundaries;
- output identity and cardinality;
- continuing datum and state-transition rules;
- exact currency symbol, token name, and mint/burn or payout-quantity constraints;
- source-baked values and their replacement before final compilation.

Record positive cases for every allowed path and negative cases for each independent rule
that can fail. These cases are a design and test specification. Hosted compilation does not
run a Plutus evaluator or test suite.

Report behaviour cases as **authored, not executed** unless a compatible evaluator actually
ran them. When execution evidence exists, name the command or evaluator and report its
result separately from compilation.

### Step 4: Create the complete contract source

Read [Kuber hosted compilation](references/kuber-compile.md) before implementation. Create
one self-contained `Contract.hs` inside the user's DApp repository. Do not write the
contract inside this skill directory.

The source must:

- declare `module Contract where`;
- export the final script as `validator :: Validator`;
- use the pinned legacy Plutus module namespaces and compatible language extensions;
- include every required type, data instance, helper, wrapper, and applied parameter;
- mark every source-defined function reachable from the compiled quotation `INLINABLE`.

Do not split helpers into submitted `.hs` files. The hosted compiler selects one source
value and does not compile the other map entries as Haskell modules.

### Step 5: Compile and repair through Kuber MCP

Call `compile_contract` with `language: "plutus"` and a source map containing only the
newly authored `Contract.hs`. Omit `title` for the normal one-file request. Exclude skill
references, unrelated DApp files, generated output, and credentials.

Classify all diagnostics before editing:

- Haskell parse, type, import, module, export, and source-location errors justify source
  repair.
- Missing credentials, compiler unavailability, HTTP or transport failures, MeshJS
  conversion errors, and hash mismatches require investigation or reporting without changing
  the invariant.

After each source repair, verify that every allowed and rejected path still implements the
agreed invariant. Stop after five consecutive source-repair attempts that still fail.
Preserve signer, datum, redeemer, value, time, output, minting, and quantity requirements
when resolving compiler or artifact failures.

### Step 6: Validate and hand off the artifact

Accept the result as artifact-ready only when all conditions hold:

```text
result.status == "ready"
scripts[0].status == "ready"
scripts[0].plutusVersion == "v2"
scripts[0].meshjs.version == "V2"
scripts[0].validation.status == "valid"
scripts[0].validation.hashMatch == true
result.diagnostics is empty
scripts[0].diagnostics is empty
```

Source-baked parameters must contain the intended final values before compilation. A result
compiled with placeholders such as `REPLACE_ME`, a zero transaction ID, or another
temporary constant is not ready for use even when its artifact checks pass.

Provide:

- the complete final `Contract.hs` and its repository location;
- a concise invariant with all allowed and rejected paths;
- every source-baked value and confirmation that placeholders were replaced;
- behaviour cases and their actual execution status;
- complete compiler diagnostics and the source-repair attempt count;
- the complete normalized `scripts[0]` object, including script bytes, hashes, address,
  MeshJS data, status, diagnostics, and validation metadata.

If the exact response is too large to return inline, save the complete unmodified compiler
response as JSON beside the contract and provide its path. Preserve all script bytes; do not
insert ellipses or substitute a truncated console preview. Include `nativeArtifact` when
requested; the TextEnvelope does not replace the normalized `scripts[0]` result.

## References

- [Contract patterns](references/contract-patterns.md) -- purpose-first legacy Plutus V2
  invariants, Haskell fragments, behaviour cases, adaptation points, and limitations
- [Kuber hosted compilation](references/kuber-compile.md) -- legacy compiler compatibility,
  one-file source contract, exact MCP request, diagnostics, acceptance, and handoff rules

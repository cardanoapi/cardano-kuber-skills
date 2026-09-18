---
name: kuber-aiken
description: Author, compile, and repair Aiken v1.1 Cardano contracts through hosted Kuber MCP. Use when creating Aiken spending validators, minting policies, escrow, state transitions, token rules, or resolving Aiken compiler diagnostics. Route Plutus or Haskell contracts to the separate Plutus workflow.
---

# Author and Compile Aiken Contracts with Kuber

Develop a complete Aiken project from on-chain requirements and compile the authored source
through hosted Kuber MCP. The workflow does not require a local installation of Aiken, GHC,
Cabal, Cardano CLI, or other Cardano-specific tooling.

Hosted compilation verifies source compatibility and artifact consistency. It does not prove
that a contract is vulnerability-free or production-ready, and it does not sign, submit, or
deploy transactions.

## When to use

- Creating a new Aiken spending validator, minting policy, or other validator handler
- Translating contract requirements into datum, redeemer, authorization, value, and state
  transition rules
- Authoring positive and negative behaviour cases for an Aiken contract
- Compiling Aiken source through Kuber MCP and repairing compiler-reported source errors
- Interpreting normalized script artifacts, parameters, hashes, and validation results

## When NOT to use

- Plutus or Haskell contract authoring; use the separate Kuber Plutus workflow
- Security review of an existing contract when no implementation work is requested
- Off-chain transaction construction without on-chain contract changes
- Wallet signing, transaction submission, deployment, or mainnet-readiness assessment

## Key principles

1. **Purpose first:** Determine the ledger purpose before selecting a contract pattern.
2. **Requirements before source:** Resolve only missing decisions that change on-chain
   behaviour.
3. **Explicit invariants:** Define every allowed action and the rejected cases that protect it before implementation.
4. **Complete handlers:** Exercise security-critical conditions through full validator
   handlers, not helper functions alone.
5. **Diagnostic classification:** Repair source failures; preserve contract logic when
   infrastructure or artifact validation fails.
6. **Evidence boundaries:** Report compilation, test execution, parameterization, and
   deployability as separate facts.

## Workflow

### Step 1: Define the on-chain requirements

Establish:

- ledger purpose: `spend`, `mint`, `withdraw`, `publish`, `vote`, or `propose`;
- datum fields, mutability, and whether a datum may be absent;
- redeemer variants and who may invoke each action;
- signer requirements or other authorization evidence;
- controlled values, asset identities, and exact/minimum/maximum token quantities;
- deadlines, finite validity bounds, and inclusive or exclusive boundaries;
- continuing outputs, their identity, and permitted state transitions;
- compile-time parameters such as an `OutputReference`, credential, or policy setting.

Ask only for unresolved information that materially changes transaction acceptance. Proceed
directly when the request already determines the invariant. A request for a “token,”
“quantity,” or “NFT” is incomplete until it distinguishes minting or burning from spending
an existing asset.

Record the resulting invariant and any explicit assumptions before writing source.

### Step 2: Select the closest contract pattern

Choose by ledger purpose first, then by business rule:

| Requirement | Purpose | Reference pattern |
|---|---|---|
| Owner unlocks after a deadline | `spend` | owner plus deadline |
| Create one unique NFT from a UTxO | `mint` | one-shot NFT |
| Joint release or timed refund | `spend` | two-party escrow |
| Move a script UTxO through states | `spend` | state transition |
| Require a named token amount in an output | `spend` | token quantity |
| Settle a listed sale with a royalty | `spend` | scoped royalty |

Read the selected section in [contract patterns](references/contract-patterns.md). Consult a
second pattern only when the contract combines both invariants. Adapt the invariant and
author contract-specific source rather than copying a reference fragment unchanged.

### Step 3: Specify invariant checks and behaviour cases

For each redeemer path, define the allowed transaction shape and corresponding rejection
conditions. Apply every relevant check:

- required signer evidence;
- datum presence, decoding, and field constraints;
- permitted redeemers and rejection of unsupported actions;
- value preservation or explicit payout rules;
- finite validity bounds and exact time boundaries;
- output identity and cardinality;
- continuing datum and state-transition rules;
- exact policy ID, token name, and mint/burn or output-quantity constraints.

Author positive and negative Aiken tests for these conditions. Security-critical cases must
invoke complete validator handlers. Helper tests may supplement handler tests but do not
replace signer, datum, redeemer, consumed-reference, value, time, or output checks.

The hosted compiler does not run `aiken check`. Report tests as **authored, not executed**
unless an execution-capable tool produced test results.

### Step 4: Create the complete Aiken project

Read [Kuber hosted compilation](references/kuber-compile.md) before implementation. Create
the project in a clearly named directory within the user's DApp repository. Do not write the
contract inside this skill directory.

Include:

- `aiken.toml` at the Aiken project root;
- complete validator or minting-policy source under `validators/`;
- contract-owned helper modules under `lib/` when required;
- authored behaviour tests in source modules or a dedicated test module.

Use current Aiken v1.1 validator-handler syntax. Declare the stdlib dependency in
`aiken.toml`; Kuber resolves it server-side. Keep `lib/` for contract-owned modules rather
than vendored stdlib source.

### Step 5: Compile and repair through Kuber MCP

Call `compile_contract` with `language: "aiken"` and a project-relative source map containing
only the newly authored contract project. Include every imported contract module. Exclude
skill references, unrelated DApp files, generated output, and credentials.

Classify all diagnostics before editing:

- Source/project failures such as `missing_manifest`, `compile_failed`, parse errors, type
  errors, and diagnostics with source locations justify source repair.
- Compiler metadata, MeshJS conversion, `hash_mismatch`, credentials, hosted-service, and
  transport failures require investigation or reporting without changing the invariant.

After each source repair, verify that all allowed and rejected paths still implement the
agreed invariant. Stop after five consecutive source-repair attempts that still fail.
Preserve signer, datum, redeemer, value, time, output, minting, and quantity requirements
when resolving compiler or artifact failures.

### Step 6: Validate and hand off artifacts

Accept an unparameterized script as artifact-validated only when:

```text
script.status == "ready"
script.validation.status == "valid"
script.validation.hashMatch == true
```

The current Kuber MCP detects Aiken blueprint parameters but does not apply them. When final
values are known, bake them into the Aiken source and recompile so the compiler emits an
unparameterized script. Otherwise hand off the result explicitly as a non-deployable
`parameterized` template with its parameter schema and required external application step.
Never describe the template as ready. A successful hosted build does not establish that
authored tests ran.

Provide:

- complete project source and its repository location;
- a concise invariant with all allowed and rejected paths;
- authored behaviour cases and their actual execution status;
- complete compiler diagnostics and the source-repair attempt count;
- the complete normalized `scripts` result, including script bytes, hashes, address,
  parameters, MeshJS data, status, diagnostics, and validation metadata.

If the exact response is too large to return inline, save the complete unmodified compiler
response as JSON in the contract project and provide its path. Preserve all script bytes;
do not insert ellipses or substitute a truncated console preview. Include `nativeArtifact`
when requested; it does not replace the normalized `scripts` result.

## References

- [Contract patterns](references/contract-patterns.md) -- purpose-first invariants, Aiken
  fragments, behaviour cases, adaptation points, and limitations
- [Kuber hosted compilation](references/kuber-compile.md) -- Aiken v1.1 project structure,
  exact MCP request, diagnostics, artifact acceptance, and handoff requirements

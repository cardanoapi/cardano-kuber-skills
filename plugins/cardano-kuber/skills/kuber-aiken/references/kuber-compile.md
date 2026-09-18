# Kuber hosted compilation for Aiken v1.1

Read this reference when creating the contract project, calling `compile_contract`,
interpreting diagnostics, or handing off compiled artifacts.

## Project structure

Place a complete Aiken project inside the user's DApp repository. A typical layout is:

```text
my-dapp/
|-- package.json
|-- contracts/
|   `-- escrow/
|       |-- aiken.toml
|       |-- validators/
|       |   `-- escrow.ak
|       `-- lib/
|           `-- rules.ak        # only if the project owns this module
`-- src/
```

The directory containing `aiken.toml` is the submitted Aiken project root. File paths in the
MCP source map are relative to that root, so the example submits `aiken.toml`,
`validators/escrow.ak`, and `lib/rules.ak`.

Use this manifest, changing only the project name when appropriate:

```toml
name = "kuber/contract-project"
version = "0.0.0"
plutus = "v3"

[[dependencies]]
name = "aiken-lang/stdlib"
version = "v3.1.0"
source = "github"
```

The `name` has `namespace/project` form. The manifest key is `plutus`; `plutus_version`
is not the v1.1 project setting. Kuber resolves `aiken-lang/stdlib` v3.1.0 server-side. Keep
`lib/` for modules authored for this contract and do not vendor stdlib modules there.

Aiken module names omit the source root. For example, `validators/hello.ak` and
`lib/hello.ak` are two modules with the same name and fail with
`aiken::module::duplicate`. Imports omit `validators/` and `lib/` for the same reason.

## Current validator syntax

Use named validator blocks and the v1.1 handlers `mint`, `spend`, `withdraw`, `publish`,
`vote`, and `propose`:

```aiken
use cardano/transaction.{OutputReference, Transaction}

pub type Redeemer {
  Act
}

validator contract_project {
  spend(
    datum: Option<Int>,
    _redeemer: Redeemer,
    _own_ref: OutputReference,
    _self: Transaction,
  ) {
    expect Some(expected) = datum
    expected > 0
  }

  else(_) {
    fail
  }
}
```

Adapt a relevant, compiler-checked pattern for real transaction fields. Historical
`validator { fn spend(...) }`, `aiken/list`, and `aiken/transaction` forms do not parse in
this dialect. A spending datum is optional at the handler boundary; explicitly reject an
absent or malformed datum when the invariant requires one. Reject unsupported purposes with
`else(_) { fail }`.

## Exact `compile_contract` request

Send only source authored for the current user contract. Do not include pattern references,
bundled sample projects, generated `build/` files, unrelated DApp source, or compiler
credentials.

```json
{
  "language": "aiken",
  "files": {
    "aiken.toml": "name = \"kuber/contract-project\"\nversion = \"0.0.0\"\nplutus = \"v3\"\n\n[[dependencies]]\nname = \"aiken-lang/stdlib\"\nversion = \"v3.1.0\"\nsource = \"github\"\n",
    "validators/contract_project.ak": "<complete newly authored Aiken source>",
    "lib/rules.ak": "<complete project-owned helper source, if imported>"
  }
}
```

`files` is a project-relative path-to-source object. Include every imported project module.
The MCP host owns hosted-compiler credentials; credentials never belong in tool arguments.

## Interpret diagnostics before repair

Read every top-level and per-script diagnostic, including its `severity`, `code`, `message`,
`file`, `line`, and `column` when present.

| Diagnostic class | Response |
|---|---|
| `missing_manifest`, `compile_failed`, parse/type errors, source locations | Correct the manifest or source while preserving the invariant. |
| `no_validators` | Confirm the authored project contains a supported validator handler. |
| `unknown_plutus_version` | Report compiler metadata failure; do not rewrite valid contract logic. |
| `meshjs_validation` | Investigate conversion or encoding; do not weaken the contract. |
| `hash_mismatch` | Treat compiler and derived artifacts as inconsistent and unusable. |
| `parameters_required` | Treat this MCP result as a non-deployable template. Source-bake final values and recompile here, or use an external parameter-application flow that also validates the resulting bytes and hash. |
| `compiler_unavailable`, credentials, HTTP, timeout, or transport errors | Report infrastructure failure and retain the current invariant and source. |

Only the source/project class starts the repair counter. Re-submit after each justified source
repair, stopping after five consecutive source-repair failures. Infrastructure, metadata,
MeshJS, or hash failures do not justify edits to signer, datum, redeemer, value, time, output,
minting, or quantity checks.

## Normalize and accept artifacts

A successful response has top-level `status: "ready"` or `"partial"`, `language`,
`nativeArtifact`, `scripts`, and top-level `diagnostics`. Each normalized script may contain
`status`, `parameterized`, `parameters`, `diagnostics`, `meshjs`, and `validation` in addition
to compiler code and identity fields.

For an unparameterized script, artifact acceptance requires all of:

```text
script.status == "ready"
script.validation.status == "valid"
script.validation.hashMatch == true
```

`validation.canonicalHash` is the compiler/Kuber hash.
`validation.meshjsDerivedHash` is derived after MeshJS-compatible conversion. The address is
network-specific; Kuber currently defaults validation to test network `networkId: 0` unless
the MCP host is configured otherwise.

Top-level `partial` is not an all-clear. Preserve valid scripts and report each invalid or
parameterized script separately. `invalid` and `unavailable` do not provide a trusted
artifact. Never accept a hash left over from an earlier successful build.

The Aiken blueprint's `compiledCode` is not a TextEnvelope `cborHex`; Kuber performs the
required wrapping for the normalized MeshJS representation. Use the compiler-reported
Plutus version rather than guessing it.

## Parameterized scripts

Compile-time parameters are part of the validator declaration, for example:

```aiken
validator one_shot(unique_ref: OutputReference) {
  mint(redeemer: ByteArray, policy_id: PolicyId, self: Transaction) {
    // invariant uses unique_ref
  }
}
```

Compilation of this template can establish that the source builds, but applying a parameter
changes the script bytes, hash, policy ID, and address. A result with
`status: "parameterized"` or `parameterized: true` is non-deployable until the intended
parameters are applied and the final script again satisfies the three acceptance checks.

The current Kuber MCP reports the parameter schema but does not apply blueprint parameters or
validate an externally applied artifact. Use one of these explicit boundaries:

- When final values are known, encode them in the Aiken source and compile again; accept only
  the resulting unparameterized script that passes the three checks.
- When parameters must remain external, return the compiler result only as a template and use
  separate parameter-application tooling that independently validates the final bytes, hash,
  policy ID, and address.

## Complete handoff

Return the exact complete normalized `scripts` array by default. Preserve compiled code,
MeshJS representation, hashes, address, parameter schemas, status, diagnostics, and
validation metadata. `nativeArtifact` is separate compiler-native output and is not a
replacement for normalized scripts.

If the response is too large to reproduce exactly, save the complete untouched response as
a `.json` file inside the contract project and link it. Never shorten script bytes, insert
an ellipsis, or use a truncated terminal preview. State separately that hosted compilation
uses the build path and does not run `aiken check`; tests are authored but unexecuted unless
another execution-capable tool ran them.

## External references

- [Aiken validators](https://aiken-lang.org/language-tour/validators)
- [Aiken tests](https://aiken-lang.org/language-tour/tests)
- [Aiken standard library v3.1.0](https://aiken-lang.github.io/stdlib/v3.1.0/)

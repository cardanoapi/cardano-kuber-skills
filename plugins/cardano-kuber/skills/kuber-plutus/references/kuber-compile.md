# Kuber hosted compilation for legacy Plutus V2

Read this reference when creating `Contract.hs`, selecting legacy imports, calling
`compile_contract`, interpreting diagnostics, or handing off compiled artifacts.

## Hosted compiler contract

The hosted compiler uses GHC 8.10.7, `base` 4.14, and Plutus 1.0-era packages. It produces
a Plutus V2 TextEnvelope. Modern Plinth modules and current Haskell examples may not compile
in this environment.

The compiler installs the selected source as `app/Contract.hs` and imports:

```haskell
import Contract (validator)
```

The submitted source must therefore:

- declare `module Contract where`;
- define the final export as `validator :: Validator`;
- contain every required type, instance, helper, wrapper, and baked parameter in one file;
- use legacy imports such as `Plutus.V2.Ledger.Api`,
  `Plutus.V2.Ledger.Contexts`, and `Plutus.V1.Ledger.Interval`;
- use `PlutusTx.Prelude` for on-chain functions and operators;
- mark every source-defined function reachable from a compiled quotation `INLINABLE`.

`PlutusLedgerApi.V2` and other modern Plinth namespaces belong to a different toolchain.
Submitted helper `.hs` files are not compiled as modules.

## Complete spending-validator shape

Use this structure as the compatibility boundary, then replace the types and invariant:

```haskell
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Contract where

import PlutusTx.Prelude
import qualified PlutusTx
import Plutus.V2.Ledger.Api
  ( BuiltinData
  , ScriptContext
  , Validator
  , mkValidatorScript
  )

data Datum = Datum Integer
data Redeemer = Act

PlutusTx.unstableMakeIsData ''Datum
PlutusTx.unstableMakeIsData ''Redeemer

{-# INLINABLE mkValidator #-}
mkValidator :: Datum -> Redeemer -> ScriptContext -> Bool
mkValidator (Datum expected) Act _ = expected > 0

{-# INLINABLE wrapValidator #-}
wrapValidator :: BuiltinData -> BuiltinData -> BuiltinData -> ()
wrapValidator datum redeemer context =
  check
    (mkValidator
      (PlutusTx.unsafeFromBuiltinData datum)
      (PlutusTx.unsafeFromBuiltinData redeemer)
      (PlutusTx.unsafeFromBuiltinData context))

validator :: Validator
validator = mkValidatorScript $$(PlutusTx.compile [|| wrapValidator ||])
```

Generate data instances for every custom datum and redeemer type with
`PlutusTx.unstableMakeIsData`. The untyped wrapper must decode all three
`BuiltinData` arguments and return `()` through `check`.

## Source-baked parameters

Values fixed for a particular script instance are applied in Haskell before final
compilation:

```haskell
data Params = Params BuiltinByteString

PlutusTx.makeLift ''Params

{-# INLINABLE mkValidator #-}
mkValidator :: Params -> Datum -> Redeemer -> ScriptContext -> Bool
mkValidator (Params expected) (Datum actual) Act _ =
  actual == lengthOfByteString expected

{-# INLINABLE wrapValidatorWithParams #-}
wrapValidatorWithParams :: Params -> BuiltinData -> BuiltinData -> BuiltinData -> ()
wrapValidatorWithParams params datum redeemer context =
  check
    (mkValidator
      params
      (PlutusTx.unsafeFromBuiltinData datum)
      (PlutusTx.unsafeFromBuiltinData redeemer)
      (PlutusTx.unsafeFromBuiltinData context))

validatorFor :: Params -> Validator
validatorFor params =
  mkValidatorScript
    ($$(PlutusTx.compile [|| wrapValidatorWithParams ||])
      `PlutusTx.applyCode` PlutusTx.liftCode params)

finalParams :: Params
finalParams = Params "REPLACE_ME"

validator :: Validator
validator = validatorFor finalParams
```

The compiled function must accept `Params` as its first argument; applying `Params` to the
three-argument `wrapValidator` shown earlier is a type error. Keep every function reachable
from `wrapValidatorWithParams` `INLINABLE` as required by the Plutus compiler.

Replace all placeholders before the final compile. A placeholder-bearing source is not ready
for use even if the compiler returns a valid hash. The hosted Haskell compiler receives the
already-applied `validator`; it does not return a CIP-57 parameter schema or an Aiken-style
`parameterized` result.

For one-shot policies, replace zero transaction IDs, placeholder output indexes, token names,
credentials, currency symbols, and every other temporary constant with the intended values.
Record these source-baked values in the handoff.

## Minting-policy export

A minting policy receives redeemer and context rather than a spending datum. Check every
token name and quantity governed by `ownCurrencySymbol context`. Export the completed policy
through the compiler's required `validator :: Validator` boundary:

```haskell
{-# INLINABLE wrapPolicy #-}
wrapPolicy :: BuiltinData -> BuiltinData -> ()
wrapPolicy redeemer context =
  check
    (mkPolicy
      (PlutusTx.unsafeFromBuiltinData redeemer)
      (PlutusTx.unsafeFromBuiltinData context))

policy :: MintingPolicy
policy = mkMintingPolicyScript $$(PlutusTx.compile [|| wrapPolicy ||])

validator :: Validator
validator = Validator (unMintingPolicyScript policy)
```

When the policy has source-baked parameters, thread them through `wrapPolicy`, apply them
with `PlutusTx.applyCode` and `PlutusTx.liftCode`, and expose only the fully applied policy
as `validator`.

## Time, outputs, and continuing state

There is no trustworthy on-chain “now.” Express deadlines through the transaction validity
interval. To require the whole range at or after a deadline:

```haskell
Interval.contains (Interval.from deadline) (txInfoValidRange info)
```

For continuing state, identify the consumed script input, require the intended number of
continuing outputs, decode output datums deliberately, validate every mutable and immutable
field, and preserve the value required by the invariant. Reject missing, hashed-only,
malformed, or ambiguous continuing datums unless the contract explicitly supports them.

## Exact `compile_contract` request

The normal request submits exactly one newly authored source:

```json
{
  "language": "plutus",
  "files": {
    "Contract.hs": "module Contract where\n..."
  }
}
```

`language` must be `plutus`; omission selects Aiken. Plutus does not use `aiken.toml`, a
Cabal file, or a submitted dependency manifest.

The public schema includes optional `title`. It selects one `.hs` value when `files`
contains multiple candidates, but only that selected value is sent to the compiler. Other
entries are not helper modules and imports from them fail. Use one `Contract.hs` and omit
`title` in the normal workflow.

Send only the contract source. Exclude reference fragments, examples, unrelated DApp files,
generated output, and credentials. The MCP host owns the upstream compiler credential.

## Interpret diagnostics before repair

Read every diagnostic, including `severity`, `code`, `message`, `file`, `line`, and
`column` when present.

| Diagnostic class | Response |
|---|---|
| Parse, type, import, module, export, and source-location errors | Correct `Contract.hs` while preserving the invariant. |
| Missing or misnamed `validator` | Restore the required export and wrapper boundary. |
| Missing credentials or `credentials_unavailable` | Report MCP-host configuration failure. |
| `compiler_unavailable`, HTTP, timeout, or transport failure | Report infrastructure failure and retain the current source. |
| `unknown_plutus_version` | Report incomplete compiler metadata; do not rewrite valid logic. |
| `meshjs_validation` | Investigate conversion or encoding; do not weaken the contract. |
| `hash_mismatch` | Treat compiler and derived artifacts as inconsistent and unusable. |

Only source failures count against the repair budget. Re-submit after each justified source
repair and stop after five consecutive source-repair failures. Credential, infrastructure,
metadata, MeshJS, or hash failures do not justify changes to authorization, datum, redeemer,
value, time, output, minting, or quantity rules.

An `invalid` or `unavailable` result contains no trustworthy artifact. Do not reuse a
script, hash, or address from an earlier successful build after the current build fails.

## Artifact acceptance

A successful result contains top-level `status: "ready"`, `language: "plutus"`, a
compiler-native TextEnvelope in `nativeArtifact`, and one normalized entry in `scripts`.

Artifact readiness requires every condition:

```text
result.status == "ready"
result.language == "plutus"
scripts.length == 1
scripts[0].status == "ready"
scripts[0].plutusVersion == "v2"
scripts[0].meshjs.version == "V2"
scripts[0].validation.status == "valid"
scripts[0].validation.hashMatch == true
result.diagnostics is empty
scripts[0].diagnostics is empty
source contains no unresolved placeholder values
```

`validation.canonicalHash` is the compiler/Kuber hash.
`validation.meshjsDerivedHash` is derived from the MeshJS-compatible script. A hash match
proves artifact conversion consistency, not economic correctness, test execution, signing,
submission, deployment, or on-chain execution.

## Behaviour-case evidence

For each invariant, record at least one allowed transaction and a rejected case for every
independent authorization, time, value, datum, redeemer, minting, or state-transition rule.

Hosted `compile_contract` compiles `Contract.hs`; it does not run a Plutus evaluator,
emulator, or unit-test suite. Use one of these evidence forms:

- Without execution: “Behaviour cases were authored but not executed; hosted compilation
  does not run them.”
- With execution: name the compatible command or evaluator, list the result, and distinguish
  it from hosted compilation.

Never claim that a behaviour case passed based only on successful compilation or a hash
match.

## Complete handoff

Return the exact complete normalized `scripts[0]` object by default. Preserve compiled code,
MeshJS representation, hashes, address, status, diagnostics, and validation metadata.
`nativeArtifact` is a separate compiler-native TextEnvelope and is not a replacement for
the normalized script unless explicitly requested.

If the full response is too large to reproduce exactly, save the complete untouched compiler
response as a `.json` file beside `Contract.hs` and provide its path. Never shorten script
bytes, insert an ellipsis, use a truncated terminal preview, or describe partial output as
complete.

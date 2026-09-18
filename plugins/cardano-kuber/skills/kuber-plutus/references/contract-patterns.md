# Plutus V2 contract patterns

Use this reference after defining the on-chain requirements. Select by script purpose before
business terminology, read the closest pattern, and extract its invariant. These are focused
reference fragments, not complete deployable contracts. Author contract-specific types,
helpers, wrappers, source-baked values, and behaviour cases; do not copy a fragment unchanged
or submit this file to the compiler.

The syntax excerpts target the hosted legacy environment: GHC 8.10.7, Plutus 1.0-era
packages, and Plutus V2. They show the security-bearing logic and may omit language pragmas,
wrappers, data-instance generation, imports unrelated to the invariant, and DApp integration.

## Owner plus deadline

**Purpose:** `spend`.

**Invariant.** The owner stored in the datum must sign, and the transaction's complete
validity range must be contained in the interval beginning at the datum deadline.

**Pseudocode.**

```text
decode owner and deadline from datum
require owner signature
require transaction validity range entirely at or after deadline
reject malformed datum, redeemer, or context
```

**Minimal legacy Plutus syntax.**

```haskell
import qualified Plutus.V1.Ledger.Interval as Interval
import Plutus.V2.Ledger.Api
  ( POSIXTime
  , PubKeyHash
  , ScriptContext (scriptContextTxInfo)
  , TxInfo (txInfoValidRange)
  )
import Plutus.V2.Ledger.Contexts (txSignedBy)

data OwnerDeadline = OwnerDeadline PubKeyHash POSIXTime

{-# INLINABLE mkValidator #-}
mkValidator :: OwnerDeadline -> () -> ScriptContext -> Bool
mkValidator (OwnerDeadline owner deadline) _ context =
  let info = scriptContextTxInfo context
  in traceIfFalse "owner signature missing" (txSignedBy info owner)
      && traceIfFalse
        "deadline not reached"
        (Interval.contains (Interval.from deadline) (txInfoValidRange info))
```

**Behaviour cases.**

- Allow: the owner signs and the validity range begins at or after the deadline.
- Reject: the owner signature is absent.
- Reject: the validity range begins before the deadline.
- Reject: the lower validity bound is unbounded.
- Reject: the datum or script context cannot be decoded.

**Common vulnerability addressed.** Checking only that a deadline appears within the range,
or checking the upper bound alone, can accept a transaction that becomes valid before the
intended unlock time.

**Adaptation points.** Define the authorizing credential; choose the precise inclusive or
exclusive time rule; add redeemer branches explicitly; add payout or continuing-output rules
when authorization alone is insufficient.

**Limitations and non-goals.** This pattern does not constrain where the released value is
paid, preserve continuing state, or cause execution automatically when the deadline passes.

## Signature-threshold multisig

**Purpose:** `spend`.

**Invariant.** At least the datum threshold of distinct authorized public-key hashes must
sign, and the threshold must be positive and no greater than the authorized signer count.

**Pseudocode.**

```text
decode authorized signers and threshold
require threshold > 0
require threshold <= number of distinct authorized signers
count authorized keys that signed
require signed count >= threshold
```

**Minimal legacy Plutus syntax.**

```haskell
import Plutus.V2.Ledger.Api
  ( PubKeyHash
  , ScriptContext (scriptContextTxInfo)
  , TxInfo
  )
import Plutus.V2.Ledger.Contexts (txSignedBy)

data MultiSig = MultiSig [PubKeyHash] Integer

{-# INLINABLE allUnique #-}
allUnique :: [PubKeyHash] -> Bool
allUnique [] = True
allUnique (key : rest) = not (elem key rest) && allUnique rest

{-# INLINABLE signedCount #-}
signedCount :: TxInfo -> [PubKeyHash] -> Integer
signedCount info =
  foldr
    (\key total -> if txSignedBy info key then total + 1 else total)
    0

{-# INLINABLE mkValidator #-}
mkValidator :: MultiSig -> () -> ScriptContext -> Bool
mkValidator (MultiSig signers threshold) _ context =
  let info = scriptContextTxInfo context
  in traceIfFalse "threshold must be positive" (threshold > 0)
      && traceIfFalse "duplicate authorized signer" (allUnique signers)
      && traceIfFalse "threshold exceeds signer count" (threshold <= length signers)
      && traceIfFalse "not enough signatures" (signedCount info signers >= threshold)
```

**Behaviour cases.**

- Allow: distinct authorized signatures meet or exceed a valid threshold.
- Reject: signatures are below the threshold.
- Reject: the threshold is zero or negative.
- Reject: the threshold exceeds the authorized signer count.
- Reject: the authorized signer list contains duplicate keys.
- Reject: the datum or context cannot be decoded.

**Common vulnerability addressed.** Counting duplicate authorized entries as independent
signers, or accepting an invalid threshold, can reduce the intended authorization strength.

**Adaptation points.** Define how the unique signer list is populated and updated; combine
with time recovery only when the contract requires it.

**Limitations and non-goals.** The fragment rejects duplicate keys but does not implement
signer rotation, weighted signatures, governance, or a deadline branch.

## Two-party escrow

**Purpose:** `spend`.

**Invariant.** Cooperative release requires both depositor and beneficiary signatures.
Refund requires the depositor signature and a validity range wholly at or after the deadline.

**Pseudocode.**

```text
on Release:
  require depositor signature
  require beneficiary signature
on Refund:
  require depositor signature
  require validity range entirely at or after deadline
reject malformed datum, redeemer, or context
```

**Minimal legacy Plutus syntax.**

```haskell
import qualified Plutus.V1.Ledger.Interval as Interval
import Plutus.V2.Ledger.Api
  ( POSIXTime
  , PubKeyHash
  , ScriptContext (scriptContextTxInfo)
  , TxInfo (txInfoValidRange)
  )
import Plutus.V2.Ledger.Contexts (txSignedBy)

data EscrowDatum = EscrowDatum PubKeyHash PubKeyHash POSIXTime
data EscrowAction = Release | Refund

{-# INLINABLE mkValidator #-}
mkValidator :: EscrowDatum -> EscrowAction -> ScriptContext -> Bool
mkValidator (EscrowDatum depositor beneficiary deadline) action context =
  let info = scriptContextTxInfo context
      afterDeadline =
        Interval.contains (Interval.from deadline) (txInfoValidRange info)
  in case action of
      Release ->
        traceIfFalse "depositor signature missing" (txSignedBy info depositor)
          && traceIfFalse "beneficiary signature missing" (txSignedBy info beneficiary)
      Refund ->
        traceIfFalse "depositor signature missing" (txSignedBy info depositor)
          && traceIfFalse "refund is too early" afterDeadline
```

**Behaviour cases.**

- Allow: both parties sign `Release`.
- Allow: the depositor signs `Refund` at or after the deadline.
- Reject: either release signature is absent.
- Reject: refund is early or has an unbounded lower validity limit.
- Reject: refund lacks the depositor signature.
- Reject: datum, redeemer, or context decoding fails.

**Common vulnerability addressed.** Sharing one authorization condition across release and
refund can permit unilateral release or premature refund.

**Adaptation points.** Define release authorities; choose the exact refund boundary; add an
arbiter only with separate evidence and rejection cases; add payout rules when signatures
alone do not settle value.

**Limitations and non-goals.** This pattern controls authorization only. It does not prove
delivery, require payment to a destination, support disputes, or move funds automatically
after the deadline.

## State transition

**Purpose:** `spend`.

**Invariant.** The current owner signs, exactly one continuing output exists, its inline datum
advances the allowed state without changing immutable fields, and its full value equals the
consumed script output's value.

**Pseudocode.**

```text
require current owner signature
find the current script input
require exactly one continuing output
decode its inline datum
require owner unchanged and counter incremented by one
require continuing value equals consumed value
```

**Minimal legacy Plutus syntax.**

```haskell
import Plutus.V2.Ledger.Api
  ( Datum (Datum)
  , FromData (fromBuiltinData)
  , OutputDatum (OutputDatum)
  , PubKeyHash
  , ScriptContext (scriptContextTxInfo)
  , TxInInfo (txInInfoResolved)
  , TxOut (txOutDatum, txOutValue)
  )
import Plutus.V2.Ledger.Contexts
  ( findOwnInput
  , getContinuingOutputs
  , txSignedBy
  )

data StateDatum = StateDatum PubKeyHash Integer
data StateAction = Advance

{-# INLINABLE validNextDatum #-}
validNextDatum :: PubKeyHash -> Integer -> TxOut -> Bool
validNextDatum owner counter output =
  case txOutDatum output of
    OutputDatum (Datum raw) ->
      case fromBuiltinData raw of
        Just (StateDatum nextOwner nextCounter) ->
          nextOwner == owner && nextCounter == counter + 1
        Nothing -> False
    _ -> False

{-# INLINABLE mkValidator #-}
mkValidator :: StateDatum -> StateAction -> ScriptContext -> Bool
mkValidator (StateDatum owner counter) Advance context =
  let info = scriptContextTxInfo context
  in traceIfFalse "owner signature missing" (txSignedBy info owner)
      && case (findOwnInput context, getContinuingOutputs context) of
        (Just ownInput, [output]) ->
          traceIfFalse "invalid next datum" (validNextDatum owner counter output)
            && traceIfFalse
              "continuing value changed"
              (txOutValue output == txOutValue (txInInfoResolved ownInput))
        _ -> traceError "expected one continuing output"
```

**Behaviour cases.**

- Allow: one owner-authorized output advances one permitted state edge and preserves value.
- Reject: the owner signature is missing.
- Reject: zero or multiple continuing outputs exist.
- Reject: the next datum changes the owner or skips, repeats, or reverses the state.
- Reject: the continuing datum is missing, hashed-only, or malformed.
- Reject: the continuing output changes the protected value.

**Common vulnerability addressed.** Accepting any plausible output without enforcing identity,
cardinality, datum continuity, and value preservation can create a decoy next state while
assets leave the protocol.

**Adaptation points.** Replace the counter with explicit states and enumerate permitted
edges; define mutable and immutable fields; specify which value components may change;
define terminal transitions separately.

**Limitations and non-goals.** This pattern supports one continuing state with an inline
datum. It does not cover batching, merging, reference inputs, datum hashes, or terminal
payouts.

## One-shot NFT

**Purpose:** `mint`.

**Invariant.** The policy consumes one source-baked output reference and mints exactly one
source-baked token name under its own currency symbol. Other policies remain independent.

**Pseudocode.**

```text
require the fixed output reference is consumed
filter minted value to this policy's currency symbol
require exactly one entry
require entry token name equals fixed name
require entry quantity equals +1
```

**Minimal legacy Plutus syntax.**

```haskell
import Plutus.V1.Ledger.Value (flattenValue)
import Plutus.V2.Ledger.Api
  ( MintingPolicy
  , ScriptContext (scriptContextTxInfo)
  , TokenName
  , TxInfo (txInfoMint)
  , TxOutRef (txOutRefId, txOutRefIdx)
  )
import Plutus.V2.Ledger.Contexts (ownCurrencySymbol, spendsOutput)

{-# INLINABLE mkPolicy #-}
mkPolicy :: TxOutRef -> TokenName -> () -> ScriptContext -> Bool
mkPolicy uniqueOutput expectedName _ context =
  let info = scriptContextTxInfo context
      ownSymbol = ownCurrencySymbol context
      ownTokens =
        filter
          (\(symbol, _, _) -> symbol == ownSymbol)
          (flattenValue (txInfoMint info))
      consumesUniqueOutput =
        spendsOutput info (txOutRefId uniqueOutput) (txOutRefIdx uniqueOutput)
      mintsExactlyOne =
        case ownTokens of
          [(_, tokenName, quantity)] ->
            tokenName == expectedName && quantity == 1
          _ -> False
  in traceIfFalse "unique output not consumed" consumesUniqueOutput
      && traceIfFalse "wrong NFT mint" mintsExactlyOne
```

**Behaviour cases.**

- Allow: consume the fixed output and mint exactly one fixed-name token.
- Allow: unrelated policies mint assets in the same transaction.
- Reject: the fixed output is absent.
- Reject: quantity is zero, negative, or greater than one.
- Reject: another token name or an additional name exists under this policy.
- Reject: the minting context or redeemer cannot be decoded.

**Common vulnerability addressed.** Checking only one asset entry or total minted quantity can
permit repeated issuance, additional token names, or a burn path that was never intended.

**Adaptation points.** Replace the output reference and token name before final compilation;
define burning explicitly if permitted; add authorization or metadata constraints only when
they belong to the on-chain invariant.

**Limitations and non-goals.** The output reference and token name are source-baked. This
pattern does not select a UTxO, apply parameters after compilation, create metadata, build the
mint transaction, or control later NFT spending.

## Token quantity

**Purpose:** `spend`. Use a minting policy when the requirement controls token creation or
destruction.

**Invariant.** The transaction pays the datum beneficiary exactly the required positive
quantity of the named currency symbol and token name.

**Pseudocode.**

```text
decode beneficiary, currency symbol, token name, and quantity
require quantity > 0
sum value paid to beneficiary
require valueOf paid symbol tokenName == quantity
```

**Minimal legacy Plutus syntax.**

```haskell
import Plutus.V1.Ledger.Value (valueOf)
import Plutus.V2.Ledger.Api
  ( CurrencySymbol
  , PubKeyHash
  , ScriptContext (scriptContextTxInfo)
  , TokenName
  )
import Plutus.V2.Ledger.Contexts (valuePaidTo)

data PaymentDatum =
  PaymentDatum PubKeyHash CurrencySymbol TokenName Integer

{-# INLINABLE mkValidator #-}
mkValidator :: PaymentDatum -> () -> ScriptContext -> Bool
mkValidator (PaymentDatum beneficiary symbol tokenName quantity) _ context =
  let paid = valuePaidTo (scriptContextTxInfo context) beneficiary
  in traceIfFalse "quantity must be positive" (quantity > 0)
      && traceIfFalse
        "wrong token payment"
        (valueOf paid symbol tokenName == quantity)
```

**Behaviour cases.**

- Allow: the beneficiary receives exactly the required positive quantity.
- Reject: the beneficiary receives too little or too much.
- Reject: the currency symbol or token name differs.
- Reject: the required quantity is zero or negative.
- Reject: no output pays the beneficiary.
- Reject: datum or context decoding fails.

**Common vulnerability addressed.** Comparing only a token name, only a quantity, or one
output can accept a look-alike asset, the wrong recipient, or an incomplete aggregate
payment.

**Adaptation points.** Choose exact or minimum quantity deliberately; decide whether other
assets matter; add authorization or deadlines when payment satisfaction alone must not
authorize spending.

**Limitations and non-goals.** `valuePaidTo` aggregates outputs paid to the public-key hash.
This pattern does not mint the asset, restrict unrelated assets, or identify the source of
the paid tokens.

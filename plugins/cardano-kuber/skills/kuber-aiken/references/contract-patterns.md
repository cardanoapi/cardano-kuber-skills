# Aiken contract patterns

Use this reference after defining the on-chain requirements. Select by ledger purpose before
business terminology, read the closest pattern, and extract its invariant. These are focused
reference fragments, not complete deployable protocol templates. Author contract-specific
types, handlers, helpers, and tests; do not copy a fragment unchanged or submit this file to
the compiler.

Each syntax excerpt illustrates the security-bearing part of current Aiken v1.1 code. It may
omit test fixtures, helper constructors, imports unrelated to the invariant, and DApp
integration.

## Owner plus deadline

**Purpose:** `spend`.

**Plain language.** A script output may be spent only when the owner named in its datum signs
and the transaction proves that its validity interval begins at or after the deadline.

**Invariant pseudocode.**

```text
allow Unlock when
  datum decodes
  AND datum.owner signed
  AND lower validity bound is finite
  AND lower validity bound >= datum.deadline
reject every other purpose or malformed datum
```

**Minimal Aiken syntax.**

```aiken
use aiken/collection/list
use aiken/interval.{Finite}
use cardano/transaction.{OutputReference, Transaction}

pub type Datum {
  owner: ByteArray,
  deadline: Int,
}

pub type Redeemer {
  Unlock
}

validator owner_deadline {
  spend(
    datum: Option<Datum>,
    _redeemer: Redeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(rule) = datum
    list.has(self.extra_signatories, rule.owner) &&
      when self.validity_range.lower_bound.bound_type is {
        Finite(lower) -> lower >= rule.deadline
        _ -> False
      }
  }

  else(_) {
    fail
  }
}
```

**Behaviour cases.**

- Allow: the owner signs and the finite lower bound equals or exceeds the deadline.
- Reject: the owner signature is absent.
- Reject: the lower bound is before the deadline.
- Reject: the lower bound is unbounded, even if the upper bound is after the deadline.
- Reject: the datum is absent or cannot decode as `Datum`.

**Common vulnerability prevented.** Checking only the upper validity bound, or merely finding
a timestamp somewhere in the interval, can allow a transaction that becomes valid before
the intended unlock time.

**Adaptation points.** Choose the authorization credential; choose whether the boundary is
inclusive or exclusive; decide whether early cancellation or multiple redeemers exist; add a
payout or continuing-output rule if authorization alone is insufficient.

**Limitations and non-goals.** This fragment does not constrain where funds go after an
authorized spend, preserve state, or automate an off-chain transaction. A deadline is a
validity-range condition, not wall-clock execution.

## One-shot NFT

**Purpose:** `mint`.

**Plain language.** The policy allows exactly one token with the requested name under its own
policy only when a unique compile-time UTxO reference is consumed.

**Invariant pseudocode.**

```text
allow mint when
  unique_ref occurs among transaction inputs
  AND tokens under this policy are exactly [(requested_name, +1)]
ignore assets under unrelated policies
reject every other purpose
```

**Minimal Aiken syntax.**

```aiken
use aiken/collection/dict
use aiken/collection/list
use cardano/assets
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}

pub type Redeemer {
  token_name: ByteArray,
}

validator one_shot(unique_ref: OutputReference) {
  mint(redeemer: Redeemer, policy_id: PolicyId, self: Transaction) {
    list.any(
      self.inputs,
      fn(input) { input.output_reference == unique_ref },
    ) &&
      when dict.to_pairs(assets.tokens(self.mint, policy_id)) is {
        [Pair(name, 1)] -> name == redeemer.token_name
        _ -> False
      }
  }

  else(_) {
    fail
  }
}
```

**Behaviour cases.**

- Allow: consume the configured reference and mint exactly one requested token.
- Allow: unrelated policies mint assets in the same transaction.
- Reject: the configured reference is not consumed.
- Reject: quantity is zero, negative, or greater than one under this policy.
- Reject: another token name or an additional name is present under this policy.

**Common vulnerability prevented.** Checking only the total minted value, or rejecting all
unrelated minting, can respectively permit extra names under the policy or unnecessarily
break transaction composability.

**Adaptation points.** Decide whether the token name is fixed or comes from the redeemer;
choose the unique reference before deployment; add signer or metadata rules only when the
requirements call for them; define burn behaviour separately if burning is allowed.

**Limitations and non-goals.** This is a parameterized policy template. Its compiled hash and
policy ID are not deployable until `unique_ref` is applied and the final bytes are
revalidated. It does not select the UTxO, create CIP metadata, build the mint transaction, or
control later spending of the NFT.

## Two-party escrow

**Purpose:** `spend`.

**Plain language.** Both parties may cooperatively release funds at any time. After the
deadline, the depositor alone may refund them.

**Invariant pseudocode.**

```text
on Release:
  require depositor signature AND beneficiary signature
on Refund:
  require depositor signature
  AND finite lower validity bound >= deadline
reject malformed datum and every unsupported action or purpose
```

**Minimal Aiken syntax.**

```aiken
use aiken/collection/list
use aiken/interval.{Finite}
use cardano/transaction.{OutputReference, Transaction}

pub type Terms {
  depositor: ByteArray,
  beneficiary: ByteArray,
  deadline: Int,
}

pub type Redeemer {
  Release
  Refund
}

validator escrow {
  spend(
    datum: Option<Terms>,
    redeemer: Redeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(terms) = datum
    when redeemer is {
      Release ->
        list.has(self.extra_signatories, terms.depositor) &&
          list.has(self.extra_signatories, terms.beneficiary)
      Refund ->
        list.has(self.extra_signatories, terms.depositor) &&
          when self.validity_range.lower_bound.bound_type is {
            Finite(lower) -> lower >= terms.deadline
            _ -> False
          }
    }
  }

  else(_) {
    fail
  }
}
```

**Behaviour cases.**

- Allow: release with both depositor and beneficiary signatures.
- Allow: refund at the deadline or later with the depositor signature.
- Reject: release with either signature missing.
- Reject: refund before the deadline or with an unbounded lower validity limit.
- Reject: refund without the depositor signature.

**Common vulnerability prevented.** Reusing one authorization condition for both paths can
let either party release unilaterally or let a depositor refund before the agreed deadline.

**Adaptation points.** Define which parties authorize release; choose an inclusive or
exclusive refund boundary; add a mediator or dispute redeemer only with its own evidence and
reject cases; constrain beneficiary payouts if signatures alone do not settle value.

**Limitations and non-goals.** This is an authorization escrow, not a complete commerce
protocol. It does not prove delivery, split payments, preserve staged state, or cause funds
to move automatically when time passes.

## State transition

**Purpose:** `spend`.

**Plain language.** The current owner signs, exactly one continuing output at the same script
address carries the permitted next datum, and the protected value is preserved.

**Invariant pseudocode.**

```text
find the input currently being spent
identify outputs at that same script address
require exactly one continuing output
decode its inline datum
require authorized(current -> next)
require protected value preserved
require current owner signature
```

**Minimal Aiken syntax.**

```aiken
use aiken/collection/list
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

pub type State {
  owner: ByteArray,
  step: Int,
}

pub type Redeemer {
  Advance
}

validator state_machine {
  spend(
    datum: Option<State>,
    _redeemer: Redeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(current) = datum
    expect Some(own_input) = transaction.find_input(self.inputs, own_ref)
    let continuing =
      list.filter(
        self.outputs,
        fn(output) { output.address == own_input.output.address },
      )
    list.has(self.extra_signatories, current.owner) &&
      when continuing is {
        [next_output] -> {
          expect InlineDatum(raw_next) = next_output.datum
          expect next: State = raw_next
          next == State { owner: current.owner, step: current.step + 1 } &&
            next_output.value == own_input.output.value
        }
        _ -> False
      }
  }

  else(_) {
    fail
  }
}
```

**Behaviour cases.**

- Allow: one owner-authorized output advances exactly one permitted state edge and preserves
  the protected value.
- Reject: the signer is missing or not the current owner.
- Reject: the next datum skips or reverses a forbidden state.
- Reject: zero or multiple continuing outputs match the script address.
- Reject: the continuing datum is absent, hashed when inline is required, or malformed.
- Reject: protected value is removed or changed outside the defined transition.

**Common vulnerability prevented.** Finding any plausible output without enforcing identity
and cardinality can let an attacker create a decoy state while sending the real value
elsewhere.

**Adaptation points.** Replace the integer step with explicit states and enumerate allowed
edges; define whether ownership may change; choose the script/output identity; specify which
value components are preserved, added, or released; define terminal transitions separately.

**Limitations and non-goals.** Same-address matching may need a stronger identity rule when
several state machines share an address. This fragment does not cover batching, merging,
reference inputs, terminal payout, or off-chain state discovery.

## Token quantity

**Purpose:** usually `spend`. If the request controls token creation or destruction, use a
`mint` pattern instead.

**Plain language.** At least one identified beneficiary output must contain the named asset
under the named policy in the quantity rule chosen by the user.

**Invariant pseudocode.**

```text
find an output whose payment credential is beneficiary
require quantity_of(output.value, policy_id, token_name) == required_quantity
reject wrong beneficiary, policy, token name, or quantity
```

**Minimal Aiken syntax.**

```aiken
use aiken/collection/list
use cardano/address.{VerificationKey}
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}

pub type Rule {
  beneficiary: ByteArray,
  policy_id: ByteArray,
  token_name: ByteArray,
  quantity: Int,
}

pub type Redeemer {
  Pay
}

validator token_payment {
  spend(
    datum: Option<Rule>,
    _redeemer: Redeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(rule) = datum
    list.any(
      self.outputs,
      fn(output) {
        output.address.payment_credential == VerificationKey(rule.beneficiary) &&
          assets.quantity_of(
            output.value,
            rule.policy_id,
            rule.token_name,
          ) == rule.quantity
      },
    )
  }

  else(_) {
    fail
  }
}
```

**Behaviour cases.**

- Allow: one beneficiary output contains the exact named asset quantity.
- Reject: the payment credential is not the beneficiary.
- Reject: the policy ID or token name differs.
- Reject: the amount is below or above the exact required quantity.
- Reject: several smaller outputs when the rule requires one qualifying output.

**Common vulnerability prevented.** Comparing only a token name or only a total quantity can
accept a look-alike asset, the wrong recipient, or value distributed in a form the protocol
did not authorize.

**Adaptation points.** Deliberately choose exact, minimum, or maximum quantity; choose whether
several outputs may be summed; decide whether lovelace and other assets matter; add a signer
rule when satisfying the payout alone must not authorize the spend.

**Limitations and non-goals.** This rule validates transaction outputs and does not mint the
token. One qualifying output may contain other assets unless the adapted invariant forbids
them. It does not enforce a source for the paid tokens.

## Scoped royalty

**Purpose:** `spend`.

**Plain language.** Spending a listing UTxO as a purchase requires buyer authorization,
delivery of the listed token, and seller and royalty payments. The seller may cancel. The
rule applies only to transactions that consume this script output.

**Invariant pseudocode.**

```text
on Buy(buyer):
  require buyer signature
  AND one identified buyer output receives exactly one listed asset
  AND one identified seller output pays required seller amount
  AND one identified royalty output pays required royalty amount
on Cancel:
  require seller signature
reject malformed listing and every unsupported purpose
```

**Minimal Aiken syntax.**

```aiken
use aiken/collection/list
use cardano/address.{VerificationKey}
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}

pub type Listing {
  seller: ByteArray,
  royalty_recipient: ByteArray,
  policy_id: ByteArray,
  token_name: ByteArray,
  seller_lovelace: Int,
  royalty_lovelace: Int,
}

pub type Redeemer {
  Buy { buyer: ByteArray }
  Cancel
}

validator royalty_listing {
  spend(
    datum: Option<Listing>,
    redeemer: Redeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(listing) = datum
    when redeemer is {
      Cancel -> list.has(self.extra_signatories, listing.seller)
      Buy { buyer } ->
        list.has(self.extra_signatories, buyer) &&
          list.any(self.outputs, fn(output) {
            output.address.payment_credential ==
              VerificationKey(listing.seller) &&
              assets.lovelace_of(output.value) >= listing.seller_lovelace
          }) &&
          list.any(self.outputs, fn(output) {
            output.address.payment_credential ==
              VerificationKey(listing.royalty_recipient) &&
              assets.lovelace_of(output.value) >= listing.royalty_lovelace
          }) &&
          list.any(self.outputs, fn(output) {
            output.address.payment_credential == VerificationKey(buyer) &&
              assets.quantity_of(
                output.value,
                listing.policy_id,
                listing.token_name,
              ) == 1
          })
    }
  }

  else(_) {
    fail
  }
}
```

**Behaviour cases.**

- Allow: a buyer-signed purchase delivers the listed asset and satisfies both payments.
- Allow: seller-authorized cancellation.
- Reject: a missing buyer signature or unauthorized cancellation.
- Reject: missing or incorrect asset delivery.
- Reject: seller or royalty underpayment.
- Reject: payment to the wrong credential or in an unintended asset.

**Common vulnerability prevented.** Checking only that some outputs contain enough value can
accept payment to the wrong party, omit asset delivery, or authorize a purchase without the
buyer.

**Adaptation points.** Choose exact or minimum payments; decide whether split outputs are
summed; identify credentials and listed asset precisely; define marketplace fees or datum
updates separately; add time bounds only when the listing requires them.

**Limitations and non-goals.** A spending validator can enforce a royalty only when its
listing UTxO is consumed. It cannot enforce royalties on later off-script transfers or sales
that bypass the validator. This fragment does not establish legal rights, oracle pricing,
market discovery, or universal NFT royalty enforcement.

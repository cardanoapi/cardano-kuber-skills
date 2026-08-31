use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite, Interval, IntervalBound, NegativeInfinity}
use cardano/transaction
use cardano/transaction.{OutputReference, Transaction}

pub type Datum {
  owner: VerificationKeyHash,
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

const owner = #"00000000000000000000000000000000000000000000000000000000"

const other_signer = #"11111111111111111111111111111111111111111111111111111111"

const deadline = 1_000

fn placeholder_reference() -> OutputReference {
  OutputReference { transaction_id: "", output_index: 0 }
}

fn transaction_with_lower_bound(
  signatories: List<VerificationKeyHash>,
  lower_bound: Int,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    extra_signatories: signatories,
    validity_range: Interval {
      ..transaction.placeholder.validity_range,
      lower_bound: IntervalBound {
        bound_type: Finite(lower_bound),
        is_inclusive: True,
      },
    },
  }
}

test owner_can_unlock_at_deadline() {
  owner_deadline.spend(
    Some(Datum { owner, deadline }),
    Unlock,
    placeholder_reference(),
    transaction_with_lower_bound([owner], deadline),
  )
}

test owner_can_unlock_after_deadline() {
  owner_deadline.spend(
    Some(Datum { owner, deadline }),
    Unlock,
    placeholder_reference(),
    transaction_with_lower_bound([owner], deadline + 1),
  )
}

test rejects_missing_owner_signature() {
  !owner_deadline.spend(
    Some(Datum { owner, deadline }),
    Unlock,
    placeholder_reference(),
    transaction_with_lower_bound([other_signer], deadline),
  )
}

test rejects_lower_bound_before_deadline() {
  !owner_deadline.spend(
    Some(Datum { owner, deadline }),
    Unlock,
    placeholder_reference(),
    transaction_with_lower_bound([owner], deadline - 1),
  )
}

test rejects_unbounded_lower_bound() {
  let transaction =
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [owner],
      validity_range: Interval {
        ..transaction.placeholder.validity_range,
        lower_bound: IntervalBound {
          bound_type: NegativeInfinity,
          is_inclusive: True,
        },
      },
    }

  !owner_deadline.spend(
    Some(Datum { owner, deadline }),
    Unlock,
    placeholder_reference(),
    transaction,
  )
}

test rejects_absent_datum() fail {
  owner_deadline.spend(
    None,
    Unlock,
    placeholder_reference(),
    transaction_with_lower_bound([owner], deadline),
  )
}

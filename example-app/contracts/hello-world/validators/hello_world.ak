use cardano/transaction.{OutputReference, Transaction}

pub type Datum {
  message: ByteArray,
}

pub type Redeemer {
  SayHello
}

validator hello_world {
  spend(
    datum: Option<Datum>,
    _redeemer: Redeemer,
    _own_ref: OutputReference,
    _self: Transaction,
  ) {
    expect Some(d) = datum
    d.message == "Hello, world!"
  }

  else(_) {
    fail
  }
}

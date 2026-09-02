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

data Datum = Datum BuiltinByteString

data Redeemer = Hello

PlutusTx.unstableMakeIsData ''Datum
PlutusTx.unstableMakeIsData ''Redeemer

{-# INLINABLE mkValidator #-}
mkValidator :: Datum -> Redeemer -> ScriptContext -> Bool
mkValidator (Datum message) Hello _ = message == "Hello, world!"

{-# INLINABLE wrapValidator #-}
wrapValidator :: BuiltinData -> BuiltinData -> BuiltinData -> ()
wrapValidator datum redeemer context =
  check
    ( mkValidator
        (PlutusTx.unsafeFromBuiltinData datum)
        (PlutusTx.unsafeFromBuiltinData redeemer)
        (PlutusTx.unsafeFromBuiltinData context)
    )

validator :: Validator
validator = mkValidatorScript $$(PlutusTx.compile [|| wrapValidator ||])

/**
 * A compiled script in the shape Cardano's tooling accepts, and back again.
 *
 * An Aiken blueprint gives `compiledCode`; a TextEnvelope's `cborHex` is that same script
 * wrapped in ONE further CBOR byte string. The two are not interchangeable, and the failure
 * is silent: paste a `compiledCode` where a `cborHex` is wanted and you get a different
 * script hash, so funds go to an address whose script nobody holds.
 *
 * Verified against this deployment's own Plutus compiler rather than assumed. Its envelope
 * for a minimal always-true validator is:
 *
 *     cborHex   49 48 0100002221200101
 *               ^^ outer byte string, 9 bytes  <- the envelope adds this
 *                  ^^ inner byte string, 8 bytes  <- exactly what Aiken calls compiledCode
 *                     ^^^^^^^^^^^^^^^^ flat-encoded UPLC
 *
 * and blake2b224(0x02 || 480100002221200101) reproduces the hash that compiler reported. The
 * hash is taken over the INNER form with a version tag in front, which is why the envelope
 * type below has to be right: labelling a V3 script as V2 yields a different hash on chain.
 */

export interface TextEnvelope {
  type: string;
  description: string;
  cborHex: string;
}

/** The Plutus ledger languages a script can be written for. */
export type PlutusVersion = "v1" | "v2" | "v3";

/**
 * `plutusVersion` <-> envelope type. Deliberately a lookup with no default in either
 * direction: an unrecognised version means we do not know what to call the script, and
 * guessing produces an envelope that is wrong in the one way nothing downstream can detect.
 */
const ENVELOPE_TYPES: Record<PlutusVersion, string> = {
  v1: "PlutusScriptV1",
  v2: "PlutusScriptV2",
  v3: "PlutusScriptV3",
};

export function envelopeType(plutusVersion: string | undefined): string | null {
  if (!plutusVersion) return null;
  const key = plutusVersion.toLowerCase();
  return isPlutusVersion(key) ? ENVELOPE_TYPES[key] : null;
}

export function isPlutusVersion(value: string): value is PlutusVersion {
  return value === "v1" || value === "v2" || value === "v3";
}

/**
 * `PlutusScriptV2` -> `v2`. The Plutus compiler reports the envelope type and never the
 * version, so this is how a Haskell compile joins the same model as an Aiken one.
 */
export function plutusVersionFromEnvelopeType(type: string | undefined): PlutusVersion | null {
  if (!type) return null;
  for (const version of ["v1", "v2", "v3"] as const) {
    if (ENVELOPE_TYPES[version].toLowerCase() === type.toLowerCase()) return version;
  }
  return null;
}

/** Lower-case hex of even length, and nothing else. */
function normaliseHex(value: string): string | null {
  const hex = value.trim().toLowerCase();
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
  return hex;
}

/** CBOR byte-string header for a payload of `length` bytes, hex encoded. */
export function byteStringHeader(length: number): string {
  // Lengths under 24 ride in the header byte itself, which is why the real envelope above
  // starts `49` and not `5809`. Getting this wrong produces valid-looking hex that decodes
  // to nothing.
  if (length < 24) return (0x40 + length).toString(16).padStart(2, "0");
  if (length < 0x100) return `58${length.toString(16).padStart(2, "0")}`;
  if (length < 0x10000) return `59${length.toString(16).padStart(4, "0")}`;
  return `5a${length.toString(16).padStart(8, "0")}`;
}

/**
 * Wrap a blueprint `compiledCode` into a TextEnvelope. Returns null when the input is not
 * hex or the Plutus version is unknown, because a caller that cannot show an envelope should
 * say so rather than show a broken one.
 */
export function toTextEnvelope(
  compiledCode: string,
  plutusVersion: string | undefined,
): TextEnvelope | null {
  const type = envelopeType(plutusVersion);
  if (type === null) return null;

  const code = normaliseHex(compiledCode);
  if (code === null) return null;

  return { type, description: "", cborHex: byteStringHeader(code.length / 2) + code };
}

/**
 * The inverse: strip the envelope's outer byte string to recover `compiledCode`.
 *
 * Returns null rather than a guess whenever the round trip does not hold. That check is the
 * whole point of this function existing instead of a slice. A historical double-wrapped
 * envelope, an indefinite-length byte string (0x5f), or anything else unwraps to bytes that
 * hash to a *different script* — plausible, wrong, and invisible until funds are at an
 * address nobody can spend from. A caller that gets null should keep the compiler's own
 * `cborHex` verbatim and derive nothing from it.
 */
export function fromTextEnvelope(cborHex: string): string | null {
  const outer = normaliseHex(cborHex);
  if (outer === null) return null;

  const header = Number.parseInt(outer.slice(0, 2), 16);
  let headerBytes: number;
  let declared: number;

  if (header >= 0x40 && header <= 0x57) {
    headerBytes = 1;
    declared = header - 0x40;
  } else if (header === 0x58) {
    headerBytes = 2;
    declared = Number.parseInt(outer.slice(2, 4), 16);
  } else if (header === 0x59) {
    headerBytes = 3;
    declared = Number.parseInt(outer.slice(2, 6), 16);
  } else if (header === 0x5a) {
    headerBytes = 5;
    declared = Number.parseInt(outer.slice(2, 10), 16);
  } else {
    // 0x5f is an indefinite-length byte string, and anything else is not a byte string at
    // all. Both mean this is not the shape we know how to take apart.
    return null;
  }

  const inner = outer.slice(headerBytes * 2);
  if (inner.length / 2 !== declared) return null;

  // The round-trip assertion. Rebuilding the header from the payload we just read must
  // reproduce the input byte for byte, or we misread it.
  if (byteStringHeader(declared) + inner !== outer) return null;

  return inner;
}

/**
 * Turning a typed value into Plutus Data, CBOR, hex — the form
 * `aiken blueprint apply` takes its argument in.
 *
 * Written by hand rather than pulled from a library, and the reasoning is not "small
 * dependency good". The IDE already carries `@emurgo/cardano-serialization-lib-asmjs` as a
 * ~2MB asmjs blob that the address helper lazy-loads off the first-paint path; a second
 * serialization stack to encode an integer and a byte string fails the maintenance bar on
 * its own. The byte-string half of this is already written next door as `byteStringHeader`,
 * comment and all, because a TextEnvelope is a byte string too.
 *
 * Scope is deliberately narrow. `integer` and `bytes` cover the parameters people actually
 * write — a deadline, an owner's key hash, a token name. Constructors and lists get a stated
 * refusal and a raw-hex escape hatch rather than a half-implementation: getting a
 * constructor tag wrong yields a valid script at an address the user did not intend, which
 * is exactly the failure this whole package is organised to prevent.
 */

import { byteStringHeader } from "./textEnvelope.ts";

/** What the caller gets back: either hex to send, or a reason it cannot be produced. */
export type EncodeResult = { ok: true; hex: string } | { ok: false; error: string };

/** The CIP-57 schema shapes this understands, once `$ref`s are resolved. */
export type ParameterType = "integer" | "bytes" | "unsupported";

const MAX_UINT64 = 2n ** 64n;

/**
 * A CBOR integer, canonical minimal-length. Major type 0 for non-negative, 1 for negative,
 * where a negative n is encoded as -1 - n.
 */
export function encodeInteger(value: bigint): EncodeResult {
  const negative = value < 0n;
  const magnitude = negative ? -value - 1n : value;

  if (magnitude >= MAX_UINT64) {
    // CBOR expresses these as a tagged bignum (tag 2/3), which Plutus Data does support —
    // but emitting the wrong shape here would be silently accepted and produce a different
    // script, so refuse by name instead of guessing.
    return {
      ok: false,
      error: "Integers of 64 bits or more need a CBOR bignum, which this does not encode yet. Paste the CBOR hex directly.",
    };
  }

  const major = negative ? 0x20 : 0x00;
  let hex: string;
  if (magnitude < 24n) hex = (major + Number(magnitude)).toString(16).padStart(2, "0");
  else if (magnitude < 0x100n) hex = `${(major + 24).toString(16).padStart(2, "0")}${magnitude.toString(16).padStart(2, "0")}`;
  else if (magnitude < 0x10000n) hex = `${(major + 25).toString(16).padStart(2, "0")}${magnitude.toString(16).padStart(4, "0")}`;
  else if (magnitude < 0x100000000n) hex = `${(major + 26).toString(16).padStart(2, "0")}${magnitude.toString(16).padStart(8, "0")}`;
  else hex = `${(major + 27).toString(16).padStart(2, "0")}${magnitude.toString(16).padStart(16, "0")}`;

  return { ok: true, hex };
}

/** A CBOR byte string wrapping the given payload, which must already be hex. */
export function encodeBytes(payloadHex: string): EncodeResult {
  const hex = payloadHex.trim().toLowerCase().replace(/^0x/, "");
  if (hex.length % 2 !== 0 || (hex.length > 0 && !/^[0-9a-f]+$/.test(hex))) {
    return { ok: false, error: "Not hex: a ByteArray is an even number of hex digits." };
  }
  return { ok: true, hex: byteStringHeader(hex.length / 2) + hex };
}

/** UTF-8 text as a byte string, for the common case of a token name or a label. */
export function encodeText(text: string): EncodeResult {
  const bytes = new TextEncoder().encode(text);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return encodeBytes(hex);
}

/**
 * Resolve a parameter's schema to something this can encode.
 *
 * Schemas arrive as `{"$ref": "#/definitions/ByteArray"}` and the definition itself carries
 * `{"dataType": "bytes"}`. A schema with no `$ref` may state its `dataType` inline, so both
 * are followed.
 */
export function parameterType(
  schema: unknown,
  definitions: Record<string, unknown> | undefined,
): ParameterType {
  const resolved = resolve(schema, definitions);
  if (resolved === null || typeof resolved !== "object") return "unsupported";
  const dataType = (resolved as { dataType?: unknown }).dataType;
  if (dataType === "integer") return "integer";
  if (dataType === "bytes") return "bytes";
  return "unsupported";
}

/** The human-facing name of a parameter's type, for a form label. */
export function parameterTypeLabel(
  schema: unknown,
  definitions: Record<string, unknown> | undefined,
): string {
  const ref = refName(schema);
  if (ref) return ref;
  const type = parameterType(schema, definitions);
  return type === "unsupported" ? "Data" : type;
}

function refName(schema: unknown): string | null {
  if (schema === null || typeof schema !== "object") return null;
  const ref = (schema as { $ref?: unknown }).$ref;
  if (typeof ref !== "string") return null;
  // JSON Pointer escaping: `vault~1Datum` is `vault/Datum`.
  return ref.replace(/^#\/definitions\//, "").replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolve(schema: unknown, definitions: Record<string, unknown> | undefined): unknown {
  const name = refName(schema);
  if (name === null) return schema;
  if (!definitions) return null;
  // Definition keys keep the escaped form the `$ref` used, so try both.
  const raw = (schema as { $ref: string }).$ref.replace(/^#\/definitions\//, "");
  return definitions[raw] ?? definitions[name] ?? null;
}

/**
 * Encode one parameter from what the user typed.
 *
 * `mode` exists because a ByteArray is ambiguous by nature: `deadline` wants hex, a token
 * name wants text, and only the person filling the form knows which. Guessing from whether
 * the input happens to parse as hex would turn the token name "cafe" into four bytes.
 */
export function encodeParameter(
  schema: unknown,
  definitions: Record<string, unknown> | undefined,
  input: string,
  mode: "auto" | "hex" | "text" = "auto",
): EncodeResult {
  if (mode === "hex") return encodeBytes(input);
  if (mode === "text") return encodeText(input);

  switch (parameterType(schema, definitions)) {
    case "integer": {
      const trimmed = input.trim();
      if (!/^-?\d+$/.test(trimmed)) return { ok: false, error: "Not an integer." };
      return encodeInteger(BigInt(trimmed));
    }
    case "bytes":
      return encodeBytes(input);
    default:
      return {
        ok: false,
        error: `This parameter is a ${parameterTypeLabel(schema, definitions)}, which needs a constructor or a list. Switch the row to raw hex and paste its CBOR.`,
      };
  }
}

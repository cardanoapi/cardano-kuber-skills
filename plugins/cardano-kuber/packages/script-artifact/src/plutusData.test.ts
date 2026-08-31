import { describe, expect, it } from "vitest";

import {
  encodeBytes,
  encodeInteger,
  encodeParameter,
  encodeText,
  parameterType,
  parameterTypeLabel,
} from "./plutusData.ts";

/** The definitions map a real blueprint carries for a `ByteArray`/`Int` parameter pair. */
const DEFINITIONS = {
  ByteArray: { dataType: "bytes" },
  Int: { dataType: "integer" },
  Data: { title: "Data", description: "Any Plutus data." },
};
const BYTES_SCHEMA = { $ref: "#/definitions/ByteArray" };
const INT_SCHEMA = { $ref: "#/definitions/Int" };
const DATA_SCHEMA = { $ref: "#/definitions/Data" };

describe("encodeInteger", () => {
  it("encodes 42 as 182a, the case aiken's own --help documents", () => {
    expect(encodeInteger(42n)).toEqual({ ok: true, hex: "182a" });
  });

  it("uses the shortest form at every boundary", () => {
    expect(encodeInteger(0n)).toEqual({ ok: true, hex: "00" });
    expect(encodeInteger(23n)).toEqual({ ok: true, hex: "17" });
    expect(encodeInteger(24n)).toEqual({ ok: true, hex: "1818" });
    expect(encodeInteger(255n)).toEqual({ ok: true, hex: "18ff" });
    expect(encodeInteger(256n)).toEqual({ ok: true, hex: "190100" });
    expect(encodeInteger(65535n)).toEqual({ ok: true, hex: "19ffff" });
    expect(encodeInteger(65536n)).toEqual({ ok: true, hex: "1a00010000" });
    expect(encodeInteger(4294967296n)).toEqual({ ok: true, hex: "1b0000000100000000" });
  });

  it("encodes negatives as major type 1, which stores -1 - n", () => {
    expect(encodeInteger(-1n)).toEqual({ ok: true, hex: "20" });
    expect(encodeInteger(-24n)).toEqual({ ok: true, hex: "37" });
    expect(encodeInteger(-25n)).toEqual({ ok: true, hex: "3818" });
    expect(encodeInteger(-256n)).toEqual({ ok: true, hex: "38ff" });
  });

  it("refuses a bignum by name instead of emitting the wrong tag", () => {
    const result = encodeInteger(2n ** 64n);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/bignum/i);
  });
});

describe("encodeBytes", () => {
  it("wraps hex in a byte string header", () => {
    // "kuber" as a ByteArray is the argument used to verify `aiken blueprint apply`.
    expect(encodeBytes("6b75626572")).toEqual({ ok: true, hex: "456b75626572" });
  });

  it("accepts an empty byte string", () => {
    expect(encodeBytes("")).toEqual({ ok: true, hex: "40" });
  });

  it("tolerates a 0x prefix and mixed case", () => {
    expect(encodeBytes("0xDEADBEEF")).toEqual({ ok: true, hex: "44deadbeef" });
  });

  it("refuses an odd number of digits, which is half a byte", () => {
    expect(encodeBytes("abc").ok).toBe(false);
  });

  it("refuses non-hex", () => {
    expect(encodeBytes("hello").ok).toBe(false);
  });
});

describe("encodeText", () => {
  it("encodes text as its UTF-8 bytes", () => {
    expect(encodeText("kuber")).toEqual({ ok: true, hex: "456b75626572" });
  });

  it("counts bytes, not characters", () => {
    // Three characters, but nine bytes: the header must say 9.
    expect(encodeText("日本語")).toEqual({ ok: true, hex: "49e697a5e69cace8aa9e" });
  });
});

describe("parameterType", () => {
  it("follows a $ref into definitions", () => {
    expect(parameterType(BYTES_SCHEMA, DEFINITIONS)).toBe("bytes");
    expect(parameterType(INT_SCHEMA, DEFINITIONS)).toBe("integer");
  });

  it("reads an inline dataType", () => {
    expect(parameterType({ dataType: "integer" }, undefined)).toBe("integer");
  });

  it("calls anything else unsupported rather than assuming", () => {
    expect(parameterType(DATA_SCHEMA, DEFINITIONS)).toBe("unsupported");
    expect(parameterType({ $ref: "#/definitions/Missing" }, DEFINITIONS)).toBe("unsupported");
    expect(parameterType(undefined, DEFINITIONS)).toBe("unsupported");
  });

  it("labels by the referenced name, which is what a form should show", () => {
    expect(parameterTypeLabel(BYTES_SCHEMA, DEFINITIONS)).toBe("ByteArray");
    expect(parameterTypeLabel({ $ref: "#/definitions/vault~1Datum" }, {})).toBe("vault/Datum");
    expect(parameterTypeLabel({ dataType: "integer" }, undefined)).toBe("integer");
  });
});

describe("encodeParameter", () => {
  it("encodes by the schema's type in auto mode", () => {
    expect(encodeParameter(INT_SCHEMA, DEFINITIONS, "42")).toEqual({ ok: true, hex: "182a" });
    expect(encodeParameter(BYTES_SCHEMA, DEFINITIONS, "6b75626572")).toEqual({
      ok: true,
      hex: "456b75626572",
    });
  });

  it("never guesses whether a ByteArray input is hex or text", () => {
    // "cafe" is both a word and four hex digits. Only the person filling the form knows.
    expect(encodeParameter(BYTES_SCHEMA, DEFINITIONS, "cafe", "hex")).toEqual({
      ok: true,
      hex: "42cafe",
    });
    expect(encodeParameter(BYTES_SCHEMA, DEFINITIONS, "cafe", "text")).toEqual({
      ok: true,
      hex: "4463616665",
    });
  });

  it("refuses a non-integer for an Int", () => {
    expect(encodeParameter(INT_SCHEMA, DEFINITIONS, "1.5").ok).toBe(false);
    expect(encodeParameter(INT_SCHEMA, DEFINITIONS, "").ok).toBe(false);
  });

  it("points at the raw-hex escape hatch for a type it cannot build", () => {
    const result = encodeParameter(DATA_SCHEMA, DEFINITIONS, "anything");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/raw hex/i);
  });
});

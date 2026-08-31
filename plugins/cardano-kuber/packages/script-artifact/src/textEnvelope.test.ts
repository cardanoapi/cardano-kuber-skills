import { describe, expect, it } from "vitest";

import {
  byteStringHeader,
  envelopeType,
  fromTextEnvelope,
  plutusVersionFromEnvelopeType,
  toTextEnvelope,
} from "./textEnvelope.ts";

/**
 * The anchor for every case below. This is a real envelope from this deployment's own Plutus
 * compiler, for a minimal always-true validator, and its inner value is what Aiken would call
 * `compiledCode` for the same program. If a change breaks this pair, it has broken the one
 * fact the whole package rests on.
 */
const REAL_ENVELOPE_CBOR_HEX = "49480100002221200101";
const REAL_COMPILED_CODE = "480100002221200101";

describe("byteStringHeader", () => {
  it("puts lengths under 24 in the header byte itself", () => {
    // 0x49 is what the real compiler emitted for a 9-byte payload, not 0x5809.
    expect(byteStringHeader(9)).toBe("49");
    expect(byteStringHeader(23)).toBe("57");
  });

  it("switches to a one-byte length at 24", () => {
    expect(byteStringHeader(24)).toBe("5818");
    expect(byteStringHeader(255)).toBe("58ff");
  });

  it("switches to a two-byte length at 256", () => {
    // 262 bytes is the seeded hello-world validator, whose header really is `590106`.
    expect(byteStringHeader(256)).toBe("590100");
    expect(byteStringHeader(262)).toBe("590106");
  });

  it("switches to a four-byte length at 65536", () => {
    expect(byteStringHeader(0x10000)).toBe("5a00010000");
  });
});

describe("toTextEnvelope", () => {
  it("reproduces the compiler's own envelope byte for byte", () => {
    expect(toTextEnvelope(REAL_COMPILED_CODE, "v2")).toEqual({
      type: "PlutusScriptV2",
      description: "",
      cborHex: REAL_ENVELOPE_CBOR_HEX,
    });
  });

  it("refuses an unknown Plutus version rather than guessing one", () => {
    // Labelling a V3 script as V2 changes its hash on chain, and nothing downstream notices.
    expect(toTextEnvelope(REAL_COMPILED_CODE, "v9")).toBeNull();
    expect(toTextEnvelope(REAL_COMPILED_CODE, undefined)).toBeNull();
  });

  it("refuses input that is not hex", () => {
    expect(toTextEnvelope("not hex", "v3")).toBeNull();
    expect(toTextEnvelope("abc", "v3")).toBeNull();
    expect(toTextEnvelope("", "v3")).toBeNull();
  });
});

describe("fromTextEnvelope", () => {
  it("recovers exactly what toTextEnvelope wrapped", () => {
    expect(fromTextEnvelope(REAL_ENVELOPE_CBOR_HEX)).toBe(REAL_COMPILED_CODE);
  });

  it("round-trips at every header width", () => {
    for (const size of [1, 23, 24, 255, 256, 262, 65535, 65536]) {
      const payload = "ab".repeat(size);
      const wrapped = toTextEnvelope(payload, "v3");
      expect(wrapped).not.toBeNull();
      expect(fromTextEnvelope(wrapped!.cborHex)).toBe(payload);
    }
  });

  it("refuses a header whose declared length disagrees with the payload", () => {
    // Says 9 bytes follow, supplies 8. Slicing blindly would hand back a script that hashes
    // to something else entirely.
    expect(fromTextEnvelope("4948010000222120")).toBeNull();
  });

  it("refuses a non-minimal header", () => {
    // `5809` declares a 9-byte payload the long way. Valid CBOR, but not what any Cardano
    // tool emits, so treating it as ours would be reading a shape we do not know.
    expect(fromTextEnvelope(`5809${REAL_COMPILED_CODE}`)).toBeNull();
  });

  it("refuses an indefinite-length byte string", () => {
    expect(fromTextEnvelope("5f480100002221200101ff")).toBeNull();
  });

  it("refuses something that is not a byte string at all", () => {
    expect(fromTextEnvelope("182a")).toBeNull();
    expect(fromTextEnvelope("not hex")).toBeNull();
  });
});

describe("envelope type and Plutus version", () => {
  it("maps both ways for every known version", () => {
    for (const [version, type] of [
      ["v1", "PlutusScriptV1"],
      ["v2", "PlutusScriptV2"],
      ["v3", "PlutusScriptV3"],
    ] as const) {
      expect(envelopeType(version)).toBe(type);
      expect(plutusVersionFromEnvelopeType(type)).toBe(version);
    }
  });

  it("returns null for anything it does not recognise", () => {
    expect(envelopeType("PlutusScriptV2")).toBeNull();
    expect(plutusVersionFromEnvelopeType("v2")).toBeNull();
    expect(plutusVersionFromEnvelopeType("NativeScript")).toBeNull();
    expect(plutusVersionFromEnvelopeType(undefined)).toBeNull();
  });
});

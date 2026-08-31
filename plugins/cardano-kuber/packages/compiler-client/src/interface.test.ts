import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  type AikenNativeArtifact,
  compileAiken,
  compilePlutus,
  normalizeArtifact,
  type PlutusNativeArtifact,
} from "./interface.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const BLUEPRINT = {
  preamble: { plutusVersion: "v3" },
  validators: [
    {
      title: "hello.locked.spend",
      hash: "a".repeat(56),
      compiledCode: "5901",
      parameters: [],
    },
    {
      title: "hello.locked.else",
      hash: "a".repeat(56),
      compiledCode: "5901",
      parameters: [],
    },
  ],
};

describe("normalizeArtifact", () => {
  it("normalizes an Aiken blueprint through the shared grouping logic", () => {
    const native: AikenNativeArtifact = { kind: "aiken", blueprint: BLUEPRINT };
    const [artifact] = normalizeArtifact(native);

    assert.ok(artifact);
    assert.equal(artifact.language, "aiken");
    assert.equal(artifact.title, "hello.locked");
    assert.deepEqual(artifact.entryPoints, ["spend", "else"]);
    assert.equal(artifact.compiledCode, "5901");
  });

  it("unwraps a Plutus TextEnvelope without inventing a second wrapper", () => {
    const native: PlutusNativeArtifact = {
      kind: "plutus",
      hash: ` ${"b".repeat(56)} `,
      script: { type: "PlutusScriptV2", cborHex: "4148" },
      title: "Contract.hs",
    };
    const [artifact] = normalizeArtifact(native);

    assert.ok(artifact);
    assert.equal(artifact.hash, "b".repeat(56));
    assert.equal(artifact.plutusVersion, "v2");
    assert.equal(artifact.compiledCode, "48");
  });
});

describe("compileAiken", () => {
  it("returns the blueprint and normalized artifacts from one compiler call", async () => {
    let request: unknown;
    globalThis.fetch = (async (_input, init) => {
      request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          ok: true,
          blueprint: BLUEPRINT,
          logs: "ok",
          durationMs: 4,
          cached: false,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await compileAiken(
      { "aiken.toml": 'name = "k/x"' },
      {
        compilerUrl: "https://aiken.example/",
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(request, { files: { "aiken.toml": 'name = "k/x"' } });
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]?.hash, "a".repeat(56));
  });
});

describe("compilePlutus", () => {
  it("returns the compiler result and normalized artifact from one call", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `Building\n====BEGINSCRIPT====${JSON.stringify({
          hash: "c".repeat(56),
          script: { type: "PlutusScriptV2", cborHex: "4148" },
        })}`,
        { status: 200 },
      )) as typeof fetch;

    const result = await compilePlutus("module Contract where", "Contract.hs", {
      compilerUrl: "https://compiler.example/",
      apiKey: "test-only",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.artifact.title, "Contract.hs");
    assert.equal(result.artifact.compiledCode, "48");
    assert.equal(result.artifact.hash, "c".repeat(56));
  });
});

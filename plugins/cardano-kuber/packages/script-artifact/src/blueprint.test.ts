import { describe, expect, it } from "vitest";

import { artifactsFromBlueprint, groupValidators } from "./blueprint.ts";
import type { Blueprint, BlueprintValidator } from "./blueprint.ts";

/** Two entries of one script, which is what a single `spend` handler actually produces. */
const SPEND_AND_ELSE: BlueprintValidator[] = [
  { title: "hello.hello.spend", hash: "aaaa", compiledCode: "5901" },
  { title: "hello.hello.else", hash: "aaaa", compiledCode: "5901" },
];

describe("groupValidators", () => {
  it("collapses one validator block's entries into one script", () => {
    const [script, ...rest] = groupValidators(SPEND_AND_ELSE);
    expect(rest).toHaveLength(0);
    expect(script).toMatchObject({
      name: "hello.hello",
      moduleName: "hello",
      validatorName: "hello",
      entryPoints: ["spend", "else"],
      hash: "aaaa",
    });
  });

  it("keeps separate validator blocks separate", () => {
    // Same project, two blocks: four rows, two scripts. Grouping on compiledCode gets this
    // right with no special handling, because two entries sharing code ARE one script.
    const scripts = groupValidators([
      { title: "two.vault.spend", hash: "aaaa", compiledCode: "5901" },
      { title: "two.vault.else", hash: "aaaa", compiledCode: "5901" },
      { title: "two.policy.mint", hash: "bbbb", compiledCode: "5902" },
      { title: "two.policy.else", hash: "bbbb", compiledCode: "5902" },
    ]);
    expect(scripts.map((s) => s.name)).toEqual(["two.vault", "two.policy"]);
    expect(scripts.map((s) => s.entryPoints)).toEqual([
      ["spend", "else"],
      ["mint", "else"],
    ]);
  });

  it("splits the handler off the LAST dot, because module paths nest", () => {
    const [script] = groupValidators([
      { title: "lib/deep/mod.vault.spend", hash: "aaaa", compiledCode: "5901" },
    ]);
    expect(script).toMatchObject({
      name: "lib/deep/mod.vault",
      moduleName: "lib/deep/mod",
      validatorName: "vault",
      entryPoints: ["spend"],
    });
  });

  it("carries parameters even when only a later entry declares them", () => {
    // They are repeated on every handler of a block, but assuming the first entry has them
    // is an assumption, and this costs one comparison.
    const [script] = groupValidators([
      { title: "p.locked.spend", hash: "aaaa", compiledCode: "5901" },
      {
        title: "p.locked.else",
        hash: "aaaa",
        compiledCode: "5901",
        parameters: [{ title: "owner" }],
      },
    ]);
    expect(script?.parameters).toEqual([{ title: "owner" }]);
  });
});

describe("artifactsFromBlueprint", () => {
  const blueprint: Blueprint = {
    preamble: { plutusVersion: "v3" },
    validators: SPEND_AND_ELSE,
  };

  it("produces one artifact per script, versioned from the preamble", () => {
    const [artifact, ...rest] = artifactsFromBlueprint(blueprint);
    expect(rest).toHaveLength(0);
    expect(artifact).toMatchObject({
      hash: "aaaa",
      language: "aiken",
      plutusVersion: "v3",
      title: "hello.hello",
      entryPoints: ["spend", "else"],
      parameters: [],
    });
  });

  it("yields nothing when the Plutus version is missing or unrecognised", () => {
    // An artifact whose version we guessed produces an envelope that is wrong in the one way
    // nothing downstream detects, so refusing to build one at all is the safe answer.
    expect(artifactsFromBlueprint({ validators: SPEND_AND_ELSE })).toEqual([]);
    expect(
      artifactsFromBlueprint({ preamble: { plutusVersion: "v9" }, validators: SPEND_AND_ELSE }),
    ).toEqual([]);
  });

  it("carries only the definitions its parameters can reach", () => {
    const [artifact] = artifactsFromBlueprint({
      preamble: { plutusVersion: "v3" },
      validators: [
        {
          title: "p.locked.spend",
          hash: "aaaa",
          compiledCode: "5901",
          parameters: [{ title: "owner", schema: { $ref: "#/definitions/ByteArray" } }],
        },
      ],
      definitions: {
        ByteArray: { dataType: "bytes" },
        Unrelated: { dataType: "integer" },
      },
    });
    expect(artifact?.definitions).toEqual({ ByteArray: { dataType: "bytes" } });
  });

  it("follows $refs transitively", () => {
    const [artifact] = artifactsFromBlueprint({
      preamble: { plutusVersion: "v3" },
      validators: [
        {
          title: "p.locked.spend",
          hash: "aaaa",
          compiledCode: "5901",
          parameters: [{ title: "ref", schema: { $ref: "#/definitions/Outer" } }],
        },
      ],
      definitions: {
        Outer: { fields: [{ $ref: "#/definitions/Inner" }] },
        Inner: { dataType: "bytes" },
        Unrelated: { dataType: "integer" },
      },
    });
    expect(Object.keys(artifact?.definitions ?? {}).sort()).toEqual(["Inner", "Outer"]);
  });

  it("omits definitions entirely when there is nothing to resolve", () => {
    const [artifact] = artifactsFromBlueprint(blueprint);
    expect(artifact?.definitions).toBeUndefined();
  });
});

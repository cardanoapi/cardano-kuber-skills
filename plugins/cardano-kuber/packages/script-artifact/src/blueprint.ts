/**
 * Reading a CIP-57 Plutus blueprint into artifacts.
 *
 * The blueprint's `validators` array is the single most misread thing in this repo: it lists
 * ENTRY POINTS, not scripts. One `validator` block compiles to a single UPLC program whose
 * handlers are branches of a case on the script purpose, so a block with one `spend` handler
 * produces `<block>.spend` and `<block>.else` — two rows, one hash, one `compiledCode`.
 * Rendering the rows directly showed one contract as two, and everyone who saw it read it as
 * two contracts.
 */

import type { BlueprintParameter, ScriptArtifactPayload } from "./artifact.ts";
import { isPlutusVersion, type PlutusVersion } from "./textEnvelope.ts";

/** One entry of a blueprint's `validators` array. */
export interface BlueprintValidator {
  title: string;
  hash: string;
  /**
   * The compiled script. NOT a TextEnvelope `cborHex`: the envelope Cardano accepts wraps
   * this in one further CBOR byte string, which is what `aiken blueprint convert` does.
   */
  compiledCode: string;
  datum?: unknown;
  redeemer?: unknown;
  /**
   * Present and non-empty when the validator takes parameters. That makes `compiledCode` and
   * `hash` above a TEMPLATE: applying arguments produces different bytes, a different hash
   * and a different address, so neither can be used as-is.
   */
  parameters?: BlueprintParameter[];
}

export interface Blueprint {
  preamble?: {
    title?: string;
    version?: string;
    plutusVersion?: string;
    compiler?: { name?: string; version?: string };
  };
  validators?: BlueprintValidator[];
  definitions?: Record<string, unknown>;
}

/** One compiled script, with every blueprint entry that reaches it. */
export interface BlueprintScript {
  /** The `validator` block's qualified name, e.g. `hello.locked`. */
  name: string;
  /** The module part of that name, which `aiken blueprint apply -m` wants. */
  moduleName: string;
  /** The validator part, which `aiken blueprint apply -v` wants. */
  validatorName: string;
  /** Handlers sharing this script, in blueprint order: `['spend', 'else']`. */
  entryPoints: string[];
  hash: string;
  compiledCode: string;
  /** Non-empty when the block takes parameters, making the fields above a template. */
  parameters: BlueprintParameter[];
}

/**
 * Collapse blueprint entries into the scripts they actually describe.
 *
 * Keyed on `compiledCode` rather than on the title's block name: the code is the thing that
 * is or is not the same script, and the hash is derived from it. Two entries can never share
 * code without being the same script, so this cannot merge anything genuinely distinct —
 * which is also why separate `validator` blocks stay separate here with no special handling.
 */
export function groupValidators(validators: BlueprintValidator[]): BlueprintScript[] {
  const byCode = new Map<string, BlueprintScript>();

  for (const entry of validators) {
    // `<module>.<validator>.<handler>`, and a module path may itself contain dots (Aiken
    // modules nest), so the handler is what follows the LAST separator and the block name is
    // everything before it.
    const cut = entry.title.lastIndexOf(".");
    const name = cut === -1 ? entry.title : entry.title.slice(0, cut);
    const handler = cut === -1 ? entry.title : entry.title.slice(cut + 1);

    const existing = byCode.get(entry.compiledCode);
    if (existing) {
      existing.entryPoints.push(handler);
      // Parameters are repeated on every handler of a block; keep the first non-empty rather
      // than assuming the first entry carries them.
      if (existing.parameters.length === 0 && entry.parameters?.length) {
        existing.parameters = entry.parameters;
      }
      continue;
    }

    const split = name.lastIndexOf(".");
    byCode.set(entry.compiledCode, {
      name,
      moduleName: split === -1 ? name : name.slice(0, split),
      validatorName: split === -1 ? name : name.slice(split + 1),
      entryPoints: [handler],
      hash: entry.hash,
      compiledCode: entry.compiledCode,
      parameters: entry.parameters ?? [],
    });
  }

  return [...byCode.values()];
}

/**
 * Only the definitions a set of parameters can reach.
 *
 * A blueprint's `definitions` describes every type in the project; carrying all of it on
 * every artifact would store the same schema map once per script for no gain. Following the
 * `$ref`s transitively keeps what the apply form needs and nothing else.
 */
function reachableDefinitions(
  parameters: BlueprintParameter[],
  definitions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!definitions || parameters.length === 0) return undefined;

  const kept: Record<string, unknown> = {};
  const pending = parameters.map((p) => p.schema);

  while (pending.length > 0) {
    const node = pending.pop();
    if (node === null || typeof node !== "object") continue;

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$ref" && typeof value === "string") {
        // `#/definitions/ByteArray`, where the name itself may contain an escaped slash
        // (`vault~1Datum`) because CIP-57 uses JSON Pointer escaping.
        const name = value.replace(/^#\/definitions\//, "");
        if (name in definitions && !(name in kept)) {
          kept[name] = definitions[name];
          pending.push(definitions[name]);
        }
        continue;
      }
      if (value !== null && typeof value === "object") pending.push(value);
    }
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Turn a whole blueprint into artifacts.
 *
 * The Plutus version comes from the preamble rather than from an entry, because a blueprint
 * is compiled for exactly one ledger language and the envelope type has to match it. A
 * blueprint without a recognisable version yields nothing: an artifact whose version we
 * guessed would produce an envelope that is wrong in the one way nothing downstream detects.
 */
export function artifactsFromBlueprint(blueprint: Blueprint): ScriptArtifactPayload[] {
  const declared = blueprint.preamble?.plutusVersion?.toLowerCase();
  if (!declared || !isPlutusVersion(declared)) return [];
  const plutusVersion: PlutusVersion = declared;

  return groupValidators(blueprint.validators ?? []).map((script) => {
    const definitions = reachableDefinitions(script.parameters, blueprint.definitions);
    return {
      hash: script.hash,
      language: "aiken" as const,
      plutusVersion,
      compiledCode: script.compiledCode,
      title: script.name,
      moduleName: script.moduleName,
      validatorName: script.validatorName,
      entryPoints: script.entryPoints,
      parameters: script.parameters,
      ...(definitions ? { definitions } : {}),
    };
  });
}

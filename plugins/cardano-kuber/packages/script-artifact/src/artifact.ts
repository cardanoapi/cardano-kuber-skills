/**
 * What a compiled script is, everywhere in this repo.
 *
 * Before this existed, four shapes described one concept: the Plutus path's
 * `{hash, type, cborHex}`, the Aiken path's `{name, entryPoints, hash, compiledCode}`, the
 * compiler client's private wire type, and an inline parameter on the agent's event stream.
 * They agreed on `hash` and disagreed on everything else, including which of two encodings
 * one CBOR wrap apart the "script" field held.
 *
 * The identity decision that makes one type work: **an artifact is one compiled script,
 * identified by its hash.** Not a build, not a blueprint. A blueprint *contains* artifacts;
 * a build is the event that *produced* them. That is what lets one record cover Plutus and
 * Aiken, applied and unapplied, written by a human or by the agent — and it makes compiling
 * unchanged source idempotent instead of piling up duplicate rows.
 */

import type { PlutusVersion } from "./textEnvelope.ts";

/** Which compiler produced it. Not a file extension: an artifact outlives its source. */
export type ScriptLanguage = "aiken" | "plutus";

/**
 * One still-unapplied parameter of a parameterised validator, as CIP-57 describes it. The
 * schema is a `$ref` into the blueprint's `definitions`, which is why `definitions` travels
 * with the artifact rather than being resolved eagerly — resolving needs the whole map.
 */
export interface BlueprintParameter {
  title?: string;
  schema?: unknown;
}

/**
 * Where an artifact came from, and therefore what it is listed under.
 *
 * A discriminated union rather than a nullable `projectId`, because the two languages
 * genuinely differ: Aiken has real multi-file projects with ids, while the Haskell editor is
 * a flat per-language file list keyed on a bare filename and has no project concept at all.
 * Inventing a project id for Haskell would be a lie that the lookup surface then has to
 * maintain.
 */
export type ArtifactOrigin =
  | { kind: "aiken-project"; projectId: string }
  | { kind: "haskell-file"; fileName: string }
  | { kind: "agent"; sessionId: string; workspacePath: string }
  | { kind: "applied"; parentHash: string };

/** The arguments that turned a template into this artifact, in the order they were applied. */
export interface AppliedArgument {
  /** The parameter's blueprint title, for showing what was filled in. */
  title: string;
  /** Plutus Data, CBOR, hex — exactly what was handed to `aiken blueprint apply`. */
  cborHex: string;
  /** What the user typed, so the row can be read back without decoding CBOR. */
  display: string;
}

export interface ScriptArtifact {
  /** 56 hex characters. The primary key: a script IS its hash. */
  hash: string;
  language: ScriptLanguage;
  /**
   * Absent only when a compiler reported an envelope type we do not recognise. Everything
   * derived from it — the envelope above all — refuses in that case rather than assuming a
   * version, because labelling a V3 script as V2 changes its hash on chain and nothing
   * downstream notices.
   */
  plutusVersion?: PlutusVersion;
  /**
   * The canonical inner form — what Aiken calls `compiledCode`. Deliberately not the
   * envelope's `cborHex`: storing both would store the same script twice, one CBOR wrap
   * apart, which is the exact confusion this package exists to end. Empty only when a
   * Plutus envelope could not be unwrapped safely; see `fromTextEnvelope`.
   */
  compiledCode: string;
  /** `hello.locked` for Aiken, the source file name for Plutus. */
  title: string;
  /** Aiken only, and only so `aiken blueprint apply` can be told which validator to touch. */
  moduleName?: string;
  validatorName?: string;
  /** `['spend', 'else']`. Empty for Plutus, which has exactly one entry point and no name. */
  entryPoints: string[];
  /** Still unapplied. Non-empty means this is a template, not a deployable script. */
  parameters: BlueprintParameter[];
  /** The blueprint's schema registry, needed to resolve `parameters[].schema`'s `$ref`s. */
  definitions?: Record<string, unknown>;
  /** Present when this artifact was produced by applying arguments to another one. */
  appliedFrom?: { hash: string; arguments: AppliedArgument[] };
  /**
   * Every place this script has come from. A list because the same source compiled by hand
   * and by the agent is one script, and the starter project is exactly that case; recording
   * only the first would make the second look like it did nothing.
   */
  origins: ArtifactOrigin[];
  createdAt: number;
}

/**
 * Fields as they cross the wire from the agent. The browser adds `origins` and `createdAt`
 * on receipt, because only it knows which session's panel the event arrived in and when.
 *
 * No `address` and no `cborHex` here on purpose. The agent derives an address today with a
 * hand-rolled, testnet-only bech32 encoder and the browser then throws it away and
 * recomputes it network-aware. Sending the fields everything else is derived FROM, and
 * deriving once, is what stops those two from disagreeing.
 */
export type ScriptArtifactPayload = Omit<ScriptArtifact, "origins" | "createdAt">;

/**
 * The flat key an artifact is indexed and filtered by.
 *
 * Derived, never stored on the origin itself, so that renaming an Aiken project cannot
 * orphan its artifacts: names resolve at render time from the project list.
 */
export function ownerKey(origin: ArtifactOrigin): string {
  switch (origin.kind) {
    case "aiken-project":
      return `aiken:${origin.projectId}`;
    case "haskell-file":
      return `hs:${origin.fileName}`;
    case "agent":
      return `agent:${origin.sessionId}`;
    case "applied":
      return `applied:${origin.parentHash}`;
  }
}

/** True when the artifact still needs arguments before it describes a real on-chain script. */
export function isTemplate(artifact: Pick<ScriptArtifact, "parameters">): boolean {
  return artifact.parameters.length > 0;
}

/**
 * A minting policy id IS the script hash — the same 28 bytes, read in a different role. This
 * exists as a named function because "which field is the policy id" is a question people ask
 * of a blueprint, and answering it with a comment beats answering it in a code review.
 */
export function policyId(artifact: Pick<ScriptArtifact, "hash">): string {
  return artifact.hash;
}

/** Merge a newly seen origin into an existing list, without duplicating it. */
export function withOrigin(
  origins: ArtifactOrigin[],
  origin: ArtifactOrigin,
): ArtifactOrigin[] {
  const key = ownerKey(origin);
  return origins.some((o) => ownerKey(o) === key) ? origins : [...origins, origin];
}

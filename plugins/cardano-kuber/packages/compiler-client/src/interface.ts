/** Compiler calls and normalization shared by every MCP host. */

import type { Blueprint, ScriptArtifactPayload } from "@kuber/script-artifact";
import {
  artifactsFromBlueprint,
  fromTextEnvelope,
  plutusVersionFromEnvelopeType,
} from "@kuber/script-artifact";
import {
  type CompiledScript,
  type CompileOptions,
  type CompileResult,
  compileSource,
} from "./compile.ts";
import {
  type AikenCompileOptions,
  type AikenCompileResult,
  compileAikenProject,
} from "./compile-aiken.ts";

export { CompilerUnavailableError } from "./compile.ts";
export { AikenCompilerUnavailableError } from "./compile-aiken.ts";
export { type CompilerDiagnostic, diagnosticsFromLog } from "./diagnostics.ts";

/** The raw result of a successful Aiken compile plus normalized shared artifacts. */
export type AikenCompileOutput = Extract<AikenCompileResult, { ok: true }> & {
  artifacts: ScriptArtifactPayload[];
};

/** The raw result of a successful Plutus compile plus its normalized shared artifact. */
export type PlutusCompileOutput = Extract<CompileResult, { ok: true }> & {
  artifact: ScriptArtifactPayload;
};

export type AikenInterfaceResult = AikenCompileOutput | Extract<AikenCompileResult, { ok: false }>;
export type PlutusInterfaceResult = PlutusCompileOutput | Extract<CompileResult, { ok: false }>;

/**
 * The native compiler output needed to normalize an Aiken build.
 *
 * A blueprint is retained alongside the artifacts because it contains datum,
 * redeemer and definition schemas that callers may need for authoring or
 * parameter application.
 */
export interface AikenNativeArtifact {
  kind: "aiken";
  blueprint: Blueprint;
}

/** The native compiler output needed to normalize a Plutus build. */
export interface PlutusNativeArtifact {
  kind: "plutus";
  hash: string;
  script: CompiledScript;
  title: string;
}

/** Normalize one compiler-native result into the shared artifact payload shape. */
export function normalizeArtifact(
  native: AikenNativeArtifact | PlutusNativeArtifact,
): ScriptArtifactPayload[] {
  if (native.kind === "aiken") return artifactsFromBlueprint(native.blueprint);

  const plutusVersion = plutusVersionFromEnvelopeType(native.script.type);
  return [
    {
      hash: native.hash.trim(),
      language: "plutus",
      ...(plutusVersion ? { plutusVersion } : {}),
      // Plutus cborHex is already the full TextEnvelope. Only Aiken's inner
      // compiledCode needs the extra outer CBOR wrapper for downstream use.
      compiledCode: fromTextEnvelope(native.script.cborHex) ?? "",
      title: native.title,
      entryPoints: [],
      parameters: [],
    },
  ];
}

/** Compile an Aiken project and normalize every script represented by its blueprint. */
export async function compileAiken(
  files: Record<string, string>,
  opts: AikenCompileOptions,
): Promise<AikenInterfaceResult> {
  const result = await compileAikenProject(files, opts);
  if (!result.ok) return result;

  const native: AikenNativeArtifact = { kind: "aiken", blueprint: result.blueprint };
  return { ...result, artifacts: normalizeArtifact(native) };
}

/** Compile one Plutus source file and normalize its compiler envelope. */
export async function compilePlutus(
  source: string,
  title: string,
  opts: CompileOptions,
): Promise<PlutusInterfaceResult> {
  const result = await compileSource(source, opts);
  if (!result.ok) return result;

  const native: PlutusNativeArtifact = {
    kind: "plutus",
    hash: result.hash,
    script: result.script,
    title,
  };
  const [artifact] = normalizeArtifact(native);
  if (!artifact) throw new Error("Plutus normalization produced no artifact");
  return { ...result, artifact };
}

/**
 * Client for aiken-compiler-server.
 *
 * This protocol is plain JSON in and out, unlike the Plutus compiler's streamed log and
 * script envelope. The Aiken service needs no API key.
 *
 * The one shared idea is the important one. A failed build is information, not an
 * exception: the compiler's diagnostics are what the agent fixes its code from, so they are
 * returned rather than thrown. Only the service refusing the request is an error.
 */

import type { Blueprint, BlueprintValidator } from "@kuber/script-artifact";

/**
 * The blueprint shape lives in @kuber/script-artifact, because the browser reads the same
 * document and the two agreeing by accident was the state this replaced. Re-exported under
 * the names this module already used, so callers here read as they did.
 */
export type AikenValidator = BlueprintValidator;
export type AikenBlueprint = Blueprint;

export type AikenCompileResult =
  | { ok: true; blueprint: AikenBlueprint; logs: string; durationMs: number; cached: boolean }
  | {
      ok: false;
      logs: string;
      reason: "compile_failed" | "timeout" | "no_blueprint";
      exitCode: number | null;
    };

/** The service refused the request. Distinct from a build that ran and failed. */
export class AikenCompilerUnavailableError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AikenCompilerUnavailableError";
    this.status = status;
  }
}

export interface AikenCompileOptions {
  /** Base url of the service, no trailing slash. `/compile` is appended. */
  compilerUrl: string;
  signal?: AbortSignal;
}

export async function compileAikenProject(
  files: Record<string, string>,
  opts: AikenCompileOptions,
): Promise<AikenCompileResult> {
  let response: Response;
  try {
    response = await fetch(`${opts.compilerUrl.replace(/\/+$/, "")}/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    // Status 0 means the request never got an answer. Kept distinct from any real HTTP
    // status so the tool can say "unreachable" rather than inventing a code.
    throw new AikenCompilerUnavailableError(
      0,
      `could not reach the Aiken compiler: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: unknown) =>
        body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : null,
      )
      .catch(() => null);
    throw new AikenCompilerUnavailableError(
      response.status,
      detail ?? `Aiken compiler returned ${response.status}`,
    );
  }

  return (await response.json()) as AikenCompileResult;
}

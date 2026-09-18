/**
 * Client for the hosted Plutus compiler.
 *
 * The response is not JSON. It is a stream of build log, then the literal sentinel
 * `====BEGINSCRIPT====`, then a JSON tail. That log is what the agent reads to fix its own
 * code, so it is returned rather than thrown: a compile failure is information, not an
 * exception.
 *
 * A failed compile usually has no sentinel. However, the service can emit a script block
 * from the previous successful build after a failed load. The log is therefore the
 * authority, not the presence of a script. GHC ends a load with either
 * `Ok, N modules loaded.` or `Failed, N modules loaded.`, and the second one is a failure
 * no matter what follows it.
 */

const SENTINEL = "====BEGINSCRIPT====";

/**
 * GHC's own summary line for a load that did not succeed. Anchored to the line start so
 * the word "Failed" inside a contract's own error message cannot trip it.
 */
const GHC_FAILED = /^\s*Failed,[^\n]*module/m;

/** True when the build log says the build failed, whatever came after it. */
export function buildFailed(log: string): boolean {
  return GHC_FAILED.test(log);
}

/**
 * What to report when the compiler hands back a stale script. The script looks valid even
 * though it does not belong to the failed build.
 */
const STALE_SCRIPT_NOTE =
  "\n[The build failed, so no script was produced. The compiler answered with the last " +
  "script it built, which is not yours: ignore any hash you saw for this attempt. If the " +
  "error above is about the module name, the module must be named `Contract`.]";

/** The script envelope the compiler emits, shaped by cardano-api's serialiseToTextEnvelope. */
export interface CompiledScript {
  type: string;
  cborHex: string;
  /** Present in the envelope; the compiler leaves it empty for most scripts. */
  description?: string;
}

export type CompileResult =
  | { ok: true; hash: string; script: CompiledScript; log: string }
  | { ok: false; log: string };

/** The compiler was unreachable or refused the request. Distinct from "your code is wrong". */
export class CompilerUnavailableError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Compiler returned HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "CompilerUnavailableError";
    this.status = status;
    this.body = body;
  }
}

export interface CompileOptions {
  compilerUrl: string;
  apiKey: string;
  /** Called with each chunk of build log as it arrives, for streaming to the panel. */
  onLog?: (chunk: string) => void;
  signal?: AbortSignal;
}

export async function compileSource(code: string, opts: CompileOptions): Promise<CompileResult> {
  let res: Response;
  try {
    res = await fetch(`${opts.compilerUrl}/api/v3/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": opts.apiKey,
      },
      body: JSON.stringify({ code }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (error) {
    if (error instanceof CompilerUnavailableError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CompilerUnavailableError(0, `could not reach the Plutus compiler: ${message}`);
  }

  if (!res.ok) {
    // 401 for a bad api key, 5xx for a sick compiler. Neither is the agent's fault and
    // neither is fixable by editing the contract, so this raises instead of returning.
    throw new CompilerUnavailableError(res.status, await res.text());
  }
  if (res.body === null) {
    throw new CompilerUnavailableError(res.status, "compiler returned an empty body");
  }

  return await readCompileStream(res.body, opts.onLog);
}

/**
 * Exported for tests, which drive it with a synthetic stream rather than the network.
 *
 * The sentinel can straddle a chunk boundary, so matching is done against accumulated
 * text rather than each chunk. The JSON tail is parsed optimistically on every chunk
 * because there is no length prefix and no terminator; an incomplete parse just means
 * more is coming.
 */
export async function readCompileStream(
  body: ReadableStream<Uint8Array>,
  onLog?: (chunk: string) => void,
): Promise<CompileResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let log = "";
  let tail = "";
  let started = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      if (started) {
        tail += chunk;
      } else {
        log += chunk;
        const at = log.indexOf(SENTINEL);
        if (at === -1) {
          onLog?.(chunk);
        } else {
          // Only the text before the sentinel is log. Emit that much and keep the rest.
          const emitted = log.length - chunk.length;
          if (at > emitted) onLog?.(log.slice(emitted, at));
          started = true;
          tail = log.slice(at + SENTINEL.length);
          log = log.slice(0, at);
        }
      }

      if (started) {
        const parsed = tryParse(tail);
        // The log is complete by now: everything before the sentinel has arrived.
        if (parsed) return settle(parsed, log);
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Stream ended. Either it never reached the sentinel (compile failed, log is the
  // error) or the tail after it was truncated or malformed, which is also a failure
  // the agent should see rather than a silent success.
  if (started) {
    const parsed = tryParse(tail);
    if (parsed) return settle(parsed, log);
    return { ok: false, log: `${log}\n[compiler emitted an unparseable script block]` };
  }
  return { ok: false, log };
}

/**
 * A parsed script block plus the log it arrived with, resolved into a result. A script
 * that came back from a failed build is not this build's script, so it is dropped rather
 * than returned with a caveat: a result that says `ok` with a warning attached is a result
 * something downstream will use.
 */
function settle(parsed: { hash: string; script: CompiledScript }, log: string): CompileResult {
  if (buildFailed(log)) return { ok: false, log: log + STALE_SCRIPT_NOTE };
  return { ok: true, hash: parsed.hash, script: parsed.script, log };
}

function tryParse(text: string): { hash: string; script: CompiledScript } | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null; // incomplete JSON, keep reading
  }
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const script = obj.script as Record<string, unknown> | undefined;
  if (typeof obj.hash !== "string" || !script || typeof script.cborHex !== "string") {
    return null;
  }
  // The deployed compiler emits the hash with a leading space (" 3a888d65..." is 57
  // chars, not 56). The upstream compiler server has a commit titled
  // "Fix prefix whitespace in script hash", so this is a known
  // upstream bug and the running build predates or missed the fix. The IDE never
  // noticed because it only ever prints the value. Anything comparing hashes or
  // deriving a script address would break, so normalise here rather than leaking it.
  return {
    hash: obj.hash.trim(),
    script: {
      type: typeof script.type === "string" ? script.type.trim() : "",
      cborHex: script.cborHex.trim(),
      ...(typeof script.description === "string" ? { description: script.description } : {}),
    },
  };
}

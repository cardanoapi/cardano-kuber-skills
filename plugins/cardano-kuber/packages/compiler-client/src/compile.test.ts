import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CompileResult, readCompileStream } from "./compile.ts";

const SENTINEL = "====BEGINSCRIPT====";
const SCRIPT_JSON = JSON.stringify({
  hash: "d8e4a1",
  script: { type: "PlutusScriptV2", cborHex: "5907ab", description: "" },
});

/** Feeds the parser exactly the chunks given, so boundary handling is under test. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function assertOk(r: CompileResult): asserts r is Extract<CompileResult, { ok: true }> {
  assert.ok(r.ok, `expected success, got: ${r.ok ? "" : r.log}`);
}

describe("readCompileStream", () => {
  it("parses a successful compile", async () => {
    const r = await readCompileStream(streamOf(["Building...\n", `${SENTINEL}\n${SCRIPT_JSON}`]));
    assertOk(r);
    assert.equal(r.hash, "d8e4a1");
    assert.equal(r.script.cborHex, "5907ab");
    assert.equal(r.script.type, "PlutusScriptV2");
  });

  it("treats a stream with no sentinel as a failure whose log is the compiler error", async () => {
    const err = "app/Contract.hs:12:5: error: Variable not in scope: validator";
    const r = await readCompileStream(streamOf(["Building...\n", err]));
    assert.equal(r.ok, false);
    assert.match(r.log, /Variable not in scope/);
  });

  it("finds a sentinel split across chunk boundaries", async () => {
    // The single most likely way a naive implementation breaks in production.
    const r = await readCompileStream(streamOf(["log\n====BEGIN", "SCRIPT====", SCRIPT_JSON]));
    assertOk(r);
    assert.equal(r.hash, "d8e4a1");
  });

  it("reassembles a JSON tail split across many chunks", async () => {
    const chunks = ["log\n", SENTINEL];
    for (let i = 0; i < SCRIPT_JSON.length; i += 7) chunks.push(SCRIPT_JSON.slice(i, i + 7));
    const r = await readCompileStream(streamOf(chunks));
    assertOk(r);
    assert.equal(r.script.cborHex, "5907ab");
  });

  it("keeps the build log separate from the script block", async () => {
    const r = await readCompileStream(
      streamOf([`Compiling Contract\nLinking\n${SENTINEL}\n${SCRIPT_JSON}`]),
    );
    assertOk(r);
    assert.match(r.log, /Compiling Contract/);
    assert.ok(!r.log.includes(SENTINEL));
    assert.ok(!r.log.includes("cborHex"));
  });

  it("streams log chunks to the callback, and never the script block", async () => {
    const seen: string[] = [];
    await readCompileStream(
      streamOf(["Compiling\n", "Linking\n", `${SENTINEL}\n${SCRIPT_JSON}`]),
      (c) => seen.push(c),
    );
    const all = seen.join("");
    assert.match(all, /Compiling/);
    assert.match(all, /Linking/);
    assert.ok(!all.includes("cborHex"), "script block must not be emitted as log");
    assert.ok(!all.includes(SENTINEL), "sentinel must not be emitted as log");
  });

  it("emits the log that shares a chunk with the sentinel", async () => {
    const seen: string[] = [];
    await readCompileStream(streamOf([`tail of log\n${SENTINEL}${SCRIPT_JSON}`]), (c) =>
      seen.push(c),
    );
    assert.match(seen.join(""), /tail of log/);
  });

  it("fails rather than silently succeeding when the script block is truncated", async () => {
    const r = await readCompileStream(streamOf([`log\n${SENTINEL}{"hash":"abc","scr`]));
    assert.equal(r.ok, false);
    assert.match(r.log, /unparseable script block/);
  });

  it("fails when the script block is valid JSON but missing cborHex", async () => {
    const r = await readCompileStream(
      streamOf([`log\n${SENTINEL}${JSON.stringify({ hash: "abc", script: {} })}`]),
    );
    assert.equal(r.ok, false);
  });

  it("handles a multibyte character split across chunks", async () => {
    // The compiler quotes source in errors, and GHC uses ‘smart quotes’ in messages.
    const bytes = new TextEncoder().encode("error: ‘validator’ not in scope");
    const encoder = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 9)); // splits the multibyte quote
        controller.enqueue(bytes.slice(9));
        controller.close();
      },
    });
    const r = await readCompileStream(encoder);
    assert.equal(r.ok, false);
    assert.match(r.log, /‘validator’/);
  });

  it("strips the leading space the deployed compiler puts on the hash", async () => {
    // Not hypothetical: compiler.cardanoapi.io returns " 3a888d65..." (57 chars).
    // A padded hash breaks comparisons and script address derivation downstream.
    const padded = JSON.stringify({
      hash: " 3a888d65f16790950a72daee1f63aa05add6d268434107cfa5b67712",
      script: { type: " PlutusScriptV2 ", cborHex: " 5907ab " },
    });
    const r = await readCompileStream(streamOf([`log\n${SENTINEL}${padded}`]));
    assertOk(r);
    assert.equal(r.hash, "3a888d65f16790950a72daee1f63aa05add6d268434107cfa5b67712");
    assert.equal(r.hash.length, 56);
    assert.equal(r.script.type, "PlutusScriptV2");
    assert.equal(r.script.cborHex, "5907ab");
  });

  it("treats an empty stream as a failure", async () => {
    const r = await readCompileStream(streamOf([]));
    assert.equal(r.ok, false);
    assert.equal(r.log, "");
  });
});

/**
 * The log below is the live compiler's, trimmed: submitting a module named anything but
 * `Contract` fails the build and still emits a script block holding the previous
 * successful build's script. Verified against compiler.cardanoapi.io by compiling
 * `traceError "AAAA"` as `module Contract`, then `traceError "BBBB"` as `module Wrongname`
 * and getting the AAAA script back, hash and all.
 */
describe("a script block after a failed build", () => {
  const FAILED_LOG =
    "app/Contract.hs:6:8: error:\n" +
    "    File name does not match module name:\n" +
    "    Saw: `Secret'\n" +
    "    Expected: `Contract'\n" +
    " Failed, two modules loaded.\n ";

  it("is not this build's script, so the compile is a failure", async () => {
    const r = await readCompileStream(streamOf([FAILED_LOG, SENTINEL, SCRIPT_JSON]));
    assert.equal(r.ok, false);
  });

  it("says the hash belongs to another build, which the log does not", async () => {
    const r = await readCompileStream(streamOf([`${FAILED_LOG}${SENTINEL}${SCRIPT_JSON}`]));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.log, /File name does not match module name/);
    assert.match(r.log, /not yours/);
    assert.match(r.log, /named `Contract`/);
  });

  it("still succeeds when the build succeeded, which is the same shape minus one word", async () => {
    const okLog = "Compiling Contract\n Ok, two modules loaded.\n ";
    const r = await readCompileStream(streamOf([`${okLog}${SENTINEL}${SCRIPT_JSON}`]));
    assertOk(r);
    assert.equal(r.hash, "d8e4a1");
  });

  it("does not read a contract's own error text as a build failure", async () => {
    // `Failed` appearing inside the contract's own trace message must not count: only
    // GHC's summary line does, which is why the pattern is anchored to a line start.
    const log =
      'Compiling Contract\n  traceError "Failed, deadline not reached"\n Ok, two modules loaded.\n';
    const r = await readCompileStream(streamOf([`${log}${SENTINEL}${SCRIPT_JSON}`]));
    assertOk(r);
  });
});

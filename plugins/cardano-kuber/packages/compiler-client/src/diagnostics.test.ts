import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diagnosticsFromLog } from "./diagnostics.ts";

describe("diagnosticsFromLog", () => {
  it("extracts an Aiken source location without dropping the compiler message", () => {
    const [diagnostic] = diagnosticsFromLog(
      "  ╭─[./validators/escrow.ak:18:9]\n  ╰─ expected Bool",
      "compile_failed",
    );

    assert.equal(diagnostic?.file, "./validators/escrow.ak");
    assert.equal(diagnostic?.line, 18);
    assert.equal(diagnostic?.column, 9);
    assert.match(diagnostic?.message ?? "", /expected Bool/);
  });

  it("extracts a GHC source location", () => {
    const [diagnostic] = diagnosticsFromLog(
      "app/Contract.hs:12:5: error: Variable not in scope",
    );

    assert.equal(diagnostic?.file, "app/Contract.hs");
    assert.equal(diagnostic?.line, 12);
    assert.equal(diagnostic?.column, 5);
  });
});

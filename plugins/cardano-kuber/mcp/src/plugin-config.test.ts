import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const pluginRoot = path.resolve(import.meta.dirname, "../..");
const repositoryRoot = path.resolve(pluginRoot, "../..");

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("plugin MCP configurations", () => {
  it("keeps Claude and Codex on the same bundled entry point", () => {
    const claude = readJson(path.join(pluginRoot, ".mcp.json")) as {
      mcpServers?: { kuber?: { args?: string[] } };
    };
    const codex = readJson(
      path.join(pluginRoot, ".codex-plugin/plugin.json"),
    ) as {
      mcpServers?: { kuber?: { args?: string[]; cwd?: string } };
    };

    assert.deepEqual(claude.mcpServers?.kuber?.args, [
      "${CLAUDE_PLUGIN_ROOT}/dist/kuber-mcp.mjs",
    ]);
    assert.deepEqual(codex.mcpServers?.kuber?.args, ["./dist/kuber-mcp.mjs"]);
    assert.equal(codex.mcpServers?.kuber?.cwd, ".");
    assert.ok(existsSync(path.join(pluginRoot, "dist/kuber-mcp.mjs")));
  });

  it("points the VS Code example at the same bundle", () => {
    const config = readJson(
      path.join(repositoryRoot, "example-app/.vscode/mcp.json"),
    ) as {
      servers?: { kuber?: { args?: string[]; envFile?: string } };
    };
    assert.deepEqual(config.servers?.kuber?.args, [
      "${workspaceFolder}/../plugins/cardano-kuber/dist/kuber-mcp.mjs",
    ]);
    assert.equal(config.servers?.kuber?.envFile, "${workspaceFolder}/.env");
  });
});

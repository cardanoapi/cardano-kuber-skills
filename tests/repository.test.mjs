import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(root, "plugins/cardano-kuber");
const temporaryDirectories = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory)) {
    if (entry === ".git" || entry === "node_modules") continue;
    const absolute = path.join(directory, entry);
    if ((await stat(absolute)).isDirectory()) result.push(...(await filesBelow(absolute)));
    else result.push(absolute);
  }
  return result;
}

async function repositoryFiles() {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((file) => path.join(root, file));
}

function readLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      stream.off("data", onData);
      resolve(buffer.slice(0, newline));
    };
    stream.on("data", onData);
    stream.once("error", reject);
  });
}

describe("repository packaging", () => {
  it("declares matching Claude and Codex marketplace entries", async () => {
    const claude = await json(".claude-plugin/marketplace.json");
    const codex = await json(".agents/plugins/marketplace.json");

    assert.equal(claude.name, "cardano-kuber-skills");
    assert.equal(codex.name, "cardano-kuber-skills");
    assert.equal(claude.plugins[0].source, "./plugins/cardano-kuber");
    assert.equal(codex.plugins[0].source.path, "./plugins/cardano-kuber");
    assert.equal(codex.plugins[0].policy.installation, "AVAILABLE");
    assert.equal(codex.plugins[0].policy.authentication, "ON_INSTALL");
  });

  it("keeps both plugin manifests and their declared components inside the payload", async () => {
    const codex = await json("plugins/cardano-kuber/.codex-plugin/plugin.json");
    const claude = await json("plugins/cardano-kuber/.claude-plugin/plugin.json");

    assert.equal(codex.name, "cardano-kuber");
    assert.equal(claude.name, "cardano-kuber");
    assert.equal(codex.version, claude.version);
    assert.equal(codex.license, "Apache-2.0");
    assert.equal(codex.skills, "./skills/");
    assert.deepEqual(codex.mcpServers.kuber.args, ["./dist/kuber-mcp.mjs"]);
    assert.equal(codex.mcpServers.kuber.cwd, ".");
  });

  it("resolves every local Markdown link in both skills", async () => {
    for (const skillName of ["kuber-aiken", "kuber-plutus"]) {
      const skillDirectory = path.join(pluginRoot, "skills", skillName);
      const markdownFiles = (await filesBelow(skillDirectory)).filter((file) =>
        file.endsWith(".md"),
      );
      assert.ok(markdownFiles.some((file) => file.endsWith("SKILL.md")));

      for (const file of markdownFiles) {
        const contents = await readFile(file, "utf8");
        if (file.endsWith("SKILL.md")) {
          assert.match(contents, /^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/);
        }
        for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
          const target = match[1];
          if (!target || /^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
          const localPath = path.resolve(path.dirname(file), target.split("#", 1)[0]);
          await stat(localPath);
        }
      }
    }
  });

  it("contains no embedded credential or old workspace path", async () => {
    for (const file of await repositoryFiles()) {
      const contents = await readFile(file);
      if (contents.includes(0)) continue;
      const text = contents.toString("utf8");
      assert.doesNotMatch(text, /\/home\/prabin\/nothome\/kuber-ide/);
      assert.doesNotMatch(text, /^KUBERIDE_API_KEY[ \t]*=[ \t]*\S+/m);
    }
  });

  it("starts the committed bundle from a clean directory", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "cardano-kuber-bundle-"));
    temporaryDirectories.push(directory);
    const bundle = await readFile(path.join(pluginRoot, "dist/kuber-mcp.mjs"));
    const cleanBundle = path.join(directory, "kuber-mcp.mjs");
    await writeFile(cleanBundle, bundle);

    const child = spawn(process.execPath, [cleanBundle], {
      cwd: directory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      const exited = new Promise((_, reject) => {
        child.once("exit", (code) =>
          reject(new Error(`bundle exited before initialization (${code}): ${stderr}`)),
        );
      });
      const timedOut = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`bundle initialization timed out: ${stderr}`)), 5000);
      });
      const response = Promise.race([readLine(child.stdout), exited, timedOut]);
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "clean-copy-test", version: "0" },
          },
        })}\n`,
      );
      const initialized = JSON.parse(await response);
      assert.equal(initialized.result?.serverInfo?.name, "kuber-mcp");
    } finally {
      child.kill();
    }
  });
});

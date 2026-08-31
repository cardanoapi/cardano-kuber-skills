import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import path from "node:path";
import { after, describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
let compiler: ReturnType<typeof createServer> | undefined;

async function closeCompiler(): Promise<void> {
	if (!compiler) return;
	await new Promise<void>((resolve) => compiler?.close(() => resolve()));
	compiler = undefined;
}

after(closeCompiler);

function readLine(stream: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const onData = (chunk: Buffer | string) => {
			buffer += chunk.toString();
			const newline = buffer.indexOf("\n");
			if (newline === -1) return;
			stream.off("data", onData);
			resolve(buffer.slice(0, newline));
		};
		stream.on("data", onData);
		stream.once("error", reject);
	});
}

async function startCompiler(responseBody: object): Promise<number> {
	await closeCompiler();
	compiler = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(responseBody));
	});
	compiler.listen(0, "127.0.0.1");
	await once(compiler, "listening");
	const address = compiler.address();
	assert(address && typeof address !== "string");
	return address.port;
}

async function callTool(
	port: number,
	files: Record<string, string>,
): Promise<Record<string, unknown>> {
	const child = spawn(process.execPath, ["src/main.ts"], {
		cwd: root,
		env: { ...process.env, AIKEN_COMPILER_URL: `http://127.0.0.1:${port}` },
		stdio: ["pipe", "pipe", "pipe"],
	});

	const send = (message: object) =>
		child.stdin.write(`${JSON.stringify(message)}\n`);
	send({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "test", version: "0" },
		},
	});
	const initialized = JSON.parse(await readLine(child.stdout)) as {
		result?: unknown;
	};
	assert(initialized.result);
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
	const tools = JSON.parse(await readLine(child.stdout)) as {
		result?: { tools?: { name: string }[] };
	};
	assert.deepEqual(
		tools.result?.tools?.map((tool) => tool.name),
		["compile_contract"],
	);
	send({
		jsonrpc: "2.0",
		id: 3,
		method: "tools/call",
		params: { name: "compile_contract", arguments: { files } },
	});
	const response = JSON.parse(await readLine(child.stdout)) as {
		result?: { structuredContent?: Record<string, unknown>; isError?: boolean };
	};
	child.kill();
	return response.result ?? {};
}

describe("stdio MCP transport", () => {
	it("exposes compile_contract and returns a real success result", async () => {
		const port = await startCompiler({
			ok: true,
			blueprint: {
				preamble: { plutusVersion: "v3" },
				validators: [
					{
						title: "hello.locked.spend",
						hash: "6269e5320a9e122cc85f763479ece634d1a50b3862d529b668ce648b",
						compiledCode: "5901",
					},
				],
			},
			logs: "ok",
			durationMs: 1,
			cached: false,
		});
		const result = await callTool(port, { "aiken.toml": 'name = "k/hello"' });
		assert.equal(result.isError, undefined);
		assert.equal(
			(result.structuredContent as { status?: string } | undefined)?.status,
			"ready",
		);
	});

	it("returns no artifact fields when the compiler reports failure", async () => {
		const port = await startCompiler({
			ok: false,
			reason: "compile_failed",
			logs: "bad source",
		});
		const result = await callTool(port, { "aiken.toml": 'name = "k/bad"' });
		assert.equal(result.isError, true);
		const content = result.structuredContent as
			| Record<string, unknown>
			| undefined;
		assert.equal(content?.status, "invalid");
		assert.equal("nativeArtifact" in (content ?? Object.create(null)), false);
		assert.equal("scripts" in (content ?? Object.create(null)), false);
	});
});

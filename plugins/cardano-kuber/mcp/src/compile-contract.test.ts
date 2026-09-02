import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { compileContract } from "./compile-contract.ts";

const realFetch = globalThis.fetch;
const HASH_5901 = "6269e5320a9e122cc85f763479ece634d1a50b3862d529b668ce648b";
const HASH_5902 = "070437b086dee7c2fac25fc120b139921aa05008609b061dfe448b0e";
const PLUTUS_V2_HASH =
	"3a888d65f16790950a72daee1f63aa05add6d268434107cfa5b67712";

afterEach(() => {
	globalThis.fetch = realFetch;
});

const BLUEPRINT = {
	preamble: { plutusVersion: "v3" },
	validators: [
		{ title: "hello.locked.spend", hash: HASH_5901, compiledCode: "5901" },
		{ title: "hello.locked.else", hash: HASH_5901, compiledCode: "5901" },
	],
};

function aikenResponse(body: object): Response {
	return new Response(JSON.stringify(body), { status: 200 });
}

describe("compileContract", () => {
	it("returns one native blueprint, MeshJS output, and one normalized script", async () => {
		globalThis.fetch = (async () =>
			aikenResponse({
				ok: true,
				blueprint: BLUEPRINT,
				logs: "ok",
			})) as typeof fetch;

		const result = await compileContract(
			{ files: { "aiken.toml": 'name = "k/hello"' } },
			{ compilerUrl: "https://aiken.example" },
		);

		assert.equal(result.status, "ready");
		if (result.status !== "ready") return;
		assert.deepEqual(result.nativeArtifact, BLUEPRINT);
		assert.equal(result.scripts.length, 1);
		assert.equal(result.scripts[0]?.title, "hello.locked");
		assert.equal(result.scripts[0]?.status, "ready");
		assert.equal(result.scripts[0]?.meshjs?.code, "425901");
		assert.equal(result.scripts[0]?.validation?.hashMatch, true);
		assert.deepEqual(result.diagnostics, []);
	});

	it("returns structured diagnostics only for a failed compile", async () => {
		globalThis.fetch = (async () =>
			aikenResponse({
				ok: false,
				reason: "compile_failed",
				logs: "  ╭─[./validators/hello.ak:4:7]\n  ╰─ expected Bool",
			})) as typeof fetch;

		const result = await compileContract(
			{ files: { "aiken.toml": 'name = "k/broken"' } },
			{ compilerUrl: "https://aiken.example" },
		);

		assert.equal(result.status, "invalid");
		assert.deepEqual(result.diagnostics, [
			{
				message: "╭─[./validators/hello.ak:4:7]\n  ╰─ expected Bool",
				severity: "error",
				file: "./validators/hello.ak",
				line: 4,
				column: 7,
				code: "compile_failed",
			},
		]);
		assert.equal("nativeArtifact" in result, false);
		assert.equal("scripts" in result, false);
	});

	it("keeps a good script when another script has a hash mismatch", async () => {
		const multiple = {
			...BLUEPRINT,
			validators: [
				...BLUEPRINT.validators,
				{
					title: "other.policy.mint",
					hash: "b".repeat(56),
					compiledCode: "5902",
				},
			],
		};
		globalThis.fetch = (async () =>
			aikenResponse({
				ok: true,
				blueprint: multiple,
				logs: "ok",
			})) as typeof fetch;

		const result = await compileContract(
			{ files: { "aiken.toml": 'name = "k/multiple"' } },
			{ compilerUrl: "https://aiken.example" },
		);

		assert.equal(result.status, "partial");
		if (result.status !== "partial") return;
		assert.equal(result.scripts.length, 2);
		assert.equal(result.scripts[0]?.status, "ready");
		assert.equal(result.scripts[1]?.status, "invalid");
		assert.equal(result.scripts[1]?.diagnostics[0]?.code, "hash_mismatch");
		assert.equal(result.scripts[1]?.validation?.meshjsDerivedHash, HASH_5902);
		assert.equal(result.scripts[1]?.validation?.canonicalHash, "b".repeat(56));
	});

	it("marks parameterized scripts without pretending they are deployable", async () => {
		globalThis.fetch = (async () =>
			aikenResponse({
				ok: true,
				blueprint: {
					preamble: { plutusVersion: "v3" },
					validators: [
						{
							title: "hello.locked.spend",
							hash: HASH_5901,
							compiledCode: "5901",
							parameters: [{ title: "owner", schema: {} }],
						},
					],
				},
				logs: "ok",
			})) as typeof fetch;

		const result = await compileContract(
			{ files: { "aiken.toml": 'name = "k/parameterized"' } },
			{ compilerUrl: "https://aiken.example" },
		);

		assert.equal(result.status, "partial");
		if (result.status !== "partial") return;
		assert.equal(result.scripts[0]?.status, "parameterized");
		assert.equal(result.scripts[0]?.parameterized, true);
		assert.equal(result.scripts[0]?.meshjs, undefined);
		assert.equal(
			result.scripts[0]?.diagnostics[0]?.code,
			"parameters_required",
		);
	});

	it("compiles a Plutus TextEnvelope and validates it through MeshJS", async () => {
		globalThis.fetch = (async () =>
			new Response(
				`Building\nOk, 1 modules loaded.\n====BEGINSCRIPT====${JSON.stringify({
					hash: PLUTUS_V2_HASH,
					script: { type: "PlutusScriptV2", cborHex: "49480100002221200101" },
				})}`,
				{ status: 200 },
			)) as typeof fetch;

		const result = await compileContract(
			{ language: "plutus", files: { "Contract.hs": "module Contract where" } },
			{
				compilerUrl: "https://aiken.example",
				plutusCompilerUrl: "https://compiler.example",
				plutusApiKey: "test-only",
			},
		);

		assert.equal(result.status, "ready");
		if (result.status !== "ready") return;
		assert.equal(result.language, "plutus");
		assert.equal(result.scripts[0]?.language, "plutus");
		assert.equal(result.scripts[0]?.meshjs?.code, "49480100002221200101");
		assert.equal(result.scripts[0]?.validation?.hashMatch, true);
	});

	it("parses Plutus compiler locations into structured diagnostics", async () => {
		globalThis.fetch = (async () =>
			new Response("app/Contract.hs:12:5: error: Variable not in scope", {
				status: 200,
			})) as typeof fetch;

		const result = await compileContract(
			{ language: "plutus", files: { "Contract.hs": "module Contract where" } },
			{
				compilerUrl: "https://aiken.example",
				plutusCompilerUrl: "https://compiler.example",
				plutusApiKey: "test-only",
			},
		);

		assert.equal(result.status, "invalid");
		assert.equal(result.diagnostics[0]?.file, "app/Contract.hs");
		assert.equal(result.diagnostics[0]?.line, 12);
		assert.equal(result.diagnostics[0]?.column, 5);
	});

	it("reports a host configuration error before calling the Plutus compiler", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return new Response("unexpected call");
		}) as typeof fetch;

		const result = await compileContract(
			{ language: "plutus", files: { "Contract.hs": "module Contract where" } },
			{
				compilerUrl: "https://aiken.example",
				plutusCompilerUrl: "https://compiler.example",
			},
		);

		assert.equal(calls, 0);
		assert.equal(result.status, "unavailable");
		assert.equal(result.diagnostics[0]?.code, "credentials_unavailable");
	});

	it("reports a missing Aiken compiler URL without making a request", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return aikenResponse({});
		}) as typeof fetch;

		const result = await compileContract(
			{ files: { "aiken.toml": 'name = "k/hello"' } },
			{},
		);

		assert.equal(calls, 0);
		assert.equal(result.status, "unavailable");
		assert.equal(result.diagnostics[0]?.code, "compiler_url_unavailable");
	});

	it("reports a missing Plutus compiler URL without making a request", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return new Response("unexpected call");
		}) as typeof fetch;

		const result = await compileContract(
			{ language: "plutus", files: { "Contract.hs": "module Contract where" } },
			{ plutusApiKey: "test-only" },
		);

		assert.equal(calls, 0);
		assert.equal(result.status, "unavailable");
		assert.equal(result.diagnostics[0]?.code, "compiler_url_unavailable");
	});

	it("rejects a project without aiken.toml without calling the compiler", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return aikenResponse({});
		}) as typeof fetch;

		const result = await compileContract(
			{ files: { "validators/hello.ak": "validator hello {}" } },
			{ compilerUrl: "https://aiken.example" },
		);

		assert.equal(calls, 0);
		assert.equal(result.status, "invalid");
		assert.equal(result.diagnostics[0]?.code, "missing_manifest");
	});
});

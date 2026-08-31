import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	type CompileContractResult,
	compileContract,
} from "./compile-contract.ts";

export interface KuberMcpOptions {
	compilerUrl?: string;
	plutusCompilerUrl?: string;
	plutusApiKey?: string;
	networkId?: number;
}

const DEFAULT_COMPILER_URL = "https://kuberide.sireto.dev/aiken";
const DEFAULT_PLUTUS_COMPILER_URL = "https://compiler.cardanoapi.io";

/** Create the compiler MCP server. No transport is selected here. */
export function createKuberMcpServer(options: KuberMcpOptions = {}): McpServer {
	const compilerUrl = (
		options.compilerUrl ??
		process.env.AIKEN_COMPILER_URL ??
		DEFAULT_COMPILER_URL
	).replace(/\/+$/, "");
	const plutusCompilerUrl = (
		options.plutusCompilerUrl ??
		process.env.COMPILER_URL ??
		DEFAULT_PLUTUS_COMPILER_URL
	).replace(/\/+$/, "");
	const plutusApiKey =
		options.plutusApiKey ?? process.env.KUBERIDE_API_KEY ?? "";
	const networkId =
		options.networkId ?? Number(process.env.MESH_NETWORK_ID ?? "0");
	const server = new McpServer({ name: "kuber-mcp", version: "0.0.0" });

	server.registerTool(
		"compile_contract",
		{
			title: "Compile contract",
			description:
				"Compile an Aiken project or one Plutus/Haskell source and return native output, " +
				"normalized artifacts, MeshJS conversion, hash/address validation, and diagnostics.",
			inputSchema: {
				language: z
					.enum(["aiken", "plutus"])
					.optional()
					.default("aiken")
					.describe(
						"Compiler path; defaults to Aiken for backwards compatibility",
					),
				files: z
					.record(z.string())
					.describe("Project-relative file paths mapped to source contents"),
				title: z
					.string()
					.optional()
					.describe(
						"Plutus source file to compile when files contains multiple .hs files",
					),
			},
		},
		async ({ language, files, title }): Promise<CallToolResult> => {
			const result = await compileContract(
				{ language, files, ...(title ? { title } : {}) },
				{ compilerUrl, plutusCompilerUrl, plutusApiKey, networkId },
			);
			return mcpResult(result);
		},
	);

	return server;
}

export function mcpResult(result: CompileContractResult): CallToolResult {
	return {
		...(result.status === "invalid" || result.status === "unavailable"
			? { isError: true }
			: {}),
		// structuredContent is the machine-readable result. The text copy keeps the
		// response usable in MCP clients that only render content blocks.
		content: [{ type: "text", text: JSON.stringify(result) }],
		structuredContent: result as unknown as Record<string, unknown>,
	};
}

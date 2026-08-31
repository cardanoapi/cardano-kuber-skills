import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createKuberMcpServer } from "./server.ts";

describe("compile_contract live input schema", () => {
	it("publishes the path-to-source object shape used by the skill", async () => {
		const server = createKuberMcpServer({
			compilerUrl: "https://aiken.example",
		});
		const client = new Client({ name: "schema-test", version: "1" });
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);

		try {
			const listed = await client.listTools();
			const tool = listed.tools.find(
				(candidate) => candidate.name === "compile_contract",
			);
			assert.ok(tool);
			const schema = tool.inputSchema as {
				properties?: Record<string, unknown>;
				required?: string[];
			};
			const files = schema.properties?.files as {
				type?: string;
				additionalProperties?: unknown;
			};

			assert.equal(files.type, "object");
			assert.deepEqual(files.additionalProperties, { type: "string" });
			assert.deepEqual(schema.required, ["files"]);
		} finally {
			await client.close();
			await server.close();
		}
	});
});

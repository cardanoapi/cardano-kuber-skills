import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKuberMcpServer } from "./server.ts";

const server = createKuberMcpServer();
const transport = new StdioServerTransport();

// A bundled stdio server has no other long-lived handle, so keep stdin active while the
// host is connected.
process.stdin.resume();

transport.onerror = (error) => {
	console.error("kuber-mcp stdio transport error", error);
};

await server.connect(transport);

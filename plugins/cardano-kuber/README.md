# Cardano Kuber Plugin

This directory is the complete marketplace payload. It contains the Aiken and Plutus skills,
the TypeScript source, and the generated MCP bundle used by every supported host.

The MCP reads `KUBERIDE_API_KEY`, `AIKEN_COMPILER_URL`, `COMPILER_URL`, and
`MESH_NETWORK_ID` from its process environment. Both compiler URLs are required; only the
Plutus compiler requires the API key. Runtime configuration belongs to the host; compiler
URLs, contract source, and credentials are never stored in this plugin.

Run `node dist/kuber-mcp.mjs` to start the newline-delimited stdio MCP server directly.
For development and verification, use the root repository instructions.

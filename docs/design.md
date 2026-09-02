# Distribution Design

## One runtime, three hosts

Claude Code, Codex, and VS Code launch the same `dist/kuber-mcp.mjs`. Their configuration
formats differ, so the repository keeps thin host-specific configuration rather than separate
servers. Claude resolves the bundle from `.mcp.json` with `${CLAUDE_PLUGIN_ROOT}`; Codex
starts it from the inline manifest configuration relative to the installed plugin directory;
the example workspace uses `${workspaceFolder}`.

The plugin directory is self-contained because marketplace clients may cache only that
directory. Skills, source, the generated bundle, and runtime documentation therefore remain
under `plugins/cardano-kuber/`.

## Extraction boundary

The runtime contains only:

- the MCP stdio adapter and `compile_contract` schema;
- Aiken JSON and Plutus streaming compiler clients;
- stale Plutus script rejection based on the GHC failure summary;
- compiler-native to normalized artifact conversion;
- MeshJS script conversion, address derivation, and hash comparison.

The IDE agent, browser UI, wallets, transaction construction, signing, submission, hosted
MCP operations, and session persistence are outside this repository.

## Credential boundary

Compiler URLs and credentials are read from the MCP host environment. They are not accepted
by the tool schema and are not forwarded by the agent as model-visible arguments. Aiken has
no credential. Missing URLs return `compiler_url_unavailable`; Plutus returns
`credentials_unavailable` when its host key is absent.

## Generated bundle

`scripts/build.mjs` bundles all runtime dependencies into one ESM file. This keeps plugin use
to a Node runtime while retaining TypeScript packages and tests as the maintainable source of
truth. A clean-copy stdio test protects against accidental workspace dependencies or absolute
paths.

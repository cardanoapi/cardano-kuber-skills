# Cardano Kuber Skills

Learn, write, and compile Cardano smart contracts from an ordinary DApp repository. The
repository packages two agent skills and one local MCP server:

- `kuber-aiken` guides Aiken v1.1 contract design and hosted compilation.
- `kuber-plutus` guides legacy Plutus V2 contract design and hosted compilation.
- `compile_contract` returns compiler-native output, normalized scripts, MeshJS data,
  validation metadata, and structured diagnostics.

Only Node.js 24 or newer is required at runtime. Aiken, GHC, Cabal, Cardano CLI, and a
Cardano node are not installed locally.

## Credentials and services

Aiken compilation does not require a credential. Both compiler URLs, and the Plutus API key
when compiling Plutus, must be supplied in the environment of the process that starts the MCP
server. These values are host configuration, not `compile_contract` arguments.

Host environment variables:

| Variable | Purpose |
|---|---|
| `KUBERIDE_API_KEY` | Enables the hosted Plutus compiler |
| `AIKEN_COMPILER_URL` | Required Aiken compiler base URL |
| `COMPILER_URL` | Required Plutus compiler base URL |
| `MESH_NETWORK_ID` | Selects the network ID used for derived script addresses; defaults to `0` |

Keep real credentials in an untracked `.env` file or the agent host's secret settings.

## Install from a published marketplace

After this repository is published as `OWNER/cardano-kuber-skills`, Claude Code can install
it with:

```text
/plugin marketplace add OWNER/cardano-kuber-skills
/plugin install cardano-kuber@cardano-kuber-skills
```

For Codex, add the repository marketplace and then install the plugin:

```bash
codex plugin marketplace add /path/to/cardano-kuber-skills
codex plugin add cardano-kuber@cardano-kuber-skills
```

The marketplace metadata lives in `.claude-plugin/marketplace.json` and
`.agents/plugins/marketplace.json`. Both entries select `plugins/cardano-kuber`.

## Try the example in VS Code

Open `example-app` as the VS Code workspace, copy `.env.example` to `.env`, set both compiler
URLs, and set `KUBERIDE_API_KEY` only if you want to compile Plutus. The checked-in
`.vscode/mcp.json` loads that private file and starts the same bundled server distributed by
both plugins.

Use one of the prompts in [example-app/PROMPTS.md](example-app/PROMPTS.md). The agent writes
contract source under `example-app/contracts/` and either returns the complete normalized
compiler response or saves the exact response there as JSON.

## Public MCP contract

`compile_contract` accepts:

```json
{
  "language": "aiken",
  "files": {
    "aiken.toml": "...",
    "validators/contract.ak": "..."
  }
}
```

`language` is `aiken` or `plutus` and defaults to `aiken`. `files` is required. Plutus
normally receives exactly one `Contract.hs`; `title` selects the source value only when the
map contains more than one `.hs` entry. It does not enable multi-module compilation.

The result includes top-level status and diagnostics. Successful compiler calls also include
`nativeArtifact` and the complete normalized `scripts` array. See each skill's hosted
compilation reference for readiness and parameterization rules.

## Development

The committed `dist/kuber-mcp.mjs` is generated from the TypeScript under the plugin root:

```bash
pnpm --dir plugins/cardano-kuber install --frozen-lockfile
pnpm check
```

The check type-checks source, runs compiler-client and artifact tests, rebuilds the bundle,
and verifies repository manifests, skill links, credentials, and bundled stdio startup.

The design and extraction boundary are documented in [docs/design.md](docs/design.md).

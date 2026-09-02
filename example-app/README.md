# Example Contract Workspace

Open this directory as your VS Code workspace. The MCP configuration starts the checked-in
Kuber bundle from the adjacent plugin directory.

1. Copy `.env.example` to `.env`.
2. Set `AIKEN_COMPILER_URL` and `COMPILER_URL` in `.env`.
3. Add `KUBERIDE_API_KEY` only when using the Plutus compiler.
4. Choose a prompt from `PROMPTS.md`.
5. Review the invariant and answer any questions that change on-chain behaviour.
6. Keep authored source and exact compiler JSON under `contracts/<contract-name>/`.

Hosted compilation checks source compatibility and artifact consistency. It does not run
Aiken tests, evaluate Plutus behaviour cases, deploy scripts, or prove contract security.

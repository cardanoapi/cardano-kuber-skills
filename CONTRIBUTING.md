# Contributing

Keep changes inside the smallest affected layer: teaching workflow, compiler protocol,
artifact normalization, MCP adapter, or host packaging. The public `compile_contract`
request and normalized response are compatibility surfaces; update their tests and both
skill references when intentionally changing either one.

## Development checks

Use Node.js 24 or newer and pnpm 11:

```bash
pnpm --dir plugins/cardano-kuber install --frozen-lockfile
pnpm check
```

Rebuild `plugins/cardano-kuber/dist/kuber-mcp.mjs` whenever its TypeScript source or a bundled
dependency changes. Commit the source and generated bundle together.

## Contract teaching material

Reference snippets teach invariants; they are not deployable templates. Keep each pattern
small, show accepted and rejected behaviour, and state what the learner must adapt. A syntax
change requires rechecking the relevant hosted compiler before the reference is updated.

## Credentials and generated artifacts

Use placeholder names and empty values in examples. Never commit compiler API keys, `.env`
files, learner source, or generated script JSON unless the artifact is intentionally part of
a reviewed fixture.

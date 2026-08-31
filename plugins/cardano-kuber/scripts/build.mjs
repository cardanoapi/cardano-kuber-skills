import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });

await build({
  entryPoints: [new URL("../mcp/src/main.ts", import.meta.url).pathname],
  outfile: new URL("../dist/kuber-mcp.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

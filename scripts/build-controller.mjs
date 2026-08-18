import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

await build({
  entryPoints: ["controller/ulanzi-plugin/src/app.ts"],
  outfile: "controller/ulanzi-plugin/dist/app.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
  },
  sourcemap: true,
  legalComments: "linked"
});

await writeFile("controller/ulanzi-plugin/dist/package.json", '{"type":"module"}\n');

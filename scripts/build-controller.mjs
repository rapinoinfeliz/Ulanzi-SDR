import { build } from "esbuild";

await build({
  entryPoints: ["controller/ulanzi-plugin/src/app.ts"],
  outfile: "controller/ulanzi-plugin/dist/app.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  legalComments: "linked"
});


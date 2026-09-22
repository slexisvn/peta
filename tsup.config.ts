import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    platform: "node",
    format: ["esm", "cjs"],
    target: "es2022",
    dts: true,
    clean: true,
    sourcemap: false,
    splitting: false,
    treeshake: true
  },
  {
    entry: { cli: "src/cli.ts" },
    platform: "node",
    format: ["esm"],
    target: "es2022",
    clean: false,
    sourcemap: false,
    splitting: false,
    treeshake: true
  }
]);

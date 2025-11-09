import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@modelcontextprotocol/sdk", "playwright-core", "commander"],
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
});

import { defineConfig } from "tsup";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// Check for DEV mode: env var or .env file in project root
function isDevBuild(): boolean {
  if (process.env.DEV) return true;
  try {
    const envPath = resolve(__dirname, "../../.env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      return /^DEV\s*=\s*1/m.test(content);
    }
  } catch {}
  return false;
}

// Add build suffix for local dev builds
function getBuildSuffix(): string {
  if (isDevBuild()) {
    const now = new Date();
    const ts = now.toISOString().slice(2, 16).replace(/[-T:]/g, "").replace(/(\d{6})(\d{4})/, "$1.$2");
    return `-${ts}`;
  }
  return "";
}

const version = pkg.version + getBuildSuffix();

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@modelcontextprotocol/sdk", "playwright-core", "commander"],
  define: {
    __VERSION__: JSON.stringify(version),
  },
});

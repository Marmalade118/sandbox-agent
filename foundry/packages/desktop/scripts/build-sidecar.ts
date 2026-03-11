import { execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const sidecarDir = resolve(desktopRoot, "src-tauri/sidecars");

const isDev = process.argv.includes("--dev");

// Detect current architecture
function currentTarget(): string {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  return `${arch}-apple-darwin`;
}

// Target triples to build
const targets: Array<{ bunTarget: string; tripleTarget: string }> = isDev
  ? [
      {
        bunTarget: process.arch === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64",
        tripleTarget: currentTarget(),
      },
    ]
  : [
      {
        bunTarget: "bun-darwin-arm64",
        tripleTarget: "aarch64-apple-darwin",
      },
      {
        bunTarget: "bun-darwin-x64",
        tripleTarget: "x86_64-apple-darwin",
      },
    ];

function run(cmd: string, opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  console.log(`> ${cmd}`);
  execSync(cmd, {
    stdio: "inherit",
    cwd: opts?.cwd ?? desktopRoot,
    env: { ...process.env, ...opts?.env },
  });
}

// Step 1: Build the backend with tsup
console.log("\n=== Building backend with tsup ===\n");
run("pnpm --filter @sandbox-agent/foundry-backend build", {
  cwd: resolve(desktopRoot, "../../.."),
});

// Step 2: Compile standalone binaries with bun
mkdirSync(sidecarDir, { recursive: true });

const backendEntry = resolve(desktopRoot, "../backend/dist/index.js");

if (!existsSync(backendEntry)) {
  console.error(`Backend build output not found at ${backendEntry}`);
  process.exit(1);
}

for (const { bunTarget, tripleTarget } of targets) {
  const outfile = resolve(sidecarDir, `foundry-backend-${tripleTarget}`);
  console.log(`\n=== Compiling sidecar for ${tripleTarget} ===\n`);
  run(`bun build --compile --target ${bunTarget} ${backendEntry} --outfile ${outfile}`);
}

console.log("\n=== Sidecar build complete ===\n");

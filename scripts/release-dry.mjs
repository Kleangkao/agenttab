/**
 * Prepare-but-do-not-publish the public 0.1.0 libraries.
 * Does not talk to npm with credentials. Never broadcasts a real publish.
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  "@agenttab/core",
  "@agenttab/dflow",
  "@agenttab/x402",
  "@agenttab/fetch"
];

execSync("node scripts/pack-check.mjs", { cwd: root, stdio: "inherit" });

for (const name of packages) {
  console.log(`\n--- publish --dry-run ${name} ---`);
  execSync(
    `pnpm --filter ${name} publish --dry-run --access public --no-git-checks`,
    { cwd: root, stdio: "inherit" }
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      version: "0.1.0",
      packages,
      next: [
        "Create free npm org `agenttab` (scope) after signing in at https://www.npmjs.com/org/create",
        "Sign in this machine: npm login --auth-type=web --scope=@agenttab",
        "Human approval required before: pnpm --filter @agenttab/core --filter @agenttab/dflow --filter @agenttab/x402 --filter @agenttab/fetch publish --access public"
      ]
    },
    null,
    2
  )
);

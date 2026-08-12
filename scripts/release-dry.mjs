/**
 * Prepare-but-do-not-publish the public libraries.
 * Does not talk to npm with credentials. Never broadcasts a real publish.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  { name: "@agenttab/core", dir: "packages/core" },
  { name: "@agenttab/dflow", dir: "packages/dflow" },
  { name: "@agenttab/x402", dir: "packages/x402" },
  { name: "@agenttab/fetch", dir: "packages/fetch" }
];

execSync("node scripts/pack-check.mjs", { cwd: root, stdio: "inherit" });

const versions = {};
for (const pkg of packages) {
  const manifest = JSON.parse(
    readFileSync(join(root, pkg.dir, "package.json"), "utf8")
  );
  versions[pkg.name] = manifest.version;
  console.log(`\n--- publish --dry-run ${pkg.name}@${manifest.version} ---`);
  execSync(
    `pnpm --filter ${pkg.name} publish --dry-run --access public --no-git-checks`,
    { cwd: root, stdio: "inherit" }
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      versions,
      packages: packages.map((pkg) => pkg.name),
      next: [
        "Live publish is local: create a 7-day @agenttab write GAT, then NPM_TOKEN=... pnpm release:publish, then revoke",
        "Trusted Publishing (OIDC) waits until npm account WebAuthn can be completed",
        "Publish order: core → dflow → x402 → fetch",
        "2FA-bypass GATs lose direct publish in January 2027 — migrate to OIDC before then"
      ]
    },
    null,
    2
  )
);

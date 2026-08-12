/**
 * Publish the public libraries in dependency order.
 *
 * Current AgentTab release path (Trusted Publishing is deferred — it needs
 * account WebAuthn this machine cannot complete):
 *   1. Create a 7-day npm granular token (write, @agenttab, 2FA bypass)
 *   2. NPM_TOKEN=... pnpm release:publish
 *   3. Revoke the token immediately
 *
 * 2FA-bypass GATs can still publish until January 2027. Do not store the
 * token in git or a standing GitHub secret.
 *
 * Never prints the token. Refuses to run without NPM_TOKEN.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.NPM_TOKEN?.trim();
if (!token) {
  console.error(
    "release:publish refuses to run without NPM_TOKEN.\n" +
      "Create a 7-day granular token (write, all @agenttab packages, 2FA bypass),\n" +
      "then:  $env:NPM_TOKEN='...'; pnpm release:publish"
  );
  process.exit(1);
}

const packages = [
  { name: "@agenttab/core", dir: "packages/core" },
  { name: "@agenttab/dflow", dir: "packages/dflow" },
  { name: "@agenttab/x402", dir: "packages/x402" },
  { name: "@agenttab/fetch", dir: "packages/fetch" }
];

execSync("node scripts/pack-check.mjs", { cwd: root, stdio: "inherit" });

const staging = mkdtempSync(join(tmpdir(), "agenttab-release-"));
const npmrc = join(staging, ".npmrc");
writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${token}\n`, {
  encoding: "utf8",
  mode: 0o600
});
const env = {
  ...process.env,
  npm_config_userconfig: npmrc,
  NPM_CONFIG_USERCONFIG: npmrc
};

try {
  for (const pkg of packages) {
    const manifest = JSON.parse(
      readFileSync(join(root, pkg.dir, "package.json"), "utf8")
    );
    const published = publishedVersions(pkg.name);
    if (published.includes(manifest.version)) {
      console.log(`skip ${pkg.name}@${manifest.version} (already on registry)`);
      continue;
    }
    console.log(`\n--- pack ${pkg.name}@${manifest.version} ---`);
    const packOut = execSync(
      `pnpm --filter ${pkg.name} pack --pack-destination ${JSON.stringify(staging)}`,
      { cwd: root, encoding: "utf8" }
    );
    const tgz = packOut
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.endsWith(".tgz"))
      .at(-1);
    if (!tgz) {
      throw new Error(`pnpm pack did not print a tarball for ${pkg.name}`);
    }
    console.log(`--- npm publish ${tgz} ---`);
    execSync(`npm publish ${JSON.stringify(tgz)} --access public`, {
      cwd: root,
      env,
      stdio: "inherit"
    });
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log("release:publish: ok — revoke the granular token now");

function publishedVersions(name) {
  try {
    const raw = execSync(`npm view ${name} versions --json`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

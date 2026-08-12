/**
 * Validate that public packages pack without workspace protocol, tests, or
 * missing LICENSE. Does not publish. Writes tarballs only under os.tmpdir().
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const publicPackages = [
  { dir: "packages/core", name: "@agenttab/core" },
  { dir: "packages/dflow", name: "@agenttab/dflow" },
  { dir: "packages/x402", name: "@agenttab/x402" },
  { dir: "packages/fetch", name: "@agenttab/fetch" }
];

function listTarball(tgzPath) {
  const output = execSync(`tar -tf "${tgzPath}"`, { encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readPackedPackageJson(tgzPath) {
  const raw = execSync(`tar -xOf "${tgzPath}" package/package.json`, {
    encoding: "utf8"
  });
  return JSON.parse(raw);
}

const staging = mkdtempSync(join(tmpdir(), "agenttab-pack-"));
const failures = [];

try {
  for (const pkg of publicPackages) {
    const cwd = join(root, pkg.dir);
    const localManifest = JSON.parse(
      readFileSync(join(cwd, "package.json"), "utf8")
    );
    const version = localManifest.version;
    if (!version || typeof version !== "string") {
      failures.push(`${pkg.name}: package.json is missing a version`);
      continue;
    }

    execSync("pnpm pack --pack-destination " + JSON.stringify(staging), {
      cwd,
      stdio: "pipe"
    });
    const tgzName =
      pkg.name.replace("@", "").replace("/", "-") + `-${version}.tgz`;
    const tgzPath = join(staging, tgzName);
    const entries = listTarball(tgzPath);
    const manifest = readPackedPackageJson(tgzPath);
    const deps = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.optionalDependencies ?? {})
    };

    if (!entries.some((entry) => entry === "package/LICENSE" || entry.endsWith("/LICENSE"))) {
      failures.push(`${pkg.name}: packed tarball is missing LICENSE`);
    }
    if (!entries.some((entry) => entry.includes("dist/index.js"))) {
      failures.push(`${pkg.name}: packed tarball is missing dist/index.js`);
    }
    const tests = entries.filter((entry) => /\.test\.[^/]+$/.test(entry));
    if (tests.length > 0) {
      failures.push(`${pkg.name}: packed test artifacts: ${tests.join(", ")}`);
    }
    for (const [dep, spec] of Object.entries(deps)) {
      if (String(spec).startsWith("workspace:")) {
        failures.push(`${pkg.name}: ${dep} still uses ${spec} after pack`);
      }
    }
    if (manifest.license !== "MIT") {
      failures.push(`${pkg.name}: packed license is ${String(manifest.license)}`);
    }
    if (manifest.version !== version) {
      failures.push(
        `${pkg.name}: packed version ${manifest.version} != local ${version}`
      );
    }
    console.log(
      JSON.stringify(
        {
          package: pkg.name,
          version,
          tarball: tgzName,
          files: entries.length,
          workspaceProtocol: Object.values(deps).some((spec) =>
            String(spec).startsWith("workspace:")
          )
        },
        null,
        2
      )
    );
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("pack-check: ok");

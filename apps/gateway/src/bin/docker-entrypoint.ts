#!/usr/bin/env node
/**
 * GHCR image entry: `gateway` (default) or operator CLIs.
 * CLIs talk to the process on AGENTTAB_GATEWAY_URL (default 127.0.0.1:8787).
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..");

const commands: Record<string, string> = {
  gateway: join(dist, "main.js"),
  approve: join(dist, "cli/approve.js"),
  deny: join(dist, "cli/deny.js"),
  audit: join(dist, "cli/audit-recent.js"),
  "policy-get": join(dist, "cli/policy-get.js"),
  "policy-set": join(dist, "cli/policy-set.js"),
  preview: join(dist, "cli/preview.js")
};

const argv = process.argv.slice(2);
const verb = argv[0] && !argv[0].startsWith("-") ? argv[0] : "gateway";
const rest = verb === argv[0] ? argv.slice(1) : argv;
const script = commands[verb];

if (script === undefined) {
  console.error(
    `Unknown command ${verb}. Use: gateway | approve | deny | audit | policy-get | policy-set | preview`
  );
  process.exit(2);
}

const child = spawn(process.execPath, [script, ...rest], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

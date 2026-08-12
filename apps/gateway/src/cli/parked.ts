#!/usr/bin/env node
/**
 * List executions waiting for a human (approval_required).
 *
 *   pnpm parked
 *   agenttab-parked
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { gatewayFetch, shouldAuditOverHttp } from "./gateway-http.js";
import { SqliteExecutionStore } from "../store/sqlite-execution-store.js";

function resolveDbPath(raw: string): string {
  if (raw === ":memory:") return raw;
  const absolute = resolve(raw);
  if (existsSync(absolute)) return absolute;
  const fromRepoRoot = resolve(process.cwd(), "../..", raw);
  if (existsSync(fromRepoRoot)) return fromRepoRoot;
  return absolute;
}

async function main(): Promise<void> {
  if (shouldAuditOverHttp()) {
    const response = await gatewayFetch("/v1/executions?state=approval_required&limit=50");
    const body = await response.json();
    if (!response.ok) {
      console.error(
        JSON.stringify({ error: "parked_failed", status: response.status, body }, null, 2)
      );
      process.exit(1);
    }
    console.log(JSON.stringify({ source: "gateway", ...(body as object) }, null, 2));
    return;
  }
  const dbPath = resolveDbPath(process.env.AGENTTAB_DB_PATH ?? ".data/gateway.sqlite");
  const store = new SqliteExecutionStore(dbPath);
  try {
    const executions = await store.listRecent({ state: "approval_required", limit: 50 });
    console.log(
      JSON.stringify({ source: "sqlite", dbPath, executions, count: executions.length }, null, 2)
    );
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

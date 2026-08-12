#!/usr/bin/env node
/**
 * Read-only operator audit.
 *
 *   pnpm audit:recent
 *   agenttab-audit (after gateway package build)
 *
 * Uses GET /v1/executions when AGENTTAB_GATEWAY_URL is set and AGENTTAB_DB_PATH
 * is not. Otherwise opens local SQLite (default `.data/gateway.sqlite`).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isExecutionState, type ExecutionState } from "@agenttab/core";
import { SqliteExecutionStore } from "../store/sqlite-execution-store.js";
import { gatewayFetch, shouldAuditOverHttp } from "./gateway-http.js";

function omitHeavyDetails(
  details: Record<string, string | number | boolean | null> | undefined
): Record<string, string | number | boolean | null> | undefined {
  if (details === undefined) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string" && value.length > 160) {
      out[key] = `[omitted ${value.length} chars]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function resolveDbPath(raw: string): string {
  if (raw === ":memory:") return raw;
  const absolute = resolve(raw);
  if (existsSync(absolute)) return absolute;
  const fromRepoRoot = resolve(process.cwd(), "../..", raw);
  if (existsSync(fromRepoRoot)) return fromRepoRoot;
  return absolute;
}

async function auditOverHttp(): Promise<void> {
  const operationId = process.env.AUDIT_OPERATION_ID;
  if (operationId) {
    const response = await gatewayFetch(`/v1/executions/${encodeURIComponent(operationId)}`);
    const body = await response.json();
    if (!response.ok) {
      console.error(
        JSON.stringify(
          { error: "audit_failed", operationId, status: response.status, body },
          null,
          2
        )
      );
      process.exit(1);
    }
    console.log(JSON.stringify({ source: "gateway", ...((body as object) ?? {}) }, null, 2));
    return;
  }

  const limit = Number(process.env.AUDIT_LIMIT ?? "10");
  const stateRaw = process.env.AUDIT_STATE;
  if (stateRaw !== undefined && stateRaw.length > 0 && !isExecutionState(stateRaw)) {
    console.error(`Invalid AUDIT_STATE: ${stateRaw}`);
    process.exit(2);
  }
  const params = new URLSearchParams();
  params.set("limit", String(Number.isFinite(limit) ? limit : 10));
  if (stateRaw !== undefined && isExecutionState(stateRaw)) {
    params.set("state", stateRaw);
  }
  const response = await gatewayFetch(`/v1/executions?${params.toString()}`);
  const body = await response.json();
  if (!response.ok) {
    console.error(
      JSON.stringify({ error: "audit_failed", status: response.status, body }, null, 2)
    );
    process.exit(1);
  }
  console.log(JSON.stringify({ source: "gateway", ...(body as object) }, null, 2));
}

async function auditLocalSqlite(): Promise<void> {
  const dbPath = resolveDbPath(process.env.AGENTTAB_DB_PATH ?? ".data/gateway.sqlite");
  if (!existsSync(dbPath) && dbPath !== ":memory:") {
    console.error(`No SQLite database at ${dbPath}`);
    process.exit(2);
  }

  const store = new SqliteExecutionStore(dbPath);
  try {
    const operationId = process.env.AUDIT_OPERATION_ID;
    if (operationId) {
      const record = await store.get(operationId);
      if (record === undefined) {
        console.error(`Execution not found: ${operationId}`);
        process.exit(1);
      }
      console.log(
        JSON.stringify(
          {
            source: "sqlite",
            dbPath,
            operationId: record.operationId,
            state: record.state,
            version: record.version,
            intent: {
              merchantOrigin: record.intent.merchantOrigin,
              resource: record.intent.resource,
              amountAtomic: record.intent.amountAtomic,
              assetMint: record.intent.assetMint,
              network: record.intent.network
            },
            events: record.events.map((event) => ({
              sequence: event.sequence,
              kind: event.kind,
              to: event.to,
              at: event.at,
              details: omitHeavyDetails(event.details)
            }))
          },
          null,
          2
        )
      );
      return;
    }

    const limit = Number(process.env.AUDIT_LIMIT ?? "10");
    const stateRaw = process.env.AUDIT_STATE;
    if (stateRaw !== undefined && stateRaw.length > 0 && !isExecutionState(stateRaw)) {
      console.error(`Invalid AUDIT_STATE: ${stateRaw}`);
      process.exit(2);
    }
    const state = stateRaw as ExecutionState | undefined;
    const summaries = await store.listRecent({
      limit: Number.isFinite(limit) ? limit : 10,
      ...(state === undefined || !isExecutionState(state) ? {} : { state })
    });

    console.log(
      JSON.stringify(
        {
          source: "sqlite",
          dbPath,
          count: summaries.length,
          executions: summaries
        },
        null,
        2
      )
    );

    if (summaries[0] !== undefined) {
      const latest = await store.get(summaries[0].operationId);
      if (latest) {
        console.log("\nLatest timeline");
        console.log("───────────────");
        for (const event of latest.events) {
          console.log(`  ${event.kind.padEnd(28)} → ${event.to}`);
        }
      }
    }
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  if (shouldAuditOverHttp()) {
    await auditOverHttp();
    return;
  }
  await auditLocalSqlite();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

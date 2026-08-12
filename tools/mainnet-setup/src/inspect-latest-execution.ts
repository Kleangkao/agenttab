/**
 * Mainnet convenience wrapper around the gateway audit CLI defaults.
 * Prefer from repo root:
 *   AGENTTAB_DB_PATH=.data/mainnet/gateway-mainnet.sqlite pnpm audit:recent
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { SqliteExecutionStore } from "@agenttab/gateway";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dbPath =
  process.env.AGENTTAB_DB_PATH ?? resolve(ROOT, ".data/mainnet/gateway-mainnet.sqlite");

if (!existsSync(dbPath)) {
  console.error(`No Mainnet gateway DB at ${dbPath}`);
  process.exit(2);
}

const store = new SqliteExecutionStore(dbPath);
try {
  const operationId = process.env.AUDIT_OPERATION_ID;
  if (operationId) {
    const record = await store.get(operationId);
    if (!record) {
      console.error(`Execution not found: ${operationId}`);
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        {
          dbPath,
          operationId: record.operationId,
          state: record.state,
          events: record.events.map((e) => ({
            sequence: e.sequence,
            kind: e.kind,
            to: e.to
          }))
        },
        null,
        2
      )
    );
  } else {
    const executions = await store.listRecent({
      limit: Number(process.env.AUDIT_LIMIT ?? "10")
    });
    console.log(JSON.stringify({ dbPath, count: executions.length, executions }, null, 2));
    const latest = executions[0] ? await store.get(executions[0].operationId) : undefined;
    if (latest) {
      console.log("\nLatest timeline");
      for (const event of latest.events) {
        console.log(`  ${event.kind.padEnd(28)} → ${event.to}`);
      }
    }
  }
} finally {
  store.close();
}

import { DatabaseSync } from "node:sqlite";
import type { SpendLedger } from "../orchestrator/coordinator.js";

/**
 * Durable rolling spend ledger backed by the gateway SQLite database.
 * Survives process restarts so Mainnet daily caps remain meaningful.
 * Operation-keyed rows prevent double-counting the same payment.
 */
export class SqliteSpendLedger implements SpendLedger {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS spend_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usd_micros TEXT NOT NULL,
        at_ms INTEGER NOT NULL,
        operation_id TEXT
      );
      CREATE INDEX IF NOT EXISTS spend_events_at_ms ON spend_events(at_ms);
    `);
    // Migrate older DBs that predate operation_id.
    const columns = this.#db.prepare("PRAGMA table_info(spend_events)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "operation_id")) {
      this.#db.exec("ALTER TABLE spend_events ADD COLUMN operation_id TEXT");
    }
    this.#db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS spend_events_operation_id
        ON spend_events(operation_id)
        WHERE operation_id IS NOT NULL
    `);
  }

  getSpentUsdMicrosLast24h(): string {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = this.#db
      .prepare("SELECT usd_micros FROM spend_events WHERE at_ms >= ?")
      .all(cutoff) as Array<{ usd_micros: string }>;
    let total = 0n;
    for (const row of rows) total += BigInt(row.usd_micros);
    return total.toString();
  }

  recordSpend(usdMicros: string): void {
    const amount = BigInt(usdMicros);
    if (amount < 0n) throw new Error("spend cannot be negative");
    this.#db
      .prepare("INSERT INTO spend_events (usd_micros, at_ms, operation_id) VALUES (?, ?, NULL)")
      .run(amount.toString(), Date.now());
  }

  ensureOperationSpend(operationId: string, usdMicros: string): boolean {
    if (!operationId) throw new Error("operationId required for ensureOperationSpend");
    const amount = BigInt(usdMicros);
    if (amount < 0n) throw new Error("spend cannot be negative");
    const existing = this.#db
      .prepare("SELECT id FROM spend_events WHERE operation_id = ?")
      .get(operationId) as { id: number } | undefined;
    if (existing !== undefined) return false;
    try {
      this.#db
        .prepare(
          "INSERT INTO spend_events (usd_micros, at_ms, operation_id) VALUES (?, ?, ?)"
        )
        .run(amount.toString(), Date.now(), operationId);
      return true;
    } catch {
      // Concurrent insert won the unique race.
      return false;
    }
  }
}

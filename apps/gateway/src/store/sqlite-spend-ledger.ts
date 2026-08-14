import { DatabaseSync } from "node:sqlite";
import type { SpendLedger, SpendReserveResult } from "../orchestrator/coordinator.js";

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
    if (!columns.some((column) => column.name === "agent_id")) {
      this.#db.exec("ALTER TABLE spend_events ADD COLUMN agent_id TEXT");
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

  getSpentUsdMicrosLast24hByAgent(): Record<string, string> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = this.#db
      .prepare(
        "SELECT agent_id, usd_micros FROM spend_events WHERE at_ms >= ? AND agent_id IS NOT NULL"
      )
      .all(cutoff) as Array<{ agent_id: string; usd_micros: string }>;
    const totals = new Map<string, bigint>();
    for (const row of rows) {
      totals.set(row.agent_id, (totals.get(row.agent_id) ?? 0n) + BigInt(row.usd_micros));
    }
    const out: Record<string, string> = {};
    for (const [agentId, total] of totals) {
      out[agentId] = total.toString();
    }
    return out;
  }

  recordSpend(usdMicros: string): void {
    const amount = BigInt(usdMicros);
    if (amount < 0n) throw new Error("spend cannot be negative");
    this.#db
      .prepare(
        "INSERT INTO spend_events (usd_micros, at_ms, operation_id, agent_id) VALUES (?, ?, NULL, NULL)"
      )
      .run(amount.toString(), Date.now());
  }

  ensureOperationSpend(
    operationId: string,
    usdMicros: string,
    agentId?: string | undefined
  ): boolean {
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
          "INSERT INTO spend_events (usd_micros, at_ms, operation_id, agent_id) VALUES (?, ?, ?, ?)"
        )
        .run(
          amount.toString(),
          Date.now(),
          operationId,
          agentId !== undefined && agentId.length > 0 ? agentId : null
        );
      return true;
    } catch {
      // Concurrent insert won the unique race.
      return false;
    }
  }

  tryReserveOperationSpend(
    operationId: string,
    usdMicros: string,
    capUsdMicros: string,
    agentId?: string | undefined
  ): SpendReserveResult {
    if (!operationId) throw new Error("operationId required for tryReserveOperationSpend");
    const amount = BigInt(usdMicros);
    if (amount < 0n) throw new Error("spend cannot be negative");
    const cap = BigInt(capUsdMicros);
    // Same connection as SqliteExecutionStore. Those BEGIN IMMEDIATE blocks are
    // await-free and have committed before the coordinator reaches this call
    // site, so a nested BEGIN would mean a later refactor nested us inside a
    // store transaction — fail closed rather than SAVEPOINT-mask it.
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#db
        .prepare("SELECT id FROM spend_events WHERE operation_id = ?")
        .get(operationId) as { id: number } | undefined;
      if (existing !== undefined) {
        this.#db.exec("COMMIT");
        return "duplicate";
      }
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const rows = this.#db
        .prepare("SELECT usd_micros FROM spend_events WHERE at_ms >= ?")
        .all(cutoff) as Array<{ usd_micros: string }>;
      let spent = 0n;
      for (const row of rows) spent += BigInt(row.usd_micros);
      if (spent + amount > cap) {
        this.#db.exec("ROLLBACK");
        return "cap_exceeded";
      }
      this.#db
        .prepare(
          "INSERT INTO spend_events (usd_micros, at_ms, operation_id, agent_id) VALUES (?, ?, ?, ?)"
        )
        .run(
          amount.toString(),
          Date.now(),
          operationId,
          agentId !== undefined && agentId.length > 0 ? agentId : null
        );
      this.#db.exec("COMMIT");
      return "reserved";
    } catch (error) {
      this.#db.exec("ROLLBACK");
      const raced = this.#db
        .prepare("SELECT id FROM spend_events WHERE operation_id = ?")
        .get(operationId) as { id: number } | undefined;
      if (raced !== undefined) return "duplicate";
      throw error;
    }
  }

  releaseOperationSpend(operationId: string): boolean {
    if (!operationId) throw new Error("operationId required for releaseOperationSpend");
    const result = this.#db
      .prepare("DELETE FROM spend_events WHERE operation_id = ?")
      .run(operationId);
    return result.changes > 0;
  }
}

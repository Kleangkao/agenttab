import { DatabaseSync } from "node:sqlite";
import type { SpendLedger, SpendReserveResult } from "../orchestrator/coordinator.js";

type SpendRow = {
  id: number;
  usd_micros: string;
  status: string;
  agent_id: string | null;
};

/**
 * Durable rolling spend ledger backed by the gateway SQLite database.
 * Survives process restarts so Mainnet daily caps remain meaningful.
 * Operation-keyed rows prevent double-counting the same payment.
 * `status = reserved` occupies the cap but is not realized spend until
 * `ensureOperationSpend` promotes it to `committed`.
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
        operation_id TEXT,
        agent_id TEXT,
        status TEXT NOT NULL DEFAULT 'committed'
      );
      CREATE INDEX IF NOT EXISTS spend_events_at_ms ON spend_events(at_ms);
    `);
    // Migrate older DBs that predate operation_id / agent_id / status.
    const columns = this.#db.prepare("PRAGMA table_info(spend_events)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "operation_id")) {
      this.#db.exec("ALTER TABLE spend_events ADD COLUMN operation_id TEXT");
    }
    if (!columns.some((column) => column.name === "agent_id")) {
      this.#db.exec("ALTER TABLE spend_events ADD COLUMN agent_id TEXT");
    }
    if (!columns.some((column) => column.name === "status")) {
      this.#db.exec(
        "ALTER TABLE spend_events ADD COLUMN status TEXT NOT NULL DEFAULT 'committed'"
      );
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
      .prepare(
        "SELECT usd_micros FROM spend_events WHERE status = 'committed' AND at_ms >= ?"
      )
      .all(cutoff) as Array<{ usd_micros: string }>;
    let total = 0n;
    for (const row of rows) total += BigInt(row.usd_micros);
    return total.toString();
  }

  getSpentUsdMicrosLast24hByAgent(): Record<string, string> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = this.#db
      .prepare(
        `SELECT agent_id, usd_micros FROM spend_events
         WHERE status = 'committed' AND at_ms >= ? AND agent_id IS NOT NULL`
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

  #occupiedExcluding(operationId: string): bigint {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = this.#db
      .prepare(
        `SELECT usd_micros FROM spend_events
         WHERE (operation_id IS NULL OR operation_id != ?)
           AND (
             (status = 'committed' AND at_ms >= ?)
             OR status = 'reserved'
           )`
      )
      .all(operationId, cutoff) as Array<{ usd_micros: string }>;
    let total = 0n;
    for (const row of rows) total += BigInt(row.usd_micros);
    return total;
  }

  #occupiedByAgentExcluding(operationId: string, agentId: string): bigint {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = this.#db
      .prepare(
        `SELECT usd_micros FROM spend_events
         WHERE agent_id = ?
           AND (operation_id IS NULL OR operation_id != ?)
           AND (
             (status = 'committed' AND at_ms >= ?)
             OR status = 'reserved'
           )`
      )
      .all(agentId, operationId, cutoff) as Array<{ usd_micros: string }>;
    let total = 0n;
    for (const row of rows) total += BigInt(row.usd_micros);
    return total;
  }

  recordSpend(usdMicros: string): void {
    const amount = BigInt(usdMicros);
    if (amount < 0n) throw new Error("spend cannot be negative");
    this.#db
      .prepare(
        `INSERT INTO spend_events (usd_micros, at_ms, operation_id, agent_id, status)
         VALUES (?, ?, NULL, NULL, 'committed')`
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
    const agent = agentId !== undefined && agentId.length > 0 ? agentId : null;
    // Same connection as SqliteExecutionStore. Those BEGIN IMMEDIATE blocks are
    // await-free and have committed before the coordinator reaches this call
    // site, so a nested BEGIN would mean a later refactor nested us inside a
    // store transaction — fail closed rather than SAVEPOINT-mask it.
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#db
        .prepare("SELECT id, status FROM spend_events WHERE operation_id = ?")
        .get(operationId) as { id: number; status: string } | undefined;
      if (existing?.status === "committed") {
        this.#db.exec("COMMIT");
        return false;
      }
      if (existing?.status === "reserved") {
        this.#db
          .prepare(
            `UPDATE spend_events
             SET usd_micros = ?, at_ms = ?,
                 agent_id = COALESCE(?, agent_id),
                 status = 'committed'
             WHERE operation_id = ?`
          )
          .run(amount.toString(), Date.now(), agent, operationId);
        this.#db.exec("COMMIT");
        return true;
      }
      this.#db
        .prepare(
          `INSERT INTO spend_events (usd_micros, at_ms, operation_id, agent_id, status)
           VALUES (?, ?, ?, ?, 'committed')`
        )
        .run(amount.toString(), Date.now(), operationId, agent);
      this.#db.exec("COMMIT");
      return true;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      const raced = this.#db
        .prepare("SELECT status FROM spend_events WHERE operation_id = ?")
        .get(operationId) as { status: string } | undefined;
      if (raced?.status === "committed") return false;
      throw error;
    }
  }

  tryReserveOperationSpend(
    operationId: string,
    usdMicros: string,
    capUsdMicros: string,
    agentId?: string | undefined,
    agentCapUsdMicros?: string | undefined
  ): SpendReserveResult {
    if (!operationId) throw new Error("operationId required for tryReserveOperationSpend");
    const amount = BigInt(usdMicros);
    if (amount < 0n) throw new Error("spend cannot be negative");
    const cap = BigInt(capUsdMicros);
    const agent = agentId !== undefined && agentId.length > 0 ? agentId : null;
    const agentCap =
      agentCapUsdMicros !== undefined && agentCapUsdMicros.length > 0
        ? BigInt(agentCapUsdMicros)
        : undefined;
    // Same connection as SqliteExecutionStore. Those BEGIN IMMEDIATE blocks are
    // await-free and have committed before the coordinator reaches this call
    // site, so a nested BEGIN would mean a later refactor nested us inside a
    // store transaction — fail closed rather than SAVEPOINT-mask it.
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#db
        .prepare(
          "SELECT id, usd_micros, status, agent_id FROM spend_events WHERE operation_id = ?"
        )
        .get(operationId) as SpendRow | undefined;
      if (existing?.status === "committed") {
        this.#db.exec("COMMIT");
        return "duplicate";
      }
      const selfAmount = existing?.status === "reserved" ? BigInt(existing.usd_micros) : amount;
      const namedAgent =
        existing?.status === "reserved" && existing.agent_id !== null && existing.agent_id.length > 0
          ? existing.agent_id
          : agent;
      const others = this.#occupiedExcluding(operationId);
      const exceedsAgent =
        agentCap !== undefined &&
        namedAgent !== null &&
        this.#occupiedByAgentExcluding(operationId, namedAgent) + selfAmount > agentCap;
      const exceedsGlobal = others + selfAmount > cap;
      if (existing?.status === "reserved") {
        if (exceedsAgent || exceedsGlobal) {
          this.#db
            .prepare("DELETE FROM spend_events WHERE operation_id = ? AND status = 'reserved'")
            .run(operationId);
          this.#db.exec("COMMIT");
          return exceedsAgent ? "agent_cap_exceeded" : "cap_exceeded";
        }
        this.#db.exec("COMMIT");
        return "duplicate";
      }
      if (exceedsAgent) {
        this.#db.exec("ROLLBACK");
        return "agent_cap_exceeded";
      }
      if (exceedsGlobal) {
        this.#db.exec("ROLLBACK");
        return "cap_exceeded";
      }
      this.#db
        .prepare(
          `INSERT INTO spend_events (usd_micros, at_ms, operation_id, agent_id, status)
           VALUES (?, ?, ?, ?, 'reserved')`
        )
        .run(amount.toString(), Date.now(), operationId, namedAgent);
      this.#db.exec("COMMIT");
      return "reserved";
    } catch (error) {
      this.#db.exec("ROLLBACK");
      const raced = this.#db
        .prepare("SELECT status FROM spend_events WHERE operation_id = ?")
        .get(operationId) as { status: string } | undefined;
      if (raced !== undefined) return "duplicate";
      throw error;
    }
  }

  releaseOperationSpend(operationId: string): boolean {
    if (!operationId) throw new Error("operationId required for releaseOperationSpend");
    const result = this.#db
      .prepare("DELETE FROM spend_events WHERE operation_id = ? AND status = 'reserved'")
      .run(operationId);
    return result.changes > 0;
  }
}

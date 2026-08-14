import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { NotifyAttemptRecord, OperatorNotifyEventName } from "../notify.js";

export interface NotifyDeliveryStore {
  recordAttempt(row: NotifyAttemptRecord): void;
  listForOperation(operationId: string): NotifyAttemptRecord[];
}

export class SqliteNotifyDeliveryStore implements NotifyDeliveryStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS notify_deliveries (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        event TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        at TEXT NOT NULL,
        status INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS notify_deliveries_operation
        ON notify_deliveries(operation_id, attempt);
    `);
  }

  recordAttempt(row: NotifyAttemptRecord): void {
    this.#db
      .prepare(
        `
        INSERT INTO notify_deliveries (
          id, operation_id, event, attempt, ok, at, status, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        randomUUID(),
        row.operationId,
        row.event,
        row.attempt,
        row.ok ? 1 : 0,
        row.at,
        row.status ?? null,
        row.error ?? null
      );
  }

  listForOperation(operationId: string): NotifyAttemptRecord[] {
    const rows = this.#db
      .prepare(
        `
        SELECT operation_id, event, attempt, ok, at, status, error
        FROM notify_deliveries
        WHERE operation_id = ?
        ORDER BY at ASC, attempt ASC
      `
      )
      .all(operationId) as Array<{
      operation_id: string;
      event: string;
      attempt: number;
      ok: number;
      at: string;
      status: number | null;
      error: string | null;
    }>;
    return rows.map((row) => ({
      operationId: row.operation_id,
      event: row.event as OperatorNotifyEventName,
      attempt: row.attempt,
      ok: row.ok === 1,
      at: row.at,
      ...(row.status === null ? {} : { status: row.status }),
      ...(row.error === null ? {} : { error: row.error })
    }));
  }
}

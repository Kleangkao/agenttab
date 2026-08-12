import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  assertAllowedExecutionTransition,
  createIdempotencyKey,
  ExecutionVersionConflictError,
  REUSABLE_EXECUTION_STATES,
  type ExecutionEvent,
  type ExecutionRecord,
  type ExecutionState,
  type ExecutionStore,
  type PaymentIntent
} from "@agenttab/core";
import { SqliteSpendLedger } from "./sqlite-spend-ledger.js";
import { SqlitePolicyStore } from "./sqlite-policy-store.js";
import type { PaymentPolicy } from "@agenttab/core";

interface ExecutionRow {
  operation_id: string;
  idempotency_key: string;
  state: string;
  version: number;
  intent_json: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  operation_id: string;
  sequence: number;
  at: string;
  from_state: string | null;
  to_state: string;
  kind: string;
  details_json: string | null;
}

export interface ExecutionSummary {
  operationId: string;
  state: ExecutionState;
  version: number;
  createdAt: string;
  updatedAt: string;
  merchantOrigin: string;
  resource: string;
  requestHash: string;
  amountAtomic: string;
  assetMint: string;
  network: string;
  lastEventKind: string | null;
}

export class SqliteExecutionStore implements ExecutionStore {
  readonly #db: DatabaseSync;

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec("PRAGMA foreign_keys = ON;");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        operation_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        version INTEGER NOT NULL,
        intent_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS execution_events (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        at TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        kind TEXT NOT NULL,
        details_json TEXT,
        UNIQUE(operation_id, sequence),
        FOREIGN KEY(operation_id) REFERENCES executions(operation_id)
      );

      CREATE INDEX IF NOT EXISTS executions_updated_at
        ON executions(updated_at DESC);

      CREATE INDEX IF NOT EXISTS executions_request_hash
        ON executions(json_extract(intent_json, '$.requestHash'));
    `);
  }

  close(): void {
    this.#db.close();
  }

  /** Shared DB handle for durable ledgers colocated with executions. */
  get database(): DatabaseSync {
    return this.#db;
  }

  createSpendLedger(): SqliteSpendLedger {
    return new SqliteSpendLedger(this.#db);
  }

  createPolicyStore(seed: PaymentPolicy): SqlitePolicyStore {
    return new SqlitePolicyStore(this.#db, seed);
  }

  /**
   * Recent execution summaries for operator audit (newest first).
   * Detail receipts remain available via get(operationId).
   */
  async listRecent(options: {
    limit?: number;
    state?: ExecutionState;
    requestHash?: string;
    reusable?: boolean;
  } = {}): Promise<ExecutionSummary[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (options.state !== undefined) {
      clauses.push("state = ?");
      params.push(options.state);
    } else if (options.reusable === true) {
      clauses.push(
        `state IN (${REUSABLE_EXECUTION_STATES.map(() => "?").join(", ")})`
      );
      params.push(...REUSABLE_EXECUTION_STATES);
    }

    if (options.requestHash !== undefined) {
      clauses.push("json_extract(intent_json, '$.requestHash') = ?");
      params.push(options.requestHash);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.#db
      .prepare(
        `
        SELECT operation_id, state, version, intent_json, created_at, updated_at
        FROM executions
        ${where}
        ORDER BY updated_at DESC, operation_id DESC
        LIMIT ?
      `
      )
      .all(...params, limit) as unknown as ExecutionRow[];

    return rows.map((row) => {
      const intent = JSON.parse(row.intent_json) as PaymentIntent;
      const lastEvent = this.#db
        .prepare(
          `
          SELECT kind FROM execution_events
          WHERE operation_id = ?
          ORDER BY sequence DESC
          LIMIT 1
        `
        )
        .get(row.operation_id) as { kind: string } | undefined;
      return {
        operationId: row.operation_id,
        state: row.state as ExecutionState,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        merchantOrigin: intent.merchantOrigin,
        resource: intent.resource,
        requestHash: intent.requestHash,
        amountAtomic: intent.amountAtomic,
        assetMint: intent.assetMint,
        network: intent.network,
        lastEventKind: lastEvent?.kind ?? null
      };
    });
  }

  async createOrGet(intent: PaymentIntent): Promise<{ record: ExecutionRecord; created: boolean }> {
    const idempotencyKey = createIdempotencyKey(intent);
    const existingByKey = this.#db
      .prepare("SELECT operation_id FROM executions WHERE idempotency_key = ?")
      .get(idempotencyKey) as { operation_id: string } | undefined;

    if (existingByKey !== undefined) {
      const record = await this.get(existingByKey.operation_id);
      if (record === undefined) throw new Error("Execution store index is inconsistent");
      return { record, created: false };
    }

    const now = new Date().toISOString();
    const event: ExecutionEvent = {
      id: randomUUID(),
      operationId: intent.operationId,
      sequence: 0,
      at: now,
      from: null,
      to: "discovered",
      kind: "payment.discovered"
    };

    const insertExecution = this.#db.prepare(`
      INSERT INTO executions (
        operation_id, idempotency_key, state, version, intent_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEvent = this.#db.prepare(`
      INSERT INTO execution_events (
        id, operation_id, sequence, at, from_state, to_state, kind, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      this.#db.exec("BEGIN IMMEDIATE");
      insertExecution.run(
        intent.operationId,
        idempotencyKey,
        "discovered",
        0,
        JSON.stringify(intent),
        now,
        now
      );
      insertEvent.run(event.id, event.operationId, event.sequence, event.at, null, event.to, event.kind, null);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      const raced = this.#db
        .prepare("SELECT operation_id FROM executions WHERE idempotency_key = ?")
        .get(idempotencyKey) as { operation_id: string } | undefined;
      if (raced !== undefined) {
        const record = await this.get(raced.operation_id);
        if (record === undefined) throw new Error("Execution store index is inconsistent");
        return { record, created: false };
      }
      throw error;
    }

    const record = await this.get(intent.operationId);
    if (record === undefined) throw new Error("Failed to persist execution");
    return { record, created: true };
  }

  async get(operationId: string): Promise<ExecutionRecord | undefined> {
    const row = this.#db
      .prepare("SELECT * FROM executions WHERE operation_id = ?")
      .get(operationId) as ExecutionRow | undefined;
    if (row === undefined) return undefined;

    const events = (
      this.#db
        .prepare(
          "SELECT * FROM execution_events WHERE operation_id = ? ORDER BY sequence ASC"
        )
        .all(operationId) as unknown as EventRow[]
    );

    return {
      operationId: row.operation_id,
      idempotencyKey: row.idempotency_key,
      state: row.state as ExecutionState,
      version: row.version,
      intent: JSON.parse(row.intent_json) as PaymentIntent,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      events: events.map((event) => {
        const details =
          event.details_json === null
            ? undefined
            : (JSON.parse(event.details_json) as Record<string, string | number | boolean | null>);
        return {
          id: event.id,
          operationId: event.operation_id,
          sequence: event.sequence,
          at: event.at,
          from: event.from_state as ExecutionState | null,
          to: event.to_state as ExecutionState,
          kind: event.kind,
          ...(details === undefined ? {} : { details })
        };
      })
    };
  }

  async transition(input: {
    operationId: string;
    expectedVersion: number;
    to: ExecutionState;
    kind: string;
    details?: Record<string, string | number | boolean | null>;
    now?: Date;
  }): Promise<ExecutionRecord> {
    const current = await this.get(input.operationId);
    if (current === undefined) throw new Error(`Execution not found: ${input.operationId}`);
    if (current.version !== input.expectedVersion) {
      throw new ExecutionVersionConflictError(input.operationId);
    }
    assertAllowedExecutionTransition(current.state, input.to);

    const at = (input.now ?? new Date()).toISOString();
    const nextVersion = current.version + 1;
    const eventId = randomUUID();
    const detailsJson = input.details === undefined ? null : JSON.stringify(input.details);

    try {
      this.#db.exec("BEGIN IMMEDIATE");
      const updated = this.#db
        .prepare(
          `
          UPDATE executions
          SET state = ?, version = ?, updated_at = ?
          WHERE operation_id = ? AND version = ?
        `
        )
        .run(input.to, nextVersion, at, input.operationId, input.expectedVersion);
      if (updated.changes !== 1) {
        throw new ExecutionVersionConflictError(input.operationId);
      }
      this.#db
        .prepare(
          `
          INSERT INTO execution_events (
            id, operation_id, sequence, at, from_state, to_state, kind, details_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          eventId,
          input.operationId,
          nextVersion,
          at,
          current.state,
          input.to,
          input.kind,
          detailsJson
        );
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }

    const record = await this.get(input.operationId);
    if (record === undefined) throw new Error("Failed to load transitioned execution");
    return record;
  }

  async appendEvent(input: {
    operationId: string;
    expectedVersion: number;
    kind: string;
    details?: Record<string, string | number | boolean | null>;
    now?: Date;
  }): Promise<ExecutionRecord> {
    const current = await this.get(input.operationId);
    if (current === undefined) throw new Error(`Execution not found: ${input.operationId}`);
    if (current.version !== input.expectedVersion) {
      throw new ExecutionVersionConflictError(input.operationId);
    }

    const at = (input.now ?? new Date()).toISOString();
    const nextVersion = current.version + 1;
    const eventId = randomUUID();
    const detailsJson = input.details === undefined ? null : JSON.stringify(input.details);

    try {
      this.#db.exec("BEGIN IMMEDIATE");
      const updated = this.#db
        .prepare(
          `
          UPDATE executions
          SET version = ?, updated_at = ?
          WHERE operation_id = ? AND version = ?
        `
        )
        .run(nextVersion, at, input.operationId, input.expectedVersion);
      if (updated.changes !== 1) {
        throw new ExecutionVersionConflictError(input.operationId);
      }
      this.#db
        .prepare(
          `
          INSERT INTO execution_events (
            id, operation_id, sequence, at, from_state, to_state, kind, details_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          eventId,
          input.operationId,
          nextVersion,
          at,
          current.state,
          current.state,
          input.kind,
          detailsJson
        );
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }

    const record = await this.get(input.operationId);
    if (record === undefined) throw new Error("Failed to load execution after appendEvent");
    return record;
  }
}

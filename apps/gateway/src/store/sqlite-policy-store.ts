import type { DatabaseSync } from "node:sqlite";
import { paymentPolicySchema, type PaymentPolicy } from "@agenttab/core";
import type { PolicyStore } from "../policy/store.js";

/**
 * Durable policy singleton colocated with executions/spend in gateway SQLite.
 * Survives process restarts so human-owned limits remain meaningful.
 */
export class SqlitePolicyStore implements PolicyStore {
  readonly #db: DatabaseSync;
  #policy: PaymentPolicy;

  constructor(db: DatabaseSync, seed: PaymentPolicy) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_policy (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        policy_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const existing = this.#db
      .prepare("SELECT policy_json FROM gateway_policy WHERE id = 1")
      .get() as { policy_json: string } | undefined;
    if (existing !== undefined) {
      this.#policy = paymentPolicySchema.parse(JSON.parse(existing.policy_json));
    } else {
      this.#policy = paymentPolicySchema.parse(seed);
      this.#persist(this.#policy);
    }
  }

  get(): PaymentPolicy {
    return structuredClone(this.#policy);
  }

  set(policy: PaymentPolicy): PaymentPolicy {
    this.#policy = paymentPolicySchema.parse(policy);
    this.#persist(this.#policy);
    return this.get();
  }

  #persist(policy: PaymentPolicy): void {
    this.#db
      .prepare(
        `
        INSERT INTO gateway_policy (id, policy_json, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          policy_json = excluded.policy_json,
          updated_at = excluded.updated_at
      `
      )
      .run(JSON.stringify(policy), new Date().toISOString());
  }
}

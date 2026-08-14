import { createHash, randomUUID } from "node:crypto";
import type { PaymentIntent } from "./types.js";
import { canonicalizeHttpOrigin } from "./origin.js";

export const EXECUTION_STATES = [
  "discovered",
  "approval_required",
  "approved",
  "funding_submitted",
  "funded",
  "payment_submitted",
  "paid",
  "fulfilled",
  "fulfillment_failed",
  "denied",
  "failed"
] as const;

export type ExecutionState = (typeof EXECUTION_STATES)[number];

/** States a later agent process may resume instead of minting a new operationId. */
export const REUSABLE_EXECUTION_STATES = [
  "approval_required",
  "approved",
  "funding_submitted",
  "funded",
  "payment_submitted",
  "paid",
  "fulfillment_failed"
] as const satisfies readonly ExecutionState[];

export function isExecutionState(value: string): value is ExecutionState {
  return (EXECUTION_STATES as readonly string[]).includes(value);
}

export function isReusableExecutionState(value: string): boolean {
  return (REUSABLE_EXECUTION_STATES as readonly string[]).includes(value);
}

export interface ExecutionEvent {
  id: string;
  operationId: string;
  sequence: number;
  at: string;
  from: ExecutionState | null;
  to: ExecutionState;
  kind: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface ExecutionRecord {
  operationId: string;
  idempotencyKey: string;
  state: ExecutionState;
  version: number;
  intent: PaymentIntent;
  createdAt: string;
  updatedAt: string;
  events: readonly ExecutionEvent[];
  /** Gateway-attributed agent identity. Never taken from the payment intent. */
  agentId?: string;
}

export interface CreateExecutionOptions {
  agentId?: string | undefined;
}

export class AgentIdentityConflictError extends Error {
  readonly operationId: string;

  constructor(operationId: string) {
    super(`Execution ${operationId} belongs to a different agent`);
    this.name = "AgentIdentityConflictError";
    this.operationId = operationId;
  }
}

function assertCompatibleAgent(
  record: ExecutionRecord,
  agentId: string | undefined
): void {
  if (agentId === undefined || agentId.length === 0) return;
  if (record.agentId === undefined || record.agentId.length === 0) return;
  if (record.agentId !== agentId) {
    throw new AgentIdentityConflictError(record.operationId);
  }
}

const allowedTransitions: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = {
  discovered: ["approval_required", "approved", "denied", "failed"],
  approval_required: ["approved", "denied", "failed"],
  approved: ["funding_submitted", "funded", "payment_submitted", "denied", "failed"],
  funding_submitted: ["funded", "denied", "failed"],
  funded: ["payment_submitted", "failed"],
  payment_submitted: ["paid", "failed"],
  paid: ["fulfilled", "fulfillment_failed"],
  fulfillment_failed: ["fulfilled", "fulfillment_failed"],
  fulfilled: [],
  denied: [],
  failed: []
};

export class InvalidExecutionTransitionError extends Error {
  constructor(from: ExecutionState, to: ExecutionState) {
    super(`Invalid execution transition: ${from} -> ${to}`);
    this.name = "InvalidExecutionTransitionError";
  }
}

export class ExecutionVersionConflictError extends Error {
  constructor(operationId: string) {
    super(`Execution version conflict for ${operationId}`);
    this.name = "ExecutionVersionConflictError";
  }
}

export function isAllowedExecutionTransition(from: ExecutionState, to: ExecutionState): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertAllowedExecutionTransition(from: ExecutionState, to: ExecutionState): void {
  if (!isAllowedExecutionTransition(from, to)) {
    throw new InvalidExecutionTransitionError(from, to);
  }
}

function originForKey(value: string): string {
  try {
    return canonicalizeHttpOrigin(value);
  } catch {
    return value;
  }
}

export function createIdempotencyKey(intent: PaymentIntent): string {
  const material = JSON.stringify([
    intent.operationId,
    intent.requestHash,
    intent.protocol,
    intent.network,
    originForKey(intent.merchantOrigin),
    intent.destination,
    intent.assetMint,
    intent.amountAtomic,
    intent.resource
  ]);
  return `agt_${createHash("sha256").update(material).digest("hex")}`;
}

export interface ExecutionStore {
  createOrGet(
    intent: PaymentIntent,
    options?: CreateExecutionOptions
  ): Promise<{ record: ExecutionRecord; created: boolean }>;
  get(operationId: string): Promise<ExecutionRecord | undefined>;
  transition(input: {
    operationId: string;
    expectedVersion: number;
    to: ExecutionState;
    kind: string;
    details?: Record<string, string | number | boolean | null>;
    now?: Date;
  }): Promise<ExecutionRecord>;
  /**
   * Append an audit event without changing execution state.
   * Used for funding attempt locks / side-effect receipts so retries can resume
   * instead of re-executing chain mutations.
   */
  appendEvent(input: {
    operationId: string;
    expectedVersion: number;
    kind: string;
    details?: Record<string, string | number | boolean | null>;
    now?: Date;
  }): Promise<ExecutionRecord>;
}

export class InMemoryExecutionStore implements ExecutionStore {
  readonly #records = new Map<string, ExecutionRecord>();
  readonly #operationsByKey = new Map<string, string>();

  async createOrGet(
    intent: PaymentIntent,
    options: CreateExecutionOptions = {}
  ): Promise<{ record: ExecutionRecord; created: boolean }> {
    const idempotencyKey = createIdempotencyKey(intent);
    const existingOperationId = this.#operationsByKey.get(idempotencyKey);
    if (existingOperationId !== undefined) {
      const existing = this.#records.get(existingOperationId);
      if (existing === undefined) throw new Error("Execution store index is inconsistent");
      assertCompatibleAgent(existing, options.agentId);
      return { record: structuredClone(existing), created: false };
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
    const agentId =
      options.agentId !== undefined && options.agentId.length > 0 ? options.agentId : undefined;
    const record: ExecutionRecord = {
      operationId: intent.operationId,
      idempotencyKey,
      state: "discovered",
      version: 0,
      intent: structuredClone(intent),
      createdAt: now,
      updatedAt: now,
      events: [event],
      ...(agentId === undefined ? {} : { agentId })
    };
    this.#operationsByKey.set(idempotencyKey, intent.operationId);
    this.#records.set(intent.operationId, record);
    return { record: structuredClone(record), created: true };
  }

  async get(operationId: string): Promise<ExecutionRecord | undefined> {
    const record = this.#records.get(operationId);
    return record === undefined ? undefined : structuredClone(record);
  }

  async transition(input: {
    operationId: string;
    expectedVersion: number;
    to: ExecutionState;
    kind: string;
    details?: Record<string, string | number | boolean | null>;
    now?: Date;
  }): Promise<ExecutionRecord> {
    const current = this.#records.get(input.operationId);
    if (current === undefined) throw new Error(`Execution not found: ${input.operationId}`);
    if (current.version !== input.expectedVersion) {
      throw new ExecutionVersionConflictError(input.operationId);
    }
    assertAllowedExecutionTransition(current.state, input.to);

    const at = (input.now ?? new Date()).toISOString();
    const nextVersion = current.version + 1;
    const event: ExecutionEvent = {
      id: randomUUID(),
      operationId: current.operationId,
      sequence: nextVersion,
      at,
      from: current.state,
      to: input.to,
      kind: input.kind,
      ...(input.details === undefined ? {} : { details: structuredClone(input.details) })
    };
    const next: ExecutionRecord = {
      ...current,
      state: input.to,
      version: nextVersion,
      updatedAt: at,
      events: [...current.events, event]
    };
    this.#records.set(input.operationId, next);
    return structuredClone(next);
  }

  async appendEvent(input: {
    operationId: string;
    expectedVersion: number;
    kind: string;
    details?: Record<string, string | number | boolean | null>;
    now?: Date;
  }): Promise<ExecutionRecord> {
    const current = this.#records.get(input.operationId);
    if (current === undefined) throw new Error(`Execution not found: ${input.operationId}`);
    if (current.version !== input.expectedVersion) {
      throw new ExecutionVersionConflictError(input.operationId);
    }

    const at = (input.now ?? new Date()).toISOString();
    const nextVersion = current.version + 1;
    const event: ExecutionEvent = {
      id: randomUUID(),
      operationId: current.operationId,
      sequence: nextVersion,
      at,
      from: current.state,
      to: current.state,
      kind: input.kind,
      ...(input.details === undefined ? {} : { details: structuredClone(input.details) })
    };
    const next: ExecutionRecord = {
      ...current,
      version: nextVersion,
      updatedAt: at,
      events: [...current.events, event]
    };
    this.#records.set(input.operationId, next);
    return structuredClone(next);
  }
}


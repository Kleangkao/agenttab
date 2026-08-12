import { describe, expect, it } from "vitest";
import {
  createIdempotencyKey,
  ExecutionVersionConflictError,
  InMemoryExecutionStore,
  InvalidExecutionTransitionError,
  type PaymentIntent
} from "../src/index.js";

const intent: PaymentIntent = {
  operationId: "research-job-7",
  requestHash: "sha256:0123456789abcdef",
  protocol: "x402",
  network: "solana:mainnet",
  merchantId: "data.example",
  merchantOrigin: "https://data.example",
  destination: "5C7sExampleMerchantDestination111111111111111111",
  assetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amountAtomic: "10000",
  amountUsdMicros: "10000",
  resource: "https://data.example/report"
};

describe("execution state", () => {
  it("returns the existing operation for an identical intent", async () => {
    const store = new InMemoryExecutionStore();
    const first = await store.createOrGet(intent);
    const second = await store.createOrGet({ ...intent });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.idempotencyKey).toBe(createIdempotencyKey(intent));
  });

  it("tracks funding, payment and fulfillment as separate phases", async () => {
    const store = new InMemoryExecutionStore();
    let { record } = await store.createOrGet(intent);
    record = await store.transition({
      operationId: record.operationId,
      expectedVersion: record.version,
      to: "approved",
      kind: "policy.allowed"
    });
    record = await store.transition({
      operationId: record.operationId,
      expectedVersion: record.version,
      to: "funding_submitted",
      kind: "funding.submitted"
    });
    record = await store.transition({
      operationId: record.operationId,
      expectedVersion: record.version,
      to: "funded",
      kind: "funding.confirmed",
      details: { signature: "funding-signature" }
    });
    record = await store.transition({
      operationId: record.operationId,
      expectedVersion: record.version,
      to: "payment_submitted",
      kind: "payment.submitted"
    });
    record = await store.transition({
      operationId: record.operationId,
      expectedVersion: record.version,
      to: "paid",
      kind: "payment.confirmed",
      details: { signature: "payment-signature" }
    });
    record = await store.transition({
      operationId: record.operationId,
      expectedVersion: record.version,
      to: "fulfilled",
      kind: "resource.fulfilled"
    });

    expect(record.state).toBe("fulfilled");
    expect(record.events).toHaveLength(7);
  });

  it("does not permit payment to be marked paid before submission", async () => {
    const store = new InMemoryExecutionStore();
    const { record } = await store.createOrGet(intent);
    await expect(
      store.transition({
        operationId: record.operationId,
        expectedVersion: record.version,
        to: "paid",
        kind: "payment.confirmed"
      })
    ).rejects.toBeInstanceOf(InvalidExecutionTransitionError);
  });

  it("rejects stale concurrent updates", async () => {
    const store = new InMemoryExecutionStore();
    const { record } = await store.createOrGet(intent);
    await store.transition({
      operationId: record.operationId,
      expectedVersion: record.version,
      to: "approved",
      kind: "policy.allowed"
    });

    await expect(
      store.transition({
        operationId: record.operationId,
        expectedVersion: record.version,
        to: "denied",
        kind: "policy.denied"
      })
    ).rejects.toBeInstanceOf(ExecutionVersionConflictError);
  });

  it("retries fulfillment without allowing another payment", async () => {
    const store = new InMemoryExecutionStore();
    let { record } = await store.createOrGet(intent);
    for (const [to, kind] of [
      ["approved", "policy.allowed"],
      ["payment_submitted", "payment.submitted"],
      ["paid", "payment.confirmed"],
      ["fulfillment_failed", "resource.failed"],
      ["fulfilled", "resource.fulfilled"]
    ] as const) {
      record = await store.transition({
        operationId: record.operationId,
        expectedVersion: record.version,
        to,
        kind
      });
    }
    expect(record.state).toBe("fulfilled");
    expect(record.events.filter(event => event.to === "paid")).toHaveLength(1);
  });

  it("appends audit events without changing state", async () => {
    const store = new InMemoryExecutionStore();
    const { record: created } = await store.createOrGet(intent);
    const locked = await store.appendEvent({
      operationId: created.operationId,
      expectedVersion: created.version,
      kind: "funding.attempt_locked",
      details: { deficitAtomic: "1" }
    });
    expect(locked.state).toBe("discovered");
    expect(locked.version).toBe(created.version + 1);
    expect(locked.events.at(-1)?.kind).toBe("funding.attempt_locked");
  });
});

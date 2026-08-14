import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIdempotencyKey,
  type PaymentIntent
} from "@agenttab/core";
import { LOCAL_NETWORK, USDC_MINT } from "../src/constants.js";
import { SqliteExecutionStore } from "../src/store/sqlite-execution-store.js";

const intent: PaymentIntent = {
  operationId: "sqlite-1",
  requestHash: "sha256:abcdef0123456789",
  protocol: "x402",
  network: LOCAL_NETWORK,
  merchantId: "merchant.local",
  merchantOrigin: "http://merchant.local",
  destination: "PaidApiMerchantDest11111111111111111111111",
  assetMint: USDC_MINT,
  amountAtomic: "1000000",
  amountUsdMicros: "1000000",
  resource: "http://merchant.local/v1/research"
};

describe("SqliteExecutionStore", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists idempotent create and transitions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenttab-"));
    dirs.push(dir);
    const store = new SqliteExecutionStore(join(dir, "test.db"));

    const first = await store.createOrGet(intent);
    const second = await store.createOrGet({ ...intent });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.idempotencyKey).toBe(createIdempotencyKey(intent));

    let record = await store.transition({
      operationId: intent.operationId,
      expectedVersion: 0,
      to: "approved",
      kind: "policy.allowed"
    });
    record = await store.transition({
      operationId: intent.operationId,
      expectedVersion: record.version,
      to: "funded",
      kind: "funding.not_required"
    });
    expect(record.state).toBe("funded");
    expect(record.events).toHaveLength(3);

    store.close();
    const reopened = new SqliteExecutionStore(join(dir, "test.db"));
    const loaded = await reopened.get(intent.operationId);
    expect(loaded?.state).toBe("funded");
    expect(loaded?.events).toHaveLength(3);
    reopened.close();
  });

  it("lists reusable executions by requestHash and skips fulfilled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenttab-"));
    dirs.push(dir);
    const store = new SqliteExecutionStore(join(dir, "hash.db"));
    const parked = await store.createOrGet({
      ...intent,
      operationId: "hash-parked",
      requestHash: "sha256:reusable-request-hash-001"
    });
    await store.transition({
      operationId: parked.record.operationId,
      expectedVersion: 0,
      to: "approval_required",
      kind: "policy.approval_required"
    });
    await store.createOrGet({
      ...intent,
      operationId: "hash-other",
      requestHash: "sha256:reusable-request-hash-002"
    });
    const done = await store.createOrGet({
      ...intent,
      operationId: "hash-done",
      requestHash: "sha256:reusable-request-hash-003"
    });
    let record = await store.transition({
      operationId: done.record.operationId,
      expectedVersion: 0,
      to: "approved",
      kind: "policy.allowed"
    });
    record = await store.transition({
      operationId: done.record.operationId,
      expectedVersion: record.version,
      to: "funded",
      kind: "funding.not_required"
    });
    record = await store.transition({
      operationId: done.record.operationId,
      expectedVersion: record.version,
      to: "payment_submitted",
      kind: "payment.submitted"
    });
    record = await store.transition({
      operationId: done.record.operationId,
      expectedVersion: record.version,
      to: "paid",
      kind: "payment.settled"
    });
    await store.transition({
      operationId: done.record.operationId,
      expectedVersion: record.version,
      to: "fulfilled",
      kind: "resource.fulfilled"
    });

    try {
      const reusable = await store.listRecent({
        requestHash: "sha256:reusable-request-hash-001",
        reusable: true,
        limit: 5
      });
      expect(reusable).toHaveLength(1);
      expect(reusable[0]?.operationId).toBe("hash-parked");
      expect(reusable[0]?.requestHash).toBe("sha256:reusable-request-hash-001");

      const finished = await store.listRecent({
        requestHash: "sha256:reusable-request-hash-003",
        reusable: true,
        limit: 5
      });
      expect(finished).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("persists agentId and lists by it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenttab-"));
    dirs.push(dir);
    const store = new SqliteExecutionStore(join(dir, "agent.db"));
    const created = await store.createOrGet(
      { ...intent, operationId: "agent-sqlite-1" },
      { agentId: "research" }
    );
    expect(created.record.agentId).toBe("research");
    store.close();
    const reopened = new SqliteExecutionStore(join(dir, "agent.db"));
    const loaded = await reopened.get("agent-sqlite-1");
    expect(loaded?.agentId).toBe("research");
    const listed = await reopened.listRecent({ agentId: "research", limit: 5 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.agentId).toBe("research");
    expect(await reopened.listRecent({ agentId: "ops", limit: 5 })).toHaveLength(0);
    try {
      await expect(
        reopened.createOrGet({ ...intent, operationId: "agent-sqlite-1" }, { agentId: "ops" })
      ).rejects.toMatchObject({ name: "AgentIdentityConflictError" });
    } finally {
      reopened.close();
    }
  });
});

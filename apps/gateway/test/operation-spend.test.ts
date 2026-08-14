import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SqliteSpendLedger } from "../src/store/sqlite-spend-ledger.js";
import { InMemorySpendLedger } from "../src/orchestrator/coordinator.js";
import { createGatewayRuntime } from "../src/app.js";
import { USDC_MINT, LOCAL_NETWORK } from "../src/constants.js";

describe("operation-keyed spend", () => {
  it("dedupes spend by operation id in sqlite", () => {
    const db = new DatabaseSync(":memory:");
    const ledger = new SqliteSpendLedger(db);
    expect(ledger.ensureOperationSpend("op-1", "1000")).toBe(true);
    expect(ledger.ensureOperationSpend("op-1", "1000")).toBe(false);
    expect(ledger.ensureOperationSpend("op-2", "500")).toBe(true);
    expect(ledger.getSpentUsdMicrosLast24h()).toBe("1500");
    db.close();
  });

  it("dedupes spend by operation id in memory", () => {
    const ledger = new InMemorySpendLedger();
    expect(ledger.ensureOperationSpend("op-1", "1000")).toBe(true);
    expect(ledger.ensureOperationSpend("op-1", "1000")).toBe(false);
    expect(ledger.getSpentUsdMicrosLast24h()).toBe("1000");
  });

  it("pay replay does not double-count daily spend", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://merchant.local",
      initialUsdcAtomic: "5000000"
    });
    const intent = {
      operationId: "spend-replay-1",
      requestHash: "sha256:spend-replay-hash-001",
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
    await gateway.coordinator.ensurePaymentAsset({ intent });
    const first = await gateway.app.request(`/v1/executions/${intent.operationId}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(first.status).toBe(200);
    expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("1000000");

    const second = await gateway.app.request(`/v1/executions/${intent.operationId}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(second.status).toBe(200);
    expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("1000000");
    gateway.close();
  });
});

function assertReserveContract(ledger: InMemorySpendLedger | SqliteSpendLedger): void {
  expect(ledger.tryReserveOperationSpend("c", "700000", "1500000")).toBe("reserved");
  expect(ledger.tryReserveOperationSpend("d", "700000", "1500000")).toBe("reserved");
  expect(ledger.getSpentUsdMicrosLast24h()).toBe("0");
  expect(ledger.releaseOperationSpend("c")).toBe(true);
  expect(ledger.releaseOperationSpend("d")).toBe(true);

  expect(ledger.tryReserveOperationSpend("a", "1000000", "1500000", "research")).toBe("reserved");
  expect(ledger.getSpentUsdMicrosLast24h()).toBe("0");
  expect(ledger.getSpentUsdMicrosLast24hByAgent()).toEqual({});
  expect(ledger.tryReserveOperationSpend("b", "1000000", "1500000")).toBe("cap_exceeded");
  expect(ledger.tryReserveOperationSpend("a", "1000000", "1500000")).toBe("duplicate");
  expect(ledger.ensureOperationSpend("a", "1000000", "research")).toBe(true);
  expect(ledger.getSpentUsdMicrosLast24h()).toBe("1000000");
  expect(ledger.getSpentUsdMicrosLast24hByAgent()).toEqual({ research: "1000000" });
  expect(ledger.ensureOperationSpend("a", "1000000", "research")).toBe(false);
  expect(ledger.releaseOperationSpend("a")).toBe(false);
  expect(ledger.getSpentUsdMicrosLast24h()).toBe("1000000");
}

function assertResumeDoesNotDoubleCount(ledger: InMemorySpendLedger | SqliteSpendLedger): void {
  expect(ledger.tryReserveOperationSpend("resume-a", "1000000", "1500000")).toBe("reserved");
  expect(ledger.tryReserveOperationSpend("resume-a", "1000000", "1500000")).toBe("duplicate");
  expect(ledger.tryReserveOperationSpend("peer", "1000000", "1500000")).toBe("cap_exceeded");
  expect(ledger.getSpentUsdMicrosLast24h()).toBe("0");
  expect(ledger.tryReserveOperationSpend("resume-a", "1000000", "500000")).toBe("cap_exceeded");
  expect(ledger.tryReserveOperationSpend("peer", "1000000", "1500000")).toBe("reserved");
  expect(ledger.getSpentUsdMicrosLast24h()).toBe("0");
}

describe("tryReserveOperationSpend", () => {
  it("enforces the cap atomically in memory without realizing spend", () => {
    assertReserveContract(new InMemorySpendLedger());
  });

  it("enforces the cap atomically in sqlite without realizing spend", () => {
    const db = new DatabaseSync(":memory:");
    try {
      assertReserveContract(new SqliteSpendLedger(db));
    } finally {
      db.close();
    }
  });

  it("counts a retained reservation once on resume in memory", () => {
    assertResumeDoesNotDoubleCount(new InMemorySpendLedger());
  });

  it("counts a retained reservation once on resume in sqlite", () => {
    const db = new DatabaseSync(":memory:");
    try {
      assertResumeDoesNotDoubleCount(new SqliteSpendLedger(db));
    } finally {
      db.close();
    }
  });
});

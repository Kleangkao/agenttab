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

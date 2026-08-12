import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PaymentIntent, PaymentPolicy } from "@agenttab/core";
import { LOCAL_NETWORK, USDC_MINT } from "../src/constants.js";
import { createGatewayRuntime } from "../src/app.js";
import { createDemoPolicy } from "../src/policy/store.js";
import { SqliteExecutionStore } from "../src/store/sqlite-execution-store.js";

const intent: PaymentIntent = {
  operationId: "policy-audit-1",
  requestHash: "sha256:abcdef0123456789policy",
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

describe("durable policy + audit list", () => {
  const dirs: string[] = [];
  const runtimes: Array<ReturnType<typeof createGatewayRuntime>> = [];

  afterEach(() => {
    while (runtimes.length > 0) {
      runtimes.pop()?.close();
    }
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists policy across gateway restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenttab-policy-"));
    dirs.push(dir);
    const dbPath = join(dir, "gateway.sqlite");
    const first = createGatewayRuntime({
      dbPath,
      merchantOrigin: "http://merchant.local"
    });
    runtimes.push(first);
    expect(first.policyDurable).toBe(true);

    const updated: PaymentPolicy = {
      ...createDemoPolicy("http://merchant.local"),
      mode: "approve",
      maxPaymentUsdMicros: "2500000"
    };
    const put = await first.app.request("/v1/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updated)
    });
    expect(put.status).toBe(200);
    first.close();
    runtimes.pop();

    const second = createGatewayRuntime({
      dbPath,
      merchantOrigin: "http://merchant.local",
      // Seed would be autopay demo; durable row must win.
      policy: createDemoPolicy("http://merchant.local")
    });
    runtimes.push(second);
    const loaded = second.policies.get();
    expect(loaded.mode).toBe("approve");
    expect(loaded.maxPaymentUsdMicros).toBe("2500000");
  });

  it("requires admin token for policy writes when configured", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://merchant.local",
      adminToken: "secret-admin"
    });
    runtimes.push(gateway);

    const denied = await gateway.app.request("/v1/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createDemoPolicy("http://merchant.local"))
    });
    expect(denied.status).toBe(401);

    const allowed = await gateway.app.request("/v1/policy", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret-admin"
      },
      body: JSON.stringify({
        ...createDemoPolicy("http://merchant.local"),
        mode: "observe"
      })
    });
    expect(allowed.status).toBe(200);
    expect(gateway.policies.get().mode).toBe("observe");
  });

  it("lists recent executions for read-only audit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenttab-audit-"));
    dirs.push(dir);
    const store = new SqliteExecutionStore(join(dir, "audit.db"));
    await store.createOrGet(intent);
    await store.createOrGet({
      ...intent,
      operationId: "policy-audit-2",
      requestHash: "sha256:abcdef0123456789policy2"
    });
    await store.transition({
      operationId: "policy-audit-2",
      expectedVersion: 0,
      to: "approved",
      kind: "policy.allowed"
    });

    const recent = await store.listRecent({ limit: 10 });
    expect(recent.length).toBe(2);
    expect(recent[0]?.operationId).toBe("policy-audit-2");
    expect(recent[0]?.lastEventKind).toBe("policy.allowed");

    const fulfilledOnly = await store.listRecent({ limit: 10, state: "fulfilled" });
    expect(fulfilledOnly).toHaveLength(0);

    store.close();

    const gateway = createGatewayRuntime({
      dbPath: join(dir, "audit.db"),
      merchantOrigin: "http://merchant.local"
    });
    runtimes.push(gateway);
    const response = await gateway.app.request("/v1/executions?limit=5");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      count: number;
      executions: Array<{ operationId: string }>;
    };
    expect(body.count).toBe(2);
    expect(body.executions[0]?.operationId).toBe("policy-audit-2");

    const invalidState = await gateway.app.request("/v1/executions?state=not-a-state");
    expect(invalidState.status).toBe(400);
    expect(await invalidState.json()).toMatchObject({ error: "invalid_state" });
  });

  it("rejects invalid policy payloads", async () => {
    const gateway = createGatewayRuntime({ merchantOrigin: "http://merchant.local" });
    runtimes.push(gateway);
    const response = await gateway.app.request("/v1/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "autopay" })
    });
    expect(response.status).toBe(400);
  });
});

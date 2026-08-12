import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import {
  createGatewayRuntime,
  loadPolicyFile,
  LOCAL_NETWORK,
  USDC_MINT
} from "../src/index.js";

describe("operator notify webhook", () => {
  it("POSTs on first park and on deny, not on preview or park replay", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const notifyFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return new Response("ok", { status: 204 });
    });
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy,
      notifyUrl: "http://notify.test/hook",
      notifyFetch: notifyFetch as unknown as typeof fetch,
      wallet: "NotifyBuyer11111111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    const health = await gateway.app.request("/health");
    expect(await health.json()).toMatchObject({ notifyConfigured: true });

    const intent = {
      operationId: "notify-park-1",
      requestHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      protocol: "x402",
      network: LOCAL_NETWORK,
      merchantId: "127.0.0.1:8791",
      merchantOrigin: "http://127.0.0.1:8791",
      destination: "NeutralMerchant111111111111111111111111111",
      assetMint: USDC_MINT,
      amountAtomic: "1000",
      amountUsdMicros: "1000",
      resource: "http://127.0.0.1:8791/v1/market-snapshot"
    };

    await gateway.app.request("/v1/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent)
    });
    expect(calls).toHaveLength(0);

    expect((await gateway.coordinator.ensurePaymentAsset({ intent })).status).toBe(
      "approval_required"
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "http://notify.test/hook",
      body: {
        event: "approval_required",
        operationId: "notify-park-1",
        state: "approval_required"
      }
    });

    expect((await gateway.coordinator.ensurePaymentAsset({ intent })).status).toBe(
      "approval_required"
    );
    expect(calls).toHaveLength(1);

    await gateway.app.request("/v1/denials/notify-park-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({
      event: "denied",
      operationId: "notify-park-1",
      state: "denied"
    });
    gateway.close();
  });

  it("does not fail funding when the webhook errors", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy,
      notifyUrl: "http://notify.test/hook",
      notifyFetch: (async () => {
        throw new Error("webhook down");
      }) as unknown as typeof fetch,
      initialUsdcAtomic: "0"
    });
    const outcome = await gateway.coordinator.ensurePaymentAsset({
      intent: {
        operationId: "notify-fail-open",
        requestHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        protocol: "x402",
        network: LOCAL_NETWORK,
        merchantId: "127.0.0.1:8791",
        merchantOrigin: "http://127.0.0.1:8791",
        destination: "NeutralMerchant111111111111111111111111111",
        assetMint: USDC_MINT,
        amountAtomic: "1000",
        amountUsdMicros: "1000",
        resource: "http://127.0.0.1:8791/v1/market-snapshot"
      }
    });
    expect(outcome.status).toBe("approval_required");
    expect((await gateway.store.get("notify-fail-open"))?.state).toBe("approval_required");
    gateway.close();
  });
});

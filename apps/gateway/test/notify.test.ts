import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import {
  createDemoPolicy,
  createGatewayRuntime,
  loadPolicyFile,
  LOCAL_NETWORK,
  USDC_MINT,
  DEFAULT_NOTIFY_ATTEMPT_TIMEOUT_MS,
  DEFAULT_NOTIFY_BUDGET_MS,
  notifyBoundsFromEnv,
  parseNotifyBoundMs,
  type SignableFundingPlan,
  type SignerBoundary
} from "../src/index.js";

describe("notify bound env parsing", () => {
  it("uses env values when they are finite and at least 1ms", () => {
    expect(
      notifyBoundsFromEnv({
        AGENTTAB_NOTIFY_BUDGET_MS: "5000",
        AGENTTAB_NOTIFY_ATTEMPT_TIMEOUT_MS: "1500"
      })
    ).toEqual({ budgetMs: 5000, attemptTimeoutMs: 1500 });
    expect(parseNotifyBoundMs(" 2000 ", DEFAULT_NOTIFY_BUDGET_MS)).toBe(2000);
  });

  it("falls back to defaults on missing, blank, non-numeric, or non-positive values", () => {
    expect(notifyBoundsFromEnv({})).toEqual({
      budgetMs: DEFAULT_NOTIFY_BUDGET_MS,
      attemptTimeoutMs: DEFAULT_NOTIFY_ATTEMPT_TIMEOUT_MS
    });
    expect(parseNotifyBoundMs(undefined, 300)).toBe(300);
    expect(parseNotifyBoundMs("", 300)).toBe(300);
    expect(parseNotifyBoundMs("   ", 300)).toBe(300);
    expect(parseNotifyBoundMs("abc", 300)).toBe(300);
    expect(parseNotifyBoundMs("NaN", 300)).toBe(300);
    expect(parseNotifyBoundMs("Infinity", 300)).toBe(300);
    expect(parseNotifyBoundMs("-1", 300)).toBe(300);
    expect(parseNotifyBoundMs("0", 300)).toBe(300);
    expect(
      notifyBoundsFromEnv({
        AGENTTAB_NOTIFY_BUDGET_MS: "nope",
        AGENTTAB_NOTIFY_ATTEMPT_TIMEOUT_MS: ""
      })
    ).toEqual({
      budgetMs: DEFAULT_NOTIFY_BUDGET_MS,
      attemptTimeoutMs: DEFAULT_NOTIFY_ATTEMPT_TIMEOUT_MS
    });
  });
});

describe("operator notify webhook", () => {
  it("POSTs on first park and on deny, not on preview or park replay", async () => {
    const calls: Array<{ url: string; body: unknown; signature: string | null }> = [];
    const notifyFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        signature: new Headers(init?.headers).get("x-agenttab-signature")
      });
      return new Response(null, { status: 204 });
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
    expect(await health.json()).toMatchObject({
      notifyConfigured: true,
      notifySigned: false
    });

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
      signature: null,
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
      notifyRetryDelayMs: 0,
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

  it("signs notify POSTs when a secret is configured", async () => {
    const { signNotifyBody, verifyNotifySignature } = await import("../src/notify.js");
    let rawBody = "";
    let signature: string | null = null;
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: loadPolicyFile(
        resolve(process.cwd(), "../../examples/policies/approve.local.json")
      ),
      notifyUrl: "http://notify.test/hook",
      notifySecret: "sink-secret",
      notifyFetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        rawBody = String(init?.body ?? "");
        signature = new Headers(init?.headers).get("x-agenttab-signature");
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
      initialUsdcAtomic: "0"
    });
    expect(await (await gateway.app.request("/health")).json()).toMatchObject({
      notifyConfigured: true,
      notifySigned: true
    });
    await gateway.coordinator.ensurePaymentAsset({
      intent: {
        operationId: "notify-signed-1",
        requestHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
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
    expect(signature).toBe(signNotifyBody(rawBody, "sink-secret"));
    expect(verifyNotifySignature(rawBody, signature ?? undefined, "sink-secret")).toBe(true);
    expect(verifyNotifySignature(rawBody, signature ?? undefined, "wrong")).toBe(false);
    gateway.close();
  });

  it("POSTs interrupted when a plan can be retried", async () => {
    const calls: unknown[] = [];
    const signer: SignerBoundary = {
      async signFundingTransaction(_plan: SignableFundingPlan) {
        throw new Error("simulated signer failure");
      }
    };
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: createDemoPolicy("http://127.0.0.1:8791"),
      notifyUrl: "http://notify.test/hook",
      notifyFetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(init?.body ? JSON.parse(String(init.body)) : null);
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
      signer,
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    const outcome = await gateway.coordinator.ensurePaymentAsset({
      intent: {
        operationId: "notify-interrupt-1",
        requestHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
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
    expect(outcome.status).toBe("interrupted");
    expect(calls[0]).toMatchObject({
      event: "interrupted",
      operationId: "notify-interrupt-1",
      state: "funding_submitted"
    });
    gateway.close();
  });

  it("retries a transient webhook failure and records the successful delivery", async () => {
    let calls = 0;
    const notifyFetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Response(null, { status: 204 });
    });
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: loadPolicyFile(
        resolve(process.cwd(), "../../examples/policies/approve.local.json")
      ),
      notifyUrl: "http://notify.test/hook",
      notifyFetch: notifyFetch as unknown as typeof fetch,
      notifyRetryDelayMs: 0,
      notifyMaxAttempts: 3,
      wallet: "NotifyRetryBuyer11111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    try {
      const intent = {
        operationId: "notify-retry-1",
        requestHash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
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
      expect((await gateway.coordinator.ensurePaymentAsset({ intent })).status).toBe(
        "approval_required"
      );
      expect((await gateway.store.get("notify-retry-1"))?.state).toBe("approval_required");
      expect(notifyFetch).toHaveBeenCalledTimes(2);
      const body = (await (
        await gateway.app.request("/v1/executions/notify-retry-1")
      ).json()) as {
        state: string;
        notifyDeliveries: Array<{ attempt: number; ok: boolean; status?: number; event: string }>;
      };
      expect(body.state).toBe("approval_required");
      expect(body.notifyDeliveries).toEqual([
        expect.objectContaining({
          event: "approval_required",
          attempt: 1,
          ok: false,
          status: 503
        }),
        expect.objectContaining({
          event: "approval_required",
          attempt: 2,
          ok: true,
          status: 204
        })
      ]);
    } finally {
      gateway.close();
    }
  });

  it("records a permanent webhook failure without reversing the parked operation", async () => {
    const notifyFetch = vi.fn(async () => {
      throw new Error("webhook down");
    });
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: loadPolicyFile(
        resolve(process.cwd(), "../../examples/policies/approve.local.json")
      ),
      notifyUrl: "http://notify.test/hook",
      notifyFetch: notifyFetch as unknown as typeof fetch,
      notifyRetryDelayMs: 0,
      notifyMaxAttempts: 3,
      wallet: "NotifyPermBuyer111111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    try {
      const intent = {
        operationId: "notify-permanent-1",
        requestHash: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
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
      expect((await gateway.coordinator.ensurePaymentAsset({ intent })).status).toBe(
        "approval_required"
      );
      expect((await gateway.store.get("notify-permanent-1"))?.state).toBe("approval_required");
      expect(notifyFetch).toHaveBeenCalledTimes(3);
      const body = (await (
        await gateway.app.request("/v1/executions/notify-permanent-1")
      ).json()) as {
        notifyDeliveries: Array<{ attempt: number; ok: boolean; error?: string }>;
      };
      expect(body.notifyDeliveries).toHaveLength(3);
      expect(body.notifyDeliveries.every((row) => row.ok === false)).toBe(true);
      expect(body.notifyDeliveries.map((row) => row.attempt)).toEqual([1, 2, 3]);
      expect(body.notifyDeliveries[0]?.error).toMatch(/webhook down/);
    } finally {
      gateway.close();
    }
  });

  it("parks within the notify budget when the webhook never responds", async () => {
    const notifyFetch = vi.fn(async () => new Promise<Response>(() => {}));
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: loadPolicyFile(
        resolve(process.cwd(), "../../examples/policies/approve.local.json")
      ),
      notifyUrl: "http://notify.test/hook",
      notifyFetch: notifyFetch as unknown as typeof fetch,
      notifyRetryDelayMs: 0,
      notifyMaxAttempts: 3,
      notifyBudgetMs: 50,
      notifyAttemptTimeoutMs: 20,
      wallet: "NotifyHangBuyer11111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    try {
      const started = Date.now();
      const intent = {
        operationId: "notify-hang-1",
        requestHash: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
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
      expect((await gateway.coordinator.ensurePaymentAsset({ intent })).status).toBe(
        "approval_required"
      );
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(250);
      expect((await gateway.store.get("notify-hang-1"))?.state).toBe("approval_required");
      const body = (await (
        await gateway.app.request("/v1/executions/notify-hang-1")
      ).json()) as {
        notifyDeliveries: Array<{ ok: boolean; status?: number; error?: string }>;
      };
      expect(body.notifyDeliveries.length).toBeGreaterThan(0);
      expect(body.notifyDeliveries.every((row) => row.ok === false)).toBe(true);
      expect(body.notifyDeliveries.some((row) => row.error === "timeout")).toBe(true);
      expect(body.notifyDeliveries.every((row) => row.status === undefined)).toBe(true);
    } finally {
      gateway.close();
    }
  });
});

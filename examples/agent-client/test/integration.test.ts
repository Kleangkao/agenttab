import { afterEach, describe, expect, it } from "vitest";
import {
  DEMO_PAYMENT_AMOUNT_ATOMIC,
  DEMO_PAYMENT_USD_MICROS,
  LOCAL_NETWORK,
  USDC_MINT,
  type PaymentIntent
} from "@agenttab/gateway";
import { createGatewayRuntime } from "@agenttab/gateway";
import { createPaidApi, DEMO_MERCHANT_DESTINATION } from "@agenttab/example-paid-api";
import { runAgentPurchase } from "../src/purchase.js";
import { createDemoPolicy } from "@agenttab/gateway";

const MERCHANT_ORIGIN = "http://merchant.local";
const RESOURCE_URL = `${MERCHANT_ORIGIN}/v1/research`;
const GATEWAY_ORIGIN = "http://gateway.local";

function intentFor(operationId: string, overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    operationId,
    requestHash: `sha256:request-hash-for-${operationId}`,
    protocol: "x402",
    network: LOCAL_NETWORK,
    merchantId: "merchant.local",
    merchantOrigin: MERCHANT_ORIGIN,
    destination: DEMO_MERCHANT_DESTINATION,
    assetMint: USDC_MINT,
    amountAtomic: DEMO_PAYMENT_AMOUNT_ATOMIC,
    amountUsdMicros: DEMO_PAYMENT_USD_MICROS,
    resource: RESOURCE_URL,
    ...overrides
  };
}

function createFetch(gateway: ReturnType<typeof createGatewayRuntime>, paid: ReturnType<typeof createPaidApi>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    if (parsed.origin === GATEWAY_ORIGIN) {
      return gateway.app.request(path, init);
    }
    if (parsed.origin === MERCHANT_ORIGIN) {
      return paid.request(path, init);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
}

describe("local vertical slice", () => {
  const runtimes: Array<ReturnType<typeof createGatewayRuntime>> = [];

  afterEach(() => {
    while (runtimes.length > 0) {
      runtimes.pop()?.close();
    }
  });

  it("funds only the USDC deficit, pays, and fulfills the research resource", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: MERCHANT_ORIGIN,
      initialUsdcAtomic: "200000",
      initialSolAtomic: "5000000000"
    });
    runtimes.push(gateway);
    const paid = createPaidApi({
      origin: MERCHANT_ORIGIN,
      paymentHmacSecret: gateway.paymentHmacSecret
    });
    const fetchImpl = createFetch(gateway, paid);

    const usdcBefore = gateway.balances.get(USDC_MINT)!.balanceAtomic;
    const result = await runAgentPurchase({
      gatewayBaseUrl: GATEWAY_ORIGIN,
      resourceUrl: RESOURCE_URL,
      fetchImpl,
      operationId: "hero-demo-1"
    });

    expect(["funded", "already_funded"]).toContain(result.funding.status);
    expect(result.resource).toMatchObject({ paid: true, operationId: "hero-demo-1" });
    expect((result.execution as { state: string }).state).toBe("fulfilled");

    const usdcAfter = BigInt(gateway.balances.get(USDC_MINT)!.balanceAtomic);
    expect(usdcAfter).toBeGreaterThanOrEqual(BigInt(DEMO_PAYMENT_AMOUNT_ATOMIC));
    expect(BigInt(usdcAfter) - BigInt(usdcBefore)).toBeGreaterThan(0n);
    expect(gateway.dflow.orders).toHaveLength(1);
    expect(BigInt(gateway.dflow.orders[0]!.outputAmountAtomic)).toBeGreaterThanOrEqual(
      BigInt(DEMO_PAYMENT_AMOUNT_ATOMIC) - BigInt(usdcBefore)
    );
  });

  it("skips funding when the wallet already holds enough USDC", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: MERCHANT_ORIGIN,
      initialUsdcAtomic: "5000000"
    });
    runtimes.push(gateway);
    const paid = createPaidApi({
      origin: MERCHANT_ORIGIN,
      paymentHmacSecret: gateway.paymentHmacSecret
    });

    const result = await runAgentPurchase({
      gatewayBaseUrl: GATEWAY_ORIGIN,
      resourceUrl: RESOURCE_URL,
      fetchImpl: createFetch(gateway, paid),
      operationId: "already-funded-1"
    });

    expect(result.funding.status).toBe("already_funded");
    expect(gateway.dflow.orders).toHaveLength(0);
    expect((result.execution as { state: string }).state).toBe("fulfilled");
  });

  it("denies a merchant outside the allowlist", async () => {
    const gateway = createGatewayRuntime({ merchantOrigin: MERCHANT_ORIGIN });
    runtimes.push(gateway);
    const outcome = await gateway.coordinator.ensurePaymentAsset({
      intent: intentFor("deny-merchant", {
        merchantOrigin: "https://evil.example",
        resource: "https://evil.example/v1/research"
      })
    });
    expect(outcome.status).toBe("denied");
    const record = await gateway.store.get("deny-merchant");
    expect(record?.state).toBe("denied");
    expect(gateway.dflow.orders).toHaveLength(0);
  });

  it("requires approval and continues only after approval", async () => {
    const policy = createDemoPolicy(MERCHANT_ORIGIN);
    policy.mode = "approve";
    const gateway = createGatewayRuntime({
      merchantOrigin: MERCHANT_ORIGIN,
      policy,
      initialUsdcAtomic: "200000"
    });
    runtimes.push(gateway);

    const first = await gateway.coordinator.ensurePaymentAsset({
      intent: intentFor("needs-approval")
    });
    expect(first.status).toBe("approval_required");
    expect(gateway.dflow.orders).toHaveLength(0);

    const approval = await gateway.app.request("/v1/approvals/needs-approval", { method: "POST" });
    expect(approval.status).toBe(200);
    const body = (await approval.json()) as {
      outcome: { status: string };
      record: { state: string };
    };
    expect(body.outcome.status).toBe("funded");
    expect(body.record.state).toBe("funded");
    expect(gateway.dflow.orders).toHaveLength(1);
  });

  it("does not fund or pay twice for the same idempotent binding", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: MERCHANT_ORIGIN,
      initialUsdcAtomic: "200000"
    });
    runtimes.push(gateway);
    const paid = createPaidApi({
      origin: MERCHANT_ORIGIN,
      paymentHmacSecret: gateway.paymentHmacSecret
    });
    const fetchImpl = createFetch(gateway, paid);

    const first = await runAgentPurchase({
      gatewayBaseUrl: GATEWAY_ORIGIN,
      resourceUrl: RESOURCE_URL,
      fetchImpl,
      operationId: "dup-1"
    });
    const secondFund = await gateway.coordinator.ensurePaymentAsset({
      intent: intentFor("dup-1", { requestHash: first.requestHash })
    });
    const secondPay = await gateway.app.request("/v1/executions/dup-1/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const payBody = (await secondPay.json()) as { replayed?: boolean; token?: string };

    expect(secondFund.status).toBe("already_funded");
    expect(gateway.dflow.orders).toHaveLength(1);
    expect(payBody.replayed).toBe(true);
    expect(payBody.token).toBe(first.paymentToken);
  });

  it("marks funding failure without attempting payment", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: MERCHANT_ORIGIN,
      initialUsdcAtomic: "200000",
      failFunding: true
    });
    runtimes.push(gateway);

    const outcome = await gateway.coordinator.ensurePaymentAsset({
      intent: intentFor("fund-fail")
    });
    expect(outcome.status).toBe("denied");
    const record = await gateway.store.get("fund-fail");
    expect(record?.state).toBe("failed");

    const pay = await gateway.app.request("/v1/executions/fund-fail/pay", {
      method: "POST",
      body: "{}"
    });
    expect(pay.status).toBe(409);
  });

  it("keeps funding when payment fails and does not re-fund on retry", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: MERCHANT_ORIGIN,
      initialUsdcAtomic: "200000"
    });
    runtimes.push(gateway);

    const funded = await gateway.coordinator.ensurePaymentAsset({
      intent: intentFor("pay-fail")
    });
    expect(funded.status).toBe("funded");
    const ordersAfterFund = gateway.dflow.orders.length;

    const pay = await gateway.app.request("/v1/executions/pay-fail/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fail: true })
    });
    expect(pay.status).toBe(502);
    const afterFail = await gateway.store.get("pay-fail");
    expect(afterFail?.state).toBe("payment_submitted");

    const again = await gateway.coordinator.ensurePaymentAsset({
      intent: intentFor("pay-fail")
    });
    expect(again.status).toBe("already_funded");
    expect(gateway.dflow.orders).toHaveLength(ordersAfterFund);

    const retryPay = await gateway.app.request("/v1/executions/pay-fail/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(retryPay.status).toBe(200);
    expect(gateway.dflow.orders).toHaveLength(ordersAfterFund);
  });

  it("retries fulfillment after paid without issuing a second payment", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: MERCHANT_ORIGIN,
      initialUsdcAtomic: "5000000"
    });
    runtimes.push(gateway);

    await gateway.coordinator.ensurePaymentAsset({ intent: intentFor("fulfill-retry") });
    const pay = await gateway.app.request("/v1/executions/fulfill-retry/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const payBody = (await pay.json()) as { token: string };
    expect(pay.status).toBe(200);

    const failFulfill = await gateway.app.request("/v1/executions/fulfill-retry/fulfill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fail: true })
    });
    expect(failFulfill.status).toBe(502);

    const retryPay = await gateway.app.request("/v1/executions/fulfill-retry/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const retryPayBody = (await retryPay.json()) as { replayed?: boolean; token?: string };
    expect(retryPayBody.replayed).toBe(true);
    expect(retryPayBody.token).toBe(payBody.token);

    const fulfill = await gateway.app.request("/v1/executions/fulfill-retry/fulfill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ responseHash: "sha256:ok" })
    });
    const fulfillBody = (await fulfill.json()) as { record: { state: string } };
    expect(fulfillBody.record.state).toBe("fulfilled");
  });
});

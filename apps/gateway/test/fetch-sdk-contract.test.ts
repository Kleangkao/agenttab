import { describe, expect, it } from "vitest";
import {
  createGatewayAuditRecorder,
  createGatewayFundingCoordinator,
  hashHttpRequest
} from "@agenttab/fetch";
import { createGatewayRuntime, createDemoPolicy, USDC_MINT } from "../src/index.js";

/**
 * Proves `@agenttab/fetch` gateway HTTP helpers speak the live control-plane
 * contract (fund → pay → fulfill) without embedding the gateway in the SDK.
 */
describe("@agenttab/fetch gateway HTTP contract", () => {
  it("funds and audits through gateway.app.request as fetchImpl", async () => {
    const merchantOrigin = "http://merchant.local";
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: createDemoPolicy(merchantOrigin),
      wallet: "Buyer1111111111111111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    const gatewayFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = String(input instanceof Request ? input.url : input);
      const path = raw.startsWith("http")
        ? `${new URL(raw).pathname}${new URL(raw).search}`
        : raw;
      return gateway.app.request(path, init);
    }) as typeof fetch;

    const coordinator = createGatewayFundingCoordinator({
      baseUrl: "http://agenttab.local",
      fetchImpl: gatewayFetch
    });
    const audit = createGatewayAuditRecorder({
      baseUrl: "http://agenttab.local",
      fetchImpl: gatewayFetch
    });

    const operationId = "fetch-sdk-contract-1";
    const resource = `${merchantOrigin}/v1/research`;
    const intent = {
      operationId,
      requestHash: hashHttpRequest("GET", resource, ""),
      protocol: "x402",
      network: "solana:local",
      merchantId: "merchant.local",
      merchantOrigin,
      destination: "Dest11111111111111111111111111111111111111",
      assetMint: USDC_MINT,
      amountAtomic: "1000",
      amountUsdMicros: "1000",
      resource
    };

    const outcome = await coordinator.ensurePaymentAsset({ intent });
    expect(outcome.status === "funded" || outcome.status === "already_funded").toBe(true);

    await audit.recordPayment({
      operationId,
      settlementId: "settle-contract-1",
      transaction: "settle-contract-1"
    });
    await audit.recordFulfillment({
      operationId,
      responseHash: hashHttpRequest("RESPONSE", resource, "{}")
    });

    const record = await gateway.store.get(operationId);
    expect(record?.state).toBe("fulfilled");
    gateway.close();
  });
});

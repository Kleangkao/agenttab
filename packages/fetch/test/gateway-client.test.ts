import { describe, expect, it, vi } from "vitest";
import type { FundingOutcome, PaymentIntent } from "@agenttab/core";
import {
  createGatewayAuditRecorder,
  createGatewayFundingCoordinator
} from "../src/gateway-client.js";
import { createGatewayClient } from "../src/gateway-api.js";
import { hashHttpRequest } from "../src/hash.js";

describe("hashHttpRequest", () => {
  it("matches the demo canonical format", () => {
    const hash = hashHttpRequest("GET", "http://merchant.local/v1/research", "");
    expect(hash.startsWith("sha256:")).toBe(true);
    expect(hash.length).toBe("sha256:".length + 64);
  });
});

describe("createGatewayFundingCoordinator", () => {
  it("posts PaymentIntent to /v1/fund and returns outcome", async () => {
    const intent: PaymentIntent = {
      operationId: "op-1",
      requestHash: hashHttpRequest("GET", "http://merchant.local/v1/x", ""),
      protocol: "x402",
      network: "solana:mainnet",
      merchantId: "merchant.local",
      merchantOrigin: "http://merchant.local",
      destination: "Destination1111111111111111111111111111111",
      assetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amountAtomic: "1000",
      resource: "http://merchant.local/v1/x"
    };
    const outcome: FundingOutcome = {
      status: "funded",
      reason: "exact_deficit"
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://gateway.test/v1/fund");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as PaymentIntent;
      expect(body.operationId).toBe("op-1");
      return Response.json({ outcome });
    });

    const coordinator = createGatewayFundingCoordinator({
      baseUrl: "http://gateway.test/",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(coordinator.ensurePaymentAsset({ intent })).resolves.toEqual(outcome);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("throws on non-OK gateway responses", async () => {
    const coordinator = createGatewayFundingCoordinator({
      baseUrl: "http://gateway.test",
      fetchImpl: (async () =>
        Response.json({ error: "denied" }, { status: 403 })) as unknown as typeof fetch
    });
    await expect(
      coordinator.ensurePaymentAsset({
        intent: {
          operationId: "op-2",
          requestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          protocol: "x402",
          network: "solana:mainnet",
          merchantId: "merchant.local",
          merchantOrigin: "http://merchant.local",
          destination: "Destination1111111111111111111111111111111",
          assetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountAtomic: "1000",
          resource: "http://merchant.local/v1/x"
        }
      })
    ).rejects.toThrow(/fund failed/);
  });
});

describe("createGatewayAuditRecorder", () => {
  it("records pay then fulfill", async function () {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return Response.json({ ok: true });
    });
    const audit = createGatewayAuditRecorder({
      baseUrl: "http://gateway.test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await audit.recordPayment({
      operationId: "op-3",
      settlementId: "settle-1",
      transaction: "settle-1"
    });
    await audit.recordFulfillment({
      operationId: "op-3",
      responseHash: hashHttpRequest("RESPONSE", "http://merchant.local/v1/x", "{}")
    });

    expect(calls[0]?.url).toBe("http://gateway.test/v1/executions/op-3/pay");
    expect(calls[0]?.body).toEqual({
      settlementId: "settle-1",
      transaction: "settle-1"
    });
    expect(calls[1]?.url).toBe("http://gateway.test/v1/executions/op-3/fulfill");
  });
});

describe("createGatewayClient.preview", () => {
  it("posts to /v1/preview and returns the decision", async () => {
    const intent: PaymentIntent = {
      operationId: "preview-1",
      requestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      protocol: "x402",
      network: "solana:local",
      merchantId: "merchant.local",
      merchantOrigin: "http://merchant.local",
      destination: "Destination1111111111111111111111111111111",
      assetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amountAtomic: "1000",
      amountUsdMicros: "1000",
      resource: "http://merchant.local/v1/x"
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://gateway.test/v1/preview");
      expect(init?.method).toBe("POST");
      return Response.json({
        preview: true,
        funded: false,
        policyMode: "approve",
        decision: { kind: "approval_required", reason: "allowed", message: "needs review" },
        hint: "did not fund",
        observeIsNotDryRun: false
      });
    });
    const client = createGatewayClient({
      baseUrl: "http://gateway.test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(client.preview(intent)).resolves.toMatchObject({
      preview: true,
      funded: false,
      decision: { kind: "approval_required" }
    });
  });

  it("posts to /v1/denials/:id", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://gateway.test/v1/denials/op-deny");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ reason: "nope" });
      return Response.json({ denied: true, funded: false, record: { state: "denied" } });
    });
    const client = createGatewayClient({
      baseUrl: "http://gateway.test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(client.deny("op-deny", "nope")).resolves.toMatchObject({
      denied: true,
      record: { state: "denied" }
    });
  });
});

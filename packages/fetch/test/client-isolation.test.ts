import { describe, expect, it, vi } from "vitest";
import type { SchemeNetworkClient } from "@x402/core/types";
import { createAgentTabFetch, getAgentTabMeta } from "../src/create-fetch.js";
import { createAgentTabClient } from "../src/client.js";
import { stablecoinAtomicAsUsdMicros } from "../src/usd.js";

function encodePaymentRequired(url: string): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url },
      accepts: [
        {
          scheme: "exact",
          network: "solana:test",
          asset: "Asset1111111111111111111111111111111111111",
          amount: "1000",
          payTo: "PayTo1111111111111111111111111111111111111",
          maxTimeoutSeconds: 60,
          extra: {}
        }
      ]
    }),
    "utf8"
  ).toString("base64");
}

function mockScheme(): SchemeNetworkClient {
  return {
    scheme: "exact",
    createPaymentPayload: async () => ({
      x402Version: 2,
      payload: { transaction: "fake-tx" }
    })
  };
}

describe("stablecoinAtomicAsUsdMicros", () => {
  it("maps 6-decimal atomic units 1:1", () => {
    expect(stablecoinAtomicAsUsdMicros("1000")).toBe("1000");
  });
});

describe("gatewayFetchImpl isolation", () => {
  it("keeps merchant fetchImpl separate from gateway HTTP", async () => {
    const merchantCalls: string[] = [];
    const gatewayCalls: string[] = [];

    let merchantHits = 0;
    const merchantFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      merchantCalls.push(url);
      merchantHits += 1;
      if (merchantHits === 1) {
        return new Response(JSON.stringify({ error: "payment_required" }), {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": encodePaymentRequired(url),
            "content-type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "PAYMENT-RESPONSE": "settle-iso",
          "content-type": "application/json"
        }
      });
    });

    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      gatewayCalls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/v1/fund")) {
        return Response.json({
          outcome: { status: "funded", reason: "exact_deficit" }
        });
      }
      if (url.includes("/pay") || url.includes("/fulfill")) {
        return Response.json({ ok: true });
      }
      if (url.includes("/v1/executions/")) {
        return Response.json({
          operationId: "op-iso",
          state: "fulfilled"
        });
      }
      return new Response("unexpected gateway", { status: 500 });
    });

    const client = createAgentTabClient({
      gatewayBaseUrl: "http://gateway.test",
      gatewayFetchImpl: gatewayFetch as unknown as typeof fetch,
      fetchImpl: merchantFetch as unknown as typeof fetch,
      schemes: [{ network: "solana:test", client: mockScheme() }],
      getUsdValueMicros: async ({ amountAtomic }) =>
        stablecoinAtomicAsUsdMicros(amountAtomic),
      createOperationId: () => "op-iso"
    });

    const response = await client.fetch("http://merchant.local/v1/market-snapshot");
    expect(response.status).toBe(200);
    expect(getAgentTabMeta(response)?.auditRecorded).toBe(true);

    expect(merchantCalls.every((url) => url.includes("merchant.local"))).toBe(true);
    expect(gatewayCalls.some((line) => line.includes("/v1/fund"))).toBe(true);
    expect(gatewayCalls.some((line) => line.includes("/pay"))).toBe(true);
    expect(gatewayCalls.some((line) => line.includes("/fulfill"))).toBe(true);
    expect(merchantCalls.some((url) => url.includes("gateway.test"))).toBe(false);

    const execution = await client.getExecution("op-iso");
    expect(execution).toMatchObject({ state: "fulfilled" });
  });
});

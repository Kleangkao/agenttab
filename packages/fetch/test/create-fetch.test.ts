import { describe, expect, it, vi } from "vitest";
import type { FundingOutcome } from "@agenttab/core";
import type { SchemeNetworkClient } from "@x402/core/types";
import {
  createAgentTabFetch,
  getAgentTabMeta
} from "../src/create-fetch.js";
import type { AgentTabAuditRecorder } from "../src/gateway-client.js";

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

describe("createAgentTabFetch", () => {
  it("requires a funding source", () => {
    expect(() =>
      createAgentTabFetch({
        schemes: [
          {
            network: "solana:test",
            client: {
              scheme: "exact",
              createPaymentPayload: async () => ({
                accepted: {
                  scheme: "exact",
                  network: "solana:test",
                  amount: "1000",
                  asset: "Asset1111111111111111111111111111111111111",
                  payTo: "PayTo1111111111111111111111111111111111111",
                  maxTimeoutSeconds: 60,
                  extra: {}
                },
                payload: { transaction: "fake-tx" }
              })
            } as SchemeNetworkClient
          }
        ]
      })
    ).toThrow(/coordinator|gatewayBaseUrl/);
  });

  it("requires schemes or x402Client", () => {
    expect(() =>
      createAgentTabFetch({
        coordinator: {
          ensurePaymentAsset: async () => ({ status: "funded", reason: "x" })
        }
      })
    ).toThrow(/schemes|x402Client/);
  });

  it("funds via coordinator, pays via wrapped fetch path, and records audit", async () => {
    const coordinator = {
      ensurePaymentAsset: vi.fn(async () => {
        const outcome: FundingOutcome = { status: "funded", reason: "test" };
        return outcome;
      })
    };

    const auditCalls: string[] = [];
    const audit: AgentTabAuditRecorder = {
      recordPayment: vi.fn(async () => {
        auditCalls.push("pay");
      }),
      recordFulfillment: vi.fn(async () => {
        auditCalls.push("fulfill");
      })
    };

    let merchantCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("merchant.local")) {
        return new Response("unexpected", { status: 500 });
      }
      merchantCalls += 1;
      if (merchantCalls === 1) {
        return new Response(JSON.stringify({ error: "payment_required" }), {
          status: 402,
          headers: {
            "content-type": "application/json",
            "PAYMENT-REQUIRED": encodePaymentRequired(url)
          }
        });
      }
      return new Response(JSON.stringify({ ok: true, paid: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "PAYMENT-RESPONSE": "settle-demo-1"
        }
      });
    });

    const schemeClient: SchemeNetworkClient = {
      scheme: "exact",
      createPaymentPayload: async () => ({
        x402Version: 2,
        accepted: {
          scheme: "exact",
          network: "solana:test",
          amount: "1000",
          asset: "Asset1111111111111111111111111111111111111",
          payTo: "PayTo1111111111111111111111111111111111111",
          maxTimeoutSeconds: 60,
          extra: {}
        },
        payload: { transaction: "fake-tx" }
      })
    };

    const fetchPaid = createAgentTabFetch({
      schemes: [{ network: "solana:test", client: schemeClient }],
      coordinator,
      audit,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic,
      createOperationId: () => "op-fetch-1"
    });

    const response = await fetchPaid("http://merchant.local/v1/research", {
      method: "GET"
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, paid: true });

    const meta = getAgentTabMeta(response);
    expect(meta?.operationId).toBe("op-fetch-1");
    expect(meta?.merchantId).toBe("merchant.local");
    expect(meta?.auditRecorded).toBe(true);
    expect(auditCalls).toEqual(["pay", "fulfill"]);
    expect(coordinator.ensurePaymentAsset).toHaveBeenCalled();
    const intent = coordinator.ensurePaymentAsset.mock.calls[0]?.[0]?.intent;
    expect(intent?.operationId).toBe("op-fetch-1");
    expect(intent?.amountAtomic).toBe("1000");
  });
});

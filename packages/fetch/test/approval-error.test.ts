import { describe, expect, it, vi } from "vitest";
import type { FundingOutcome } from "@agenttab/core";
import type { SchemeNetworkClient } from "@x402/core/types";
import { createAgentTabFetch } from "../src/create-fetch.js";
import {
  AgentTabApprovalRequiredError,
  isAgentTabApprovalRequiredError
} from "../src/errors.js";

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

describe("AgentTabApprovalRequiredError", () => {
  it("surfaces operationId so agents can approve and retry the same id", async () => {
    const coordinator = {
      ensurePaymentAsset: vi.fn(async () => {
        const outcome: FundingOutcome = {
          status: "approval_required",
          reason: "A human approval is required by policy."
        };
        return outcome;
      })
    };

    let merchantCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      merchantCalls += 1;
      if (merchantCalls === 1) {
        return new Response(JSON.stringify({ error: "payment_required" }), {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": encodePaymentRequired(url),
            "content-type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const fetchPaid = createAgentTabFetch({
      schemes: [{ network: "solana:test", client: mockScheme() }],
      coordinator,
      recordAudit: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic,
      createOperationId: () => "op-approve-recoverable"
    });

    await expect(fetchPaid("http://merchant.local/v1/x")).rejects.toSatisfy(
      (error: unknown) =>
        isAgentTabApprovalRequiredError(error) &&
        (error as AgentTabApprovalRequiredError).operationId === "op-approve-recoverable"
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import type { FundingOutcome, PaymentIntent } from "@agenttab/core";
import type { SchemeNetworkClient } from "@x402/core/types";
import { createAgentTabFetch } from "../src/create-fetch.js";
import {
  isAgentTabAlreadyPaidError,
  isAgentTabApprovalRequiredError,
  isAgentTabFundingInterruptedError
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

function merchant402Then200(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const hasPayment =
      input instanceof Request &&
      (input.headers.has("PAYMENT-SIGNATURE") || input.headers.has("X-PAYMENT"));
    if (!hasPayment) {
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
        "PAYMENT-RESPONSE": "settle-retry",
        "content-type": "application/json"
      }
    });
  }) as unknown as typeof fetch;
}

describe("sticky approval operationId", () => {
  it("retries the same operationId after approval without createOperationId", async () => {
    const seen: string[] = [];
    let allowFund = false;
    const coordinator = {
      ensurePaymentAsset: vi.fn(async ({ intent }: { intent: PaymentIntent }) => {
        seen.push(intent.operationId);
        if (!allowFund) {
          const outcome: FundingOutcome = {
            status: "approval_required",
            reason: "A human approval is required by policy."
          };
          return outcome;
        }
        const outcome: FundingOutcome = { status: "funded", reason: "approved" };
        return outcome;
      })
    };

    const fetchPaid = createAgentTabFetch({
      schemes: [{ network: "solana:test", client: mockScheme() }],
      coordinator,
      recordAudit: false,
      fetchImpl: merchant402Then200(),
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic
    });

    const first = fetchPaid("http://merchant.local/v1/x");
    await expect(first).rejects.toSatisfy(isAgentTabApprovalRequiredError);
    const error = await first.catch((value: unknown) => value);
    if (!isAgentTabApprovalRequiredError(error)) throw error;

    allowFund = true;
    const response = await fetchPaid("http://merchant.local/v1/x");
    expect(response.status).toBe(200);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[1]).toBe(error.operationId);
    expect(new Set(seen).size).toBe(1);
  });

  it("a new fetch instance reuses a lookupPendingOperationId from the gateway", async () => {
    const parkedId = "agenttab-parked-across-process";
    const lookup = vi.fn(async () => parkedId);
    let allowFund = false;
    const seen: string[] = [];
    const coordinator = {
      ensurePaymentAsset: vi.fn(async ({ intent }: { intent: PaymentIntent }) => {
        seen.push(intent.operationId);
        if (!allowFund) {
          const outcome: FundingOutcome = {
            status: "approval_required",
            reason: "A human approval is required by policy."
          };
          return outcome;
        }
        const outcome: FundingOutcome = { status: "funded", reason: "approved" };
        return outcome;
      })
    };

    const fetchPaid = createAgentTabFetch({
      schemes: [{ network: "solana:test", client: mockScheme() }],
      coordinator,
      recordAudit: false,
      fetchImpl: merchant402Then200(),
      lookupPendingOperationId: lookup,
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic
    });

    allowFund = true;
    const response = await fetchPaid("http://merchant.local/v1/x");
    expect(response.status).toBe(200);
    expect(lookup).toHaveBeenCalledOnce();
    expect(seen[0]).toBe(parkedId);
  });

  it("retries the same operationId after a retryable funding interrupt", async () => {
    const seen: string[] = [];
    let allowFund = false;
    const coordinator = {
      ensurePaymentAsset: vi.fn(async ({ intent }: { intent: PaymentIntent }) => {
        seen.push(intent.operationId);
        if (!allowFund) {
          const outcome: FundingOutcome = {
            status: "interrupted",
            reason: "signer failed (plan receipt retained; retry to re-sign without re-plan)"
          };
          return outcome;
        }
        const outcome: FundingOutcome = { status: "funded", reason: "resumed" };
        return outcome;
      })
    };

    const fetchPaid = createAgentTabFetch({
      schemes: [{ network: "solana:test", client: mockScheme() }],
      coordinator,
      recordAudit: false,
      fetchImpl: merchant402Then200(),
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic
    });

    const first = fetchPaid("http://merchant.local/v1/x");
    await expect(first).rejects.toSatisfy(isAgentTabFundingInterruptedError);
    const error = await first.catch((value: unknown) => value);
    if (!isAgentTabFundingInterruptedError(error)) throw error;

    allowFund = true;
    const response = await fetchPaid("http://merchant.local/v1/x");
    expect(response.status).toBe(200);
    expect(seen[1]).toBe(error.operationId);
    expect(new Set(seen).size).toBe(1);
  });

  it("does not create a second x402 payload for the same operationId", async () => {
    let payloads = 0;
    const scheme: SchemeNetworkClient = {
      scheme: "exact",
      createPaymentPayload: async () => {
        payloads += 1;
        return { x402Version: 2, payload: { transaction: "fake-tx" } };
      }
    };
    const coordinator = {
      ensurePaymentAsset: vi.fn(async () => {
        const outcome: FundingOutcome = { status: "funded", reason: "ok" };
        return outcome;
      })
    };
    const fetchPaid = createAgentTabFetch({
      schemes: [{ network: "solana:test", client: scheme }],
      coordinator,
      recordAudit: false,
      fetchImpl: merchant402Then200(),
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic,
      createOperationId: () => "op-pay-once"
    });

    const first = await fetchPaid("http://merchant.local/v1/x");
    expect(first.status).toBe(200);
    expect(payloads).toBe(1);

    await expect(fetchPaid("http://merchant.local/v1/x")).rejects.toSatisfy(
      isAgentTabAlreadyPaidError
    );
    expect(payloads).toBe(1);
  });

  it("continues the original request when already_paid and the merchant still serves it", async () => {
    let payloads = 0;
    let merchantCalls = 0;
    const scheme: SchemeNetworkClient = {
      scheme: "exact",
      createPaymentPayload: async () => {
        payloads += 1;
        return { x402Version: 2, payload: { transaction: "fake-tx" } };
      }
    };
    const coordinator = {
      ensurePaymentAsset: vi.fn(async () => {
        const outcome: FundingOutcome = { status: "funded", reason: "ok" };
        return outcome;
      })
    };
    const fetchPaid = createAgentTabFetch({
      schemes: [{ network: "solana:test", client: scheme }],
      coordinator,
      recordAudit: false,
      fetchImpl: (async (input: RequestInfo | URL) => {
        merchantCalls += 1;
        const url = String(input instanceof Request ? input.url : input);
        const hasPayment =
          input instanceof Request &&
          (input.headers.has("PAYMENT-SIGNATURE") || input.headers.has("X-PAYMENT"));
        if (merchantCalls === 1 && !hasPayment) {
          return new Response(JSON.stringify({ error: "payment_required" }), {
            status: 402,
            headers: {
              "PAYMENT-REQUIRED": encodePaymentRequired(url),
              "content-type": "application/json"
            }
          });
        }
        return new Response(JSON.stringify({ ok: true, replay: merchantCalls > 2 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as unknown as typeof fetch,
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic,
      createOperationId: () => "op-continue-paid"
    });

    const first = await fetchPaid("http://merchant.local/v1/x");
    expect(first.status).toBe(200);
    expect(payloads).toBe(1);

    const second = await fetchPaid("http://merchant.local/v1/x");
    expect(second.status).toBe(200);
    expect(payloads).toBe(1);
    await expect(second.json()).resolves.toMatchObject({ replay: true });
  });
});

import { describe, expect, it, vi } from "vitest";
import { createAgentTabFundingHook } from "../src/index.js";

const paymentRequired = {
  x402Version: 2,
  resource: { url: "https://ocr.example/v1/read" },
  accepts: []
};

const selectedRequirements = {
  scheme: "exact",
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const,
  asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: "30000",
  payTo: "5C7sExampleMerchantDestination111111111111111111",
  maxTimeoutSeconds: 60,
  extra: {}
};

describe("createAgentTabFundingHook", () => {
  it("funds before the official x402 client creates a payload", async () => {
    const ensurePaymentAsset = vi.fn().mockResolvedValue({
      status: "funded",
      reason: "deficit acquired"
    });
    const hook = createAgentTabFundingHook({
      coordinator: { ensurePaymentAsset },
      getRequestBinding: async () => ({
        operationId: "ocr-42",
        requestHash: "sha256:0123456789abcdef",
        merchantId: "ocr.example"
      }),
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic
    });

    await expect(hook({ paymentRequired, selectedRequirements })).resolves.toBeUndefined();
    expect(ensurePaymentAsset).toHaveBeenCalledWith({
      intent: expect.objectContaining({
        protocol: "x402",
        merchantOrigin: "https://ocr.example",
        amountUsdMicros: "30000"
      })
    });
  });

  it("aborts payment creation when funding requires approval", async () => {
    const hook = createAgentTabFundingHook({
      coordinator: {
        ensurePaymentAsset: async () => ({
          status: "approval_required",
          reason: "over threshold"
        })
      },
      getRequestBinding: async () => ({
        operationId: "ocr-43",
        requestHash: "sha256:fedcba9876543210",
        merchantId: "ocr.example"
      }),
      getUsdValueMicros: async () => "30000"
    });

    await expect(hook({ paymentRequired, selectedRequirements })).resolves.toMatchObject({
      abort: true,
      reason: expect.stringMatching(/agenttab:approval_required:.*"operationId":"ocr-43"/)
    });
  });

  it("aborts as interrupted when a plan receipt can be retried", async () => {
    const hook = createAgentTabFundingHook({
      coordinator: {
        ensurePaymentAsset: async () => ({
          status: "interrupted",
          reason: "signer failed (plan receipt retained; retry to re-sign without re-plan)"
        })
      },
      getRequestBinding: async () => ({
        operationId: "ocr-44",
        requestHash: "sha256:aaaaaaaaaaaaaaaa",
        merchantId: "ocr.example"
      }),
      getUsdValueMicros: async () => "30000"
    });

    await expect(hook({ paymentRequired, selectedRequirements })).resolves.toMatchObject({
      abort: true,
      reason: expect.stringMatching(/agenttab:interrupted:.*"operationId":"ocr-44"/)
    });
  });

  it("aborts payment creation when the operation is already paid", async () => {
    const hook = createAgentTabFundingHook({
      coordinator: {
        ensurePaymentAsset: async () => ({
          status: "already_paid",
          reason: "Execution already at paid"
        })
      },
      getRequestBinding: async () => ({
        operationId: "ocr-45",
        requestHash: "sha256:bbbbbbbbbbbbbbbb",
        merchantId: "ocr.example"
      }),
      getUsdValueMicros: async () => "30000"
    });

    await expect(hook({ paymentRequired, selectedRequirements })).resolves.toMatchObject({
      abort: true,
      reason: expect.stringMatching(/agenttab:already_paid:.*"operationId":"ocr-45"/)
    });
  });
});


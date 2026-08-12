import { describe, expect, it } from "vitest";
import {
  evaluatePaymentPolicy,
  paymentPolicySchema,
  type PaymentIntent,
  type PaymentPolicy
} from "../src/index.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";

const intent: PaymentIntent = {
  operationId: "ocr-job-42",
  requestHash: "sha256:0123456789abcdef",
  protocol: "x402",
  network: "solana:mainnet",
  merchantId: "merchant.example",
  merchantOrigin: "https://merchant.example",
  destination: "5C7sExampleMerchantDestination111111111111111111",
  assetMint: USDC,
  amountAtomic: "30000",
  amountUsdMicros: "30000",
  resource: "https://merchant.example/ocr"
};

const policy: PaymentPolicy = {
  mode: "autopay",
  allowedMerchantOrigins: ["https://merchant.example"],
  allowedNetworks: ["solana:mainnet"],
  allowedPaymentAssets: [USDC],
  allowedFundingAssets: [SOL],
  requireVerifiedFundingAssets: true,
  maxPaymentUsdMicros: "500000",
  maxDailyUsdMicros: "2000000",
  requireApprovalAboveUsdMicros: "100000",
  maxSlippageBps: 50,
  maxPriceImpactPct: 1
};

describe("evaluatePaymentPolicy", () => {
  it("allows a small allowlisted payment", () => {
    expect(
      evaluatePaymentPolicy({
        intent,
        policy,
        spend: { spentUsdMicrosLast24h: "0" },
        fundingCandidate: { mint: SOL, balanceAtomic: "100000000", verified: true }
      }).kind
    ).toBe("allow");
  });

  it("fails closed when rolling spend is unknown", () => {
    const result = evaluatePaymentPolicy({ intent, policy, spend: {} });
    expect(result).toMatchObject({ kind: "deny", reason: "usd_value_unknown" });
  });

  it("denies a merchant outside the allowlist", () => {
    const result = evaluatePaymentPolicy({
      intent: { ...intent, merchantOrigin: "https://evil.example" },
      policy,
      spend: { spentUsdMicrosLast24h: "0" }
    });
    expect(result).toMatchObject({ kind: "deny", reason: "merchant_not_allowed" });
  });

  it("requires approval above the configured threshold", () => {
    const result = evaluatePaymentPolicy({
      intent: { ...intent, amountUsdMicros: "120000" },
      policy,
      spend: { spentUsdMicrosLast24h: "0" }
    });
    expect(result).toMatchObject({ kind: "approval_required" });
  });

  it("observe parks for review when USD is unknown instead of denying", () => {
    const result = evaluatePaymentPolicy({
      intent: { ...intent, amountUsdMicros: undefined },
      policy: { ...policy, mode: "observe" },
      spend: {}
    });
    expect(result).toMatchObject({
      kind: "approval_required",
      reason: "usd_value_unknown"
    });
  });

  it("observe still requires approval for an otherwise valid payment", () => {
    const result = evaluatePaymentPolicy({
      intent,
      policy: { ...policy, mode: "observe" },
      spend: { spentUsdMicrosLast24h: "0" },
      fundingCandidate: { mint: SOL, balanceAtomic: "100000000", verified: true }
    });
    expect(result).toMatchObject({
      kind: "approval_required",
      reason: "approval_threshold_exceeded"
    });
  });
});

describe("paymentPolicySchema", () => {
  it("accepts a complete policy and rejects partial payloads", () => {
    expect(paymentPolicySchema.parse(policy).mode).toBe("autopay");
    expect(() => paymentPolicySchema.parse({ mode: "autopay" })).toThrow();
  });
});


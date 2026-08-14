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

  it("treats trailing slashes and default ports as the same origin", () => {
    expect(
      evaluatePaymentPolicy({
        intent: { ...intent, merchantOrigin: "https://merchant.example/" },
        policy: {
          ...policy,
          allowedMerchantOrigins: ["https://merchant.example:443"]
        },
        spend: { spentUsdMicrosLast24h: "0" },
        fundingCandidate: { mint: SOL, balanceAtomic: "100000000", verified: true }
      }).kind
    ).toBe("allow");
    expect(paymentPolicySchema.parse({
      ...policy,
      allowedMerchantOrigins: ["https://merchant.example/v1"]
    }).allowedMerchantOrigins).toEqual(["https://merchant.example"]);
  });

  it("denies a merchant outside the allowlist", () => {
    const result = evaluatePaymentPolicy({
      intent: { ...intent, merchantOrigin: "https://evil.example" },
      policy,
      spend: { spentUsdMicrosLast24h: "0" }
    });
    expect(result).toMatchObject({ kind: "deny", reason: "merchant_not_allowed" });
  });

  it("denies a parked approval after the policy TTL", () => {
    const parkedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T01:00:00.000Z");
    expect(
      evaluatePaymentPolicy({
        intent,
        policy,
        spend: { spentUsdMicrosLast24h: "0" },
        fundingCandidate: { mint: SOL, balanceAtomic: "100000000", verified: true },
        parkedAt,
        now
      })
    ).toMatchObject({ kind: "deny", reason: "parked_approval_expired" });
    expect(
      evaluatePaymentPolicy({
        intent,
        policy: { ...policy, parkedApprovalTtlSeconds: 7200 },
        spend: { spentUsdMicrosLast24h: "0" },
        fundingCandidate: { mint: SOL, balanceAtomic: "100000000", verified: true },
        parkedAt,
        now
      }).kind
    ).toBe("allow");
  });

  it("denies when the payment would exceed the rolling daily cap", () => {
    const result = evaluatePaymentPolicy({
      intent,
      policy,
      spend: { spentUsdMicrosLast24h: "1990000" }
    });
    expect(result).toMatchObject({ kind: "deny", reason: "daily_limit_exceeded" });
  });

  it("denies a named agent that would exceed its own quota while the gateway still has room", () => {
    const result = evaluatePaymentPolicy({
      intent,
      policy: {
        ...policy,
        maxDailyUsdMicros: "2000000",
        maxDailyUsdMicrosByAgent: { research: "40000" }
      },
      spend: {
        spentUsdMicrosLast24h: "0",
        spentUsdMicrosLast24hByAgent: { research: "20000" }
      },
      agentId: "research"
    });
    expect(result).toMatchObject({ kind: "deny", reason: "agent_daily_limit_exceeded" });
  });

  it("still denies on the gateway-wide cap when the agent quota has room", () => {
    const result = evaluatePaymentPolicy({
      intent,
      policy: {
        ...policy,
        maxDailyUsdMicros: "40000",
        maxDailyUsdMicrosByAgent: { research: "2000000" }
      },
      spend: { spentUsdMicrosLast24h: "20000" },
      agentId: "research"
    });
    expect(result).toMatchObject({ kind: "deny", reason: "daily_limit_exceeded" });
  });

  it("does not apply another agent's quota or invent a quota for an omitted id", () => {
    const withMap = {
      ...policy,
      maxDailyUsdMicrosByAgent: { research: "40000" }
    };
    expect(
      evaluatePaymentPolicy({
        intent,
        policy: withMap,
        spend: { spentUsdMicrosLast24h: "0", spentUsdMicrosLast24hByAgent: { research: "40000" } },
        agentId: "ops"
      }).kind
    ).toBe("allow");
    expect(
      evaluatePaymentPolicy({
        intent,
        policy: withMap,
        spend: { spentUsdMicrosLast24h: "0" }
      }).kind
    ).toBe("allow");
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

  it("accepts optional per-agent caps and rejects malformed values", () => {
    expect(
      paymentPolicySchema.parse({
        ...policy,
        maxDailyUsdMicrosByAgent: { research: "5000000", ops: "0" }
      }).maxDailyUsdMicrosByAgent
    ).toEqual({ research: "5000000", ops: "0" });
    expect(paymentPolicySchema.parse(policy).maxDailyUsdMicrosByAgent).toBeUndefined();
    expect(() =>
      paymentPolicySchema.parse({
        ...policy,
        maxDailyUsdMicrosByAgent: { research: "-1" }
      })
    ).toThrow();
    expect(() =>
      paymentPolicySchema.parse({
        ...policy,
        maxDailyUsdMicrosByAgent: { "bad id": "1" }
      })
    ).toThrow();
    expect(() =>
      paymentPolicySchema.parse({
        ...policy,
        maxDailyUsdMicrosByAgent: { research: "unlimited" }
      })
    ).toThrow();
  });
});


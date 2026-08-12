import { z } from "zod";
import { httpOriginSchema } from "./origin.js";

export const atomicAmountSchema = z.string().regex(/^\d+$/, "must be atomic units");

export const paymentIntentSchema = z.object({
  operationId: z.string().min(1).max(160),
  requestHash: z.string().min(16).max(256),
  protocol: z.string().min(1).max(32),
  network: z.string().min(1).max(128),
  merchantId: z.string().min(1).max(256),
  merchantOrigin: httpOriginSchema,
  destination: z.string().min(16).max(128),
  assetMint: z.string().min(16).max(128),
  amountAtomic: atomicAmountSchema,
  amountUsdMicros: atomicAmountSchema.optional(),
  resource: z.string().min(1).max(2048),
  expiresAt: z.iso.datetime().optional()
});

export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

export const fundingCandidateSchema = z.object({
  mint: z.string().min(16).max(128),
  symbol: z.string().min(1).max(32).optional(),
  balanceAtomic: atomicAmountSchema,
  verified: z.boolean()
});

export type FundingCandidate = z.infer<typeof fundingCandidateSchema>;

export type DecisionKind = "allow" | "approval_required" | "deny";

export type PolicyReasonCode =
  | "allowed"
  | "invalid_intent"
  | "merchant_not_allowed"
  | "merchant_denied"
  | "network_not_allowed"
  | "payment_asset_not_allowed"
  | "funding_asset_not_allowed"
  | "unverified_funding_asset"
  | "usd_value_unknown"
  | "per_payment_limit_exceeded"
  | "daily_limit_exceeded"
  | "approval_threshold_exceeded"
  | "challenge_expired";

export interface PolicyDecision {
  kind: DecisionKind;
  reason: PolicyReasonCode;
  message: string;
}

export interface SpendSnapshot {
  spentUsdMicrosLast24h?: string;
}

export interface PaymentPolicy {
  mode: "observe" | "approve" | "autopay";
  allowedMerchantOrigins: string[];
  deniedMerchantOrigins?: string[] | undefined;
  allowedNetworks: string[];
  allowedPaymentAssets: string[];
  allowedFundingAssets: string[];
  requireVerifiedFundingAssets: boolean;
  maxPaymentUsdMicros: string;
  maxDailyUsdMicros: string;
  requireApprovalAboveUsdMicros?: string | undefined;
  maxSlippageBps: number;
  maxPriceImpactPct: number;
}

export const paymentPolicySchema = z.object({
  mode: z.enum(["observe", "approve", "autopay"]),
  allowedMerchantOrigins: z.array(httpOriginSchema).min(1),
  deniedMerchantOrigins: z.array(httpOriginSchema).optional(),
  allowedNetworks: z.array(z.string().min(1).max(128)).min(1),
  allowedPaymentAssets: z.array(z.string().min(16).max(128)).min(1),
  allowedFundingAssets: z.array(z.string().min(16).max(128)).min(1),
  requireVerifiedFundingAssets: z.boolean(),
  maxPaymentUsdMicros: atomicAmountSchema,
  maxDailyUsdMicros: atomicAmountSchema,
  requireApprovalAboveUsdMicros: atomicAmountSchema.optional(),
  maxSlippageBps: z.number().int().min(0).max(10_000),
  maxPriceImpactPct: z.number().min(0).max(100)
});

export type FundingStatus = "already_funded" | "funded" | "approval_required" | "denied";

export interface FundingOutcome {
  status: FundingStatus;
  reason: string;
  fundingTransaction?: string;
  inputMint?: string;
  inputAmountAtomic?: string;
  outputAmountAtomic?: string;
}

export interface PaymentFundingCoordinator {
  ensurePaymentAsset(input: {
    intent: PaymentIntent;
    signal?: AbortSignal;
  }): Promise<FundingOutcome>;
}

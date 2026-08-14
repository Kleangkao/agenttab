import {
  paymentIntentSchema,
  type FundingCandidate,
  type PaymentIntent,
  type PaymentPolicy,
  type PolicyDecision,
  type SpendSnapshot
} from "./types.js";
import { canonicalizeHttpOrigin } from "./origin.js";

const decision = (
  kind: PolicyDecision["kind"],
  reason: PolicyDecision["reason"],
  message: string
): PolicyDecision => ({ kind, reason, message });

const toAtomic = (value: string | undefined): bigint | undefined =>
  value === undefined ? undefined : BigInt(value);

/** Default park lifetime when policy omits `parkedApprovalTtlSeconds`. */
export const DEFAULT_PARKED_APPROVAL_TTL_SECONDS = 3600;

export function parkedApprovalTtlSeconds(policy: {
  parkedApprovalTtlSeconds?: number | undefined;
}): number {
  return policy.parkedApprovalTtlSeconds ?? DEFAULT_PARKED_APPROVAL_TTL_SECONDS;
}

export function parkedApprovalDeadline(
  parkedAt: Date,
  policy: { parkedApprovalTtlSeconds?: number | undefined }
): Date {
  return new Date(parkedAt.getTime() + parkedApprovalTtlSeconds(policy) * 1000);
}

export function isParkedApprovalExpired(
  parkedAt: Date,
  policy: { parkedApprovalTtlSeconds?: number | undefined },
  now: Date = new Date()
): boolean {
  return now.getTime() >= parkedApprovalDeadline(parkedAt, policy).getTime();
}

export function evaluatePaymentPolicy(input: {
  intent: PaymentIntent;
  policy: PaymentPolicy;
  spend: SpendSnapshot;
  fundingCandidate?: FundingCandidate;
  now?: Date;
  /** When set, a parked approval older than policy TTL is denied. */
  parkedAt?: Date;
}): PolicyDecision {
  const parsed = paymentIntentSchema.safeParse(input.intent);
  if (!parsed.success) {
    return decision("deny", "invalid_intent", "Payment intent failed validation.");
  }

  const intent = parsed.data;
  const { policy, spend, fundingCandidate } = input;
  const now = input.now ?? new Date();
  const merchantOrigin = canonicalizeHttpOrigin(intent.merchantOrigin);
  const deniedOrigins = new Set(
    (policy.deniedMerchantOrigins ?? []).flatMap((origin) => {
      try {
        return [canonicalizeHttpOrigin(origin)];
      } catch {
        return [];
      }
    })
  );
  const allowedOrigins = new Set(
    policy.allowedMerchantOrigins.flatMap((origin) => {
      try {
        return [canonicalizeHttpOrigin(origin)];
      } catch {
        return [];
      }
    })
  );

  if (intent.expiresAt !== undefined && new Date(intent.expiresAt) <= now) {
    return decision("deny", "challenge_expired", "Payment challenge has expired.");
  }

  if (input.parkedAt !== undefined && isParkedApprovalExpired(input.parkedAt, policy, now)) {
    return decision("deny", "parked_approval_expired", "Parked approval has expired.");
  }

  if (deniedOrigins.has(merchantOrigin)) {
    return decision("deny", "merchant_denied", "Merchant is explicitly denied.");
  }

  if (!allowedOrigins.has(merchantOrigin)) {
    return decision("deny", "merchant_not_allowed", "Merchant is not allowlisted.");
  }

  if (!policy.allowedNetworks.includes(intent.network)) {
    return decision("deny", "network_not_allowed", "Network is not allowed.");
  }

  if (!policy.allowedPaymentAssets.includes(intent.assetMint)) {
    return decision("deny", "payment_asset_not_allowed", "Payment asset is not allowed.");
  }

  if (fundingCandidate !== undefined) {
    if (!policy.allowedFundingAssets.includes(fundingCandidate.mint)) {
      return decision("deny", "funding_asset_not_allowed", "Funding asset is not allowed.");
    }
    if (policy.requireVerifiedFundingAssets && !fundingCandidate.verified) {
      return decision("deny", "unverified_funding_asset", "Funding asset is not verified.");
    }
  }

  const paymentUsd = toAtomic(intent.amountUsdMicros);
  const spentUsd = toAtomic(spend.spentUsdMicrosLast24h);
  if (paymentUsd === undefined || spentUsd === undefined) {
    return policy.mode === "observe"
      ? decision("approval_required", "usd_value_unknown", "USD value requires review.")
      : decision("deny", "usd_value_unknown", "USD value or rolling spend is unknown.");
  }

  if (paymentUsd > BigInt(policy.maxPaymentUsdMicros)) {
    return decision("deny", "per_payment_limit_exceeded", "Per-payment limit exceeded.");
  }

  if (paymentUsd + spentUsd > BigInt(policy.maxDailyUsdMicros)) {
    return decision("deny", "daily_limit_exceeded", "Rolling daily limit exceeded.");
  }

  const approvalThreshold = toAtomic(policy.requireApprovalAboveUsdMicros);
  if (policy.mode !== "autopay" || (approvalThreshold !== undefined && paymentUsd > approvalThreshold)) {
    return decision(
      "approval_required",
      "approval_threshold_exceeded",
      "A human approval is required by policy."
    );
  }

  return decision("allow", "allowed", "Payment is allowed by policy.");
}


import { paymentPolicySchema, type PaymentPolicy } from "@agenttab/core";
import { LOCAL_NETWORK, USDC_MINT, WSOL_MINT } from "../constants.js";

export interface PolicyStore {
  get(): PaymentPolicy;
  set(policy: PaymentPolicy): PaymentPolicy;
}

export function createDemoPolicy(merchantOrigin: string): PaymentPolicy {
  return paymentPolicySchema.parse({
    mode: "autopay",
    allowedMerchantOrigins: [merchantOrigin],
    allowedNetworks: [LOCAL_NETWORK],
    allowedPaymentAssets: [USDC_MINT],
    allowedFundingAssets: [WSOL_MINT, USDC_MINT],
    requireVerifiedFundingAssets: true,
    maxPaymentUsdMicros: "5000000",
    maxDailyUsdMicros: "20000000",
    maxSlippageBps: 50,
    maxPriceImpactPct: 1
  });
}

export class InMemoryPolicyStore implements PolicyStore {
  #policy: PaymentPolicy;

  constructor(initial: PaymentPolicy) {
    this.#policy = paymentPolicySchema.parse(initial);
  }

  get(): PaymentPolicy {
    return structuredClone(this.#policy);
  }

  set(policy: PaymentPolicy): PaymentPolicy {
    this.#policy = paymentPolicySchema.parse(policy);
    return this.get();
  }
}

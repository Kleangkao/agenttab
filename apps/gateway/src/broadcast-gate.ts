/**
 * Pure abort evaluation for Mainnet live broadcast gates.
 * Kept separate so gate criteria can be unit-tested without RPC/DFlow.
 */
export interface BroadcastGateInput {
  solLamports: number;
  usdcAtomic: string;
  paymentAtomic: string;
  facilitatorMinAtomic: string;
  priceImpactPct: number;
  fundingInputAtomic: string;
  simulationOk: boolean;
  planBroadcast: boolean;
  planType: string;
  merchantPriceAtomic: string;
  merchantFacilitatorUrl: string;
  expectedFacilitatorUrl: string;
  merchantAddress: string;
  expectedMerchantAddress: string;
  /** Soft floor: refuse if SOL is too low for fees/rent. */
  minSolLamports?: number;
  maxPaymentAtomic?: string;
  maxFundingInputAtomic?: string;
  maxPriceImpactPct?: number;
}

export function evaluateBroadcastGate(input: BroadcastGateInput): {
  ok: boolean;
  abortReasons: string[];
} {
  const abortReasons: string[] = [];
  const minSol = input.minSolLamports ?? 50_000_000;
  const maxPayment = BigInt(input.maxPaymentAtomic ?? "10000");
  const maxFundingInput = BigInt(input.maxFundingInputAtomic ?? "5000000");
  const maxImpact = input.maxPriceImpactPct ?? 1;

  if (input.solLamports < minSol) abortReasons.push("sol_below_safety_floor");
  if (BigInt(input.usdcAtomic) >= BigInt(input.paymentAtomic)) {
    abortReasons.push("usdc_already_sufficient");
  }
  if (BigInt(input.paymentAtomic) > maxPayment) abortReasons.push("payment_above_policy_max");
  if (BigInt(input.paymentAtomic) < BigInt(input.facilitatorMinAtomic)) {
    abortReasons.push("payment_below_live_facilitator_min");
  }
  if (!(input.priceImpactPct <= maxImpact)) abortReasons.push("price_impact_exceeds_policy");
  if (BigInt(input.fundingInputAtomic) > maxFundingInput) {
    abortReasons.push("funding_input_unexpectedly_large");
  }
  if (BigInt(input.fundingInputAtomic) < 1000n) {
    abortReasons.push("funding_input_unexpectedly_small");
  }
  if (input.simulationOk !== true) abortReasons.push("simulation_not_ok");
  if (input.planBroadcast !== true) abortReasons.push("broadcast_not_armed_in_plan");
  if (input.planType !== "live-funding-plan") {
    abortReasons.push(`unexpected_plan_type:${input.planType}`);
  }
  if (input.merchantPriceAtomic !== input.paymentAtomic) {
    abortReasons.push("merchant_price_mismatch");
  }
  if (input.merchantFacilitatorUrl !== input.expectedFacilitatorUrl) {
    abortReasons.push("facilitator_mismatch");
  }
  if (input.merchantAddress !== input.expectedMerchantAddress) {
    abortReasons.push("merchant_mismatch");
  }

  return { ok: abortReasons.length === 0, abortReasons };
}

import type { MinimumInputPlan } from "@agenttab/dflow";

export interface FundingOrder {
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: string;
  outputAmountAtomic: string;
  minimumOutputAtomic: string;
  priceImpactPct: string;
  /** Opaque plan payload verified by the signer boundary before "signing". */
  transaction: string;
  plan: MinimumInputPlan;
  source: "mock" | "live-quote" | "devnet-mint" | "live-sim";
}

export interface PlanExactDeficitInput {
  inputMint: string;
  outputMint: string;
  targetOutputAtomic: string;
  maxInputAtomic: string;
  userPublicKey: string;
  slippageBps?: number;
}

export interface DeficitFundingAdapter {
  readonly orders: FundingOrder[];
  planExactDeficit(input: PlanExactDeficitInput): Promise<FundingOrder>;
}

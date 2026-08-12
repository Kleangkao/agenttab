import {
  findMinimumInputForOutput,
  InsufficientFundingLiquidityError,
  type DFlowOutputQuote,
  type MinimumInputPlan
} from "@agenttab/dflow";
import type { DeficitFundingAdapter, FundingOrder, PlanExactDeficitInput } from "./types.js";

export type { FundingOrder } from "./types.js";

export interface MockDFlowAdapterOptions {
  /** Atomic output per 1 atomic input, scaled by 1e6 for fixed-point. */
  rateScaled?: bigint;
  /** Fail every funding attempt when true. */
  failFunding?: boolean;
}

/**
 * Deterministic in-process DFlow stand-in. Uses the real exact-deficit planner
 * against a linear quote function so deficit math is exercised without an API key.
 */
export class MockDFlowAdapter implements DeficitFundingAdapter {
  readonly #rateScaled: bigint;
  failFunding: boolean;
  readonly orders: FundingOrder[] = [];

  constructor(options: MockDFlowAdapterOptions = {}) {
    this.#rateScaled = options.rateScaled ?? 500_000_000n;
    this.failFunding = options.failFunding ?? false;
  }

  async planExactDeficit(input: PlanExactDeficitInput): Promise<FundingOrder> {
    if (this.failFunding) {
      throw new Error("Mock DFlow funding failure");
    }

    const rate = this.#rateScaled;
    const quote = async (inputAmountAtomic: string): Promise<DFlowOutputQuote> => {
      const inAmount = BigInt(inputAmountAtomic);
      const outAmount = (inAmount * rate) / 1_000_000n;
      const minOutAmount = (outAmount * 99n) / 100n;
      return {
        inAmount: inputAmountAtomic,
        outAmount: outAmount.toString(),
        minOutAmount: minOutAmount.toString(),
        priceImpactPct: "0.1"
      };
    };

    const target = BigInt(input.targetOutputAtomic);
    const estimatedInput =
      target === 0n ? 1n : (target * 1_000_000n * 100n) / (rate * 99n) + 1n;
    const cappedEstimate =
      estimatedInput > BigInt(input.maxInputAtomic) ? BigInt(input.maxInputAtomic) : estimatedInput;

    let plan: MinimumInputPlan;
    try {
      plan = await findMinimumInputForOutput({
        targetOutputAtomic: input.targetOutputAtomic,
        maxInputAtomic: input.maxInputAtomic,
        initialInputAtomic: cappedEstimate.toString(),
        maxQuoteRequests: 40,
        quote
      });
    } catch (error) {
      if (error instanceof InsufficientFundingLiquidityError) throw error;
      throw error;
    }

    const order: FundingOrder = {
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      inputAmountAtomic: plan.inputAmountAtomic,
      outputAmountAtomic: plan.expectedOutputAtomic,
      minimumOutputAtomic: plan.minimumOutputAtomic,
      priceImpactPct: plan.priceImpactPct,
      transaction: JSON.stringify({
        type: "mock-dflow-order",
        userPublicKey: input.userPublicKey,
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        inAmount: plan.inputAmountAtomic,
        outAmount: plan.expectedOutputAtomic,
        minOutAmount: plan.minimumOutputAtomic
      }),
      plan,
      source: "mock"
    };
    this.orders.push(order);
    return order;
  }
}

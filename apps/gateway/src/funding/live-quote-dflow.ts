import {
  findMinimumInputForOutput,
  InsufficientFundingLiquidityError,
  type DFlowClient,
  type DFlowOutputQuote,
  type MinimumInputPlan
} from "@agenttab/dflow";
import type { DeficitFundingAdapter, FundingOrder, PlanExactDeficitInput } from "./types.js";

export interface LiveQuoteDFlowAdapterOptions {
  client: DFlowClient;
  /** Max planner quote calls (each hits DFlow). Default 24. */
  maxQuoteRequests?: number;
  defaultSlippageBps?: number;
}

/**
 * Live DFlow quote-only funding adapter.
 *
 * Calls the real Trade API without `userPublicKey`, so no signable chain
 * transaction is returned and nothing can be broadcast. Plans are bound into a
 * local payload for the simulated signer boundary.
 */
export class LiveQuoteDFlowAdapter implements DeficitFundingAdapter {
  readonly #client: DFlowClient;
  readonly #maxQuoteRequests: number;
  readonly #defaultSlippageBps: number;
  readonly orders: FundingOrder[] = [];

  constructor(options: LiveQuoteDFlowAdapterOptions) {
    this.#client = options.client;
    this.#maxQuoteRequests = options.maxQuoteRequests ?? 24;
    this.#defaultSlippageBps = options.defaultSlippageBps ?? 50;
  }

  async planExactDeficit(input: PlanExactDeficitInput): Promise<FundingOrder> {
    const slippageBps = input.slippageBps ?? this.#defaultSlippageBps;

    const quote = async (inputAmountAtomic: string): Promise<DFlowOutputQuote> => {
      const response = await this.#client.getOrder({
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        amount: inputAmountAtomic,
        slippageBps
        // Intentionally omit userPublicKey: quote-only, no broadcastable tx.
      });
      return {
        inAmount: response.inAmount,
        outAmount: response.outAmount,
        minOutAmount: response.minOutAmount,
        priceImpactPct: response.priceImpactPct
      };
    };

    const probeAmount =
      BigInt(input.maxInputAtomic) < 100_000_000n
        ? BigInt(input.maxInputAtomic)
        : 100_000_000n;
    const probe = await quote(probeAmount.toString());
    const probeOut = BigInt(probe.minOutAmount);
    const estimatedInput =
      probeOut <= 0n
        ? probeAmount
        : (BigInt(input.targetOutputAtomic) * probeAmount * 100n) / (probeOut * 99n) + 1n;
    const cappedEstimate =
      estimatedInput > BigInt(input.maxInputAtomic) ? BigInt(input.maxInputAtomic) : estimatedInput;

    let plan: MinimumInputPlan;
    try {
      plan = await findMinimumInputForOutput({
        targetOutputAtomic: input.targetOutputAtomic,
        maxInputAtomic: input.maxInputAtomic,
        initialInputAtomic: cappedEstimate.toString(),
        maxQuoteRequests: this.#maxQuoteRequests,
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
        type: "live-quote-plan",
        broadcast: false,
        userPublicKey: input.userPublicKey,
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        inAmount: plan.inputAmountAtomic,
        outAmount: plan.expectedOutputAtomic,
        minOutAmount: plan.minimumOutputAtomic,
        dflowBaseUrl: this.#client.baseUrl,
        quoteRequests: plan.quoteRequests
      }),
      plan,
      source: "live-quote"
    };
    this.orders.push(order);
    return order;
  }
}

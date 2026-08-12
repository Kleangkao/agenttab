import type { DFlowOutputQuote, MinimumInputPlan } from "./types.js";

export class InsufficientFundingLiquidityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientFundingLiquidityError";
  }
}

/**
 * Finds an exact-input amount whose worst-case DFlow output covers a required
 * payment deficit. DFlow quotes exact input, so AgentTab brackets a sufficient
 * amount and then narrows it without ever trusting the optimistic outAmount.
 */
export async function findMinimumInputForOutput(input: {
  targetOutputAtomic: string;
  maxInputAtomic: string;
  initialInputAtomic?: string;
  maxQuoteRequests?: number;
  quote: (inputAmountAtomic: string) => Promise<DFlowOutputQuote>;
}): Promise<MinimumInputPlan> {
  const target = BigInt(input.targetOutputAtomic);
  const maxInput = BigInt(input.maxInputAtomic);
  const maxRequests = input.maxQuoteRequests ?? 18;

  if (target <= 0n) throw new RangeError("targetOutputAtomic must be positive");
  if (maxInput <= 0n) throw new RangeError("maxInputAtomic must be positive");
  if (maxRequests < 2) throw new RangeError("maxQuoteRequests must be at least 2");

  let requests = 0;
  let low = 0n;
  let high = BigInt(input.initialInputAtomic ?? "1");
  if (high <= 0n) high = 1n;
  if (high > maxInput) high = maxInput;

  const getQuote = async (amount: bigint): Promise<DFlowOutputQuote> => {
    if (requests >= maxRequests) throw new Error("quote request budget exhausted");
    requests += 1;
    return input.quote(amount.toString());
  };

  let highQuote = await getQuote(high);
  while (BigInt(highQuote.minOutAmount) < target && high < maxInput) {
    low = high;
    high = high * 2n > maxInput ? maxInput : high * 2n;
    highQuote = await getQuote(high);
  }

  if (BigInt(highQuote.minOutAmount) < target) {
    throw new InsufficientFundingLiquidityError(
      "Approved funding balance cannot guarantee the required payment output"
    );
  }

  let minimized = true;
  while (low + 1n < high) {
    if (requests >= maxRequests) {
      minimized = false;
      break;
    }
    const middle = (low + high) / 2n;
    const quote = await getQuote(middle);
    if (BigInt(quote.minOutAmount) >= target) {
      high = middle;
      highQuote = quote;
    } else {
      low = middle;
    }
  }

  return {
    inputAmountAtomic: high.toString(),
    expectedOutputAtomic: highQuote.outAmount,
    minimumOutputAtomic: highQuote.minOutAmount,
    priceImpactPct: highQuote.priceImpactPct,
    quoteRequests: requests,
    minimized
  };
}


import { describe, expect, it } from "vitest";
import {
  findMinimumInputForOutput,
  InsufficientFundingLiquidityError
} from "../src/index.js";

const linearQuote = async (amount: string) => ({
  inAmount: amount,
  outAmount: (BigInt(amount) * 2n).toString(),
  minOutAmount: ((BigInt(amount) * 2n * 99n) / 100n).toString(),
  priceImpactPct: "0.001"
});

describe("findMinimumInputForOutput", () => {
  it("uses worst-case output and finds a sufficient input", async () => {
    const result = await findMinimumInputForOutput({
      targetOutputAtomic: "1000",
      maxInputAtomic: "1000",
      initialInputAtomic: "100",
      quote: linearQuote
    });

    expect(BigInt(result.minimumOutputAtomic)).toBeGreaterThanOrEqual(1000n);
    expect(result.inputAmountAtomic).toBe("506");
    expect(result.minimized).toBe(true);
  });

  it("fails when the approved balance cannot cover the target", async () => {
    await expect(
      findMinimumInputForOutput({
        targetOutputAtomic: "1000",
        maxInputAtomic: "100",
        quote: linearQuote
      })
    ).rejects.toBeInstanceOf(InsufficientFundingLiquidityError);
  });

  it("returns a safe bracket when the quote budget is exhausted", async () => {
    const result = await findMinimumInputForOutput({
      targetOutputAtomic: "1000",
      maxInputAtomic: "1000",
      initialInputAtomic: "500",
      maxQuoteRequests: 2,
      quote: linearQuote
    });

    expect(BigInt(result.minimumOutputAtomic)).toBeGreaterThanOrEqual(1000n);
    expect(result.minimized).toBe(false);
  });
});


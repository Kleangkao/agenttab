import { describe, expect, it, vi } from "vitest";
import { DFlowClient } from "@agenttab/dflow";
import { LiveQuoteDFlowAdapter } from "../src/funding/live-quote-dflow.js";
import { SimulatedSigner } from "../src/signer/simulated.js";
import { USDC_MINT, WSOL_MINT, DEMO_WALLET } from "../src/constants.js";

describe("LiveQuoteDFlowAdapter", () => {
  it("plans an exact deficit from quote-only DFlow responses without requesting a tx", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: URL | RequestInfo) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      expect(url.searchParams.get("userPublicKey")).toBeNull();
      const amount = BigInt(url.searchParams.get("amount") ?? "0");
      // ~75 USDC atomic per 1 SOL lamport-scale unit used in tests: amount/100000000 * 7566944
      const outAmount = (amount * 7566944n) / 100_000_000n;
      const minOutAmount = (outAmount * 99n) / 100n;
      const payload = {
        inputMint: WSOL_MINT,
        outputMint: USDC_MINT,
        inAmount: amount.toString(),
        outAmount: outAmount.toString(),
        otherAmountThreshold: minOutAmount.toString(),
        minOutAmount: minOutAmount.toString(),
        slippageBps: 50,
        priceImpactPct: "0",
        contextSlot: 42,
        executionMode: "sync"
      };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
        json: async () => payload
      };
    });

    const adapter = new LiveQuoteDFlowAdapter({
      client: new DFlowClient({
        baseUrl: "https://dev-quote-api.dflow.net",
        fetch: fetchMock as unknown as typeof fetch
      }),
      maxQuoteRequests: 24
    });

    const order = await adapter.planExactDeficit({
      inputMint: WSOL_MINT,
      outputMint: USDC_MINT,
      targetOutputAtomic: "1000000",
      maxInputAtomic: "5000000000",
      userPublicKey: DEMO_WALLET
    });

    expect(order.source).toBe("live-quote");
    expect(BigInt(order.minimumOutputAtomic)).toBeGreaterThanOrEqual(1_000_000n);
    expect(JSON.parse(order.transaction)).toMatchObject({
      type: "live-quote-plan",
      broadcast: false,
      userPublicKey: DEMO_WALLET
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    const signer = new SimulatedSigner();
    const signed = await signer.signFundingTransaction({
      wallet: DEMO_WALLET,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inputAmountAtomic: order.inputAmountAtomic,
      minimumOutputAtomic: order.minimumOutputAtomic,
      network: "solana:local",
      operationId: "live-quote-test",
      transaction: order.transaction
    });
    expect(signed.signature).toContain("sim-fund-live-quote-test");
  });
});

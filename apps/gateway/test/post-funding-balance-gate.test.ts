import { describe, expect, it } from "vitest";
import { MockBalanceProvider } from "../src/funding/mock-balances.js";
import { USDC_MINT, WSOL_MINT } from "../src/constants.js";
import { createGatewayRuntime } from "../src/app.js";
import { LOCAL_NETWORK } from "../src/constants.js";
import type { DeficitFundingAdapter, FundingOrder } from "../src/funding/types.js";
import type { SignerBoundary } from "../src/signer/simulated.js";

class FakeAdapter implements DeficitFundingAdapter {
  orders: FundingOrder[] = [];
  async planExactDeficit(): Promise<FundingOrder> {
    const order: FundingOrder = {
      inputMint: WSOL_MINT,
      outputMint: USDC_MINT,
      inputAmountAtomic: "1000",
      outputAmountAtomic: "50",
      minimumOutputAtomic: "50",
      priceImpactPct: "0",
      transaction: JSON.stringify({
        type: "mock-dflow-order",
        broadcast: false,
        userPublicKey: "AgentTabDemoWallet1111111111111111111111111",
        inputMint: WSOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000",
        minOutAmount: "50"
      }),
      plan: {
        inputAmountAtomic: "1000",
        expectedOutputAtomic: "50",
        minimumOutputAtomic: "50",
        priceImpactPct: "0",
        quoteRequests: 1,
        minimized: true
      },
      source: "mock"
    };
    this.orders.push(order);
    return order;
  }
}

describe("post-funding balance gate", () => {
  it("refuses to mark funded when held payment asset is still below required", async () => {
    const balances = new MockBalanceProvider([
      {
        mint: USDC_MINT,
        symbol: "USDC",
        balanceAtomic: "0",
        verified: true
      },
      {
        mint: WSOL_MINT,
        symbol: "SOL",
        balanceAtomic: "5000000000",
        verified: true
      }
    ]);
    // Adapter claims +50 output, but we sabotage applyDelta by wrapping balances
    // so the booked amount never lands — gate must fail closed.
    const sabotaged = {
      list: () => balances.list(),
      get: (mint: string) => balances.get(mint),
      applyDelta: () => {
        // pretend funding bookkeeping failed / was skipped
      }
    };
    const signer: SignerBoundary = {
      async signFundingTransaction() {
        return { signature: "sim-fund-underfunded" };
      }
    };
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://merchant.local",
      balances: sabotaged,
      dflowAdapter: new FakeAdapter(),
      signer
    });

    const outcome = await gateway.coordinator.ensurePaymentAsset({
      intent: {
        operationId: "underfund-1",
        requestHash: "sha256:underfund-request-001",
        protocol: "x402",
        network: LOCAL_NETWORK,
        merchantId: "merchant.local",
        merchantOrigin: "http://merchant.local",
        destination: "PaidApiMerchantDest11111111111111111111111",
        assetMint: USDC_MINT,
        amountAtomic: "1000",
        amountUsdMicros: "1000",
        resource: "http://merchant.local/v1/research"
      }
    });

    expect(outcome.status).toBe("interrupted");
    expect(outcome.reason).toMatch(/Post-funding balance gate failed/);
    const record = await gateway.store.get("underfund-1");
    expect(record?.state).not.toBe("funded");
    gateway.close();
  });
});

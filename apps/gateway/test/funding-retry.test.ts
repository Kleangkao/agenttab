import { describe, expect, it } from "vitest";
import {
  createGatewayRuntime,
  DEMO_WALLET,
  SimulatedSigner,
  USDC_MINT,
  WSOL_MINT,
  type DeficitFundingAdapter,
  type FundingOrder,
  type SignableFundingPlan,
  type SignerBoundary
} from "../src/index.js";

function makeOrder(
  input: { targetOutputAtomic: string; userPublicKey: string },
  extras: {
    mintSignature?: string;
    inputAmountAtomic?: string;
    transactionType?: string;
  } = {}
): FundingOrder {
  const inputAmountAtomic = extras.inputAmountAtomic ?? "1000";
  return {
    inputMint: WSOL_MINT,
    outputMint: USDC_MINT,
    inputAmountAtomic,
    outputAmountAtomic: input.targetOutputAtomic,
    minimumOutputAtomic: input.targetOutputAtomic,
    priceImpactPct: "0",
    transaction: JSON.stringify({
      type:
        extras.transactionType ??
        (extras.mintSignature ? "devnet-mint-plan" : "mock-dflow-order"),
      userPublicKey: input.userPublicKey,
      inputMint: WSOL_MINT,
      outputMint: USDC_MINT,
      inAmount: inputAmountAtomic,
      minOutAmount: input.targetOutputAtomic,
      ...(extras.mintSignature === undefined
        ? {}
        : { mintSignature: extras.mintSignature })
    }),
    plan: {
      inputAmountAtomic,
      expectedOutputAtomic: input.targetOutputAtomic,
      minimumOutputAtomic: input.targetOutputAtomic,
      priceImpactPct: "0",
      quoteRequests: 1,
      minimized: true
    },
    source: extras.mintSignature ? "devnet-mint" : "mock"
  };
}

const baseIntent = {
  requestHash: "sha256:retry-test",
  protocol: "x402" as const,
  network: "solana:local",
  merchantId: "merchant.local",
  merchantOrigin: "http://127.0.0.1:8790",
  destination: "PaidApiMerchantDest11111111111111111111111",
  assetMint: USDC_MINT,
  amountAtomic: "1000000",
  amountUsdMicros: "1000000",
  resource: "http://127.0.0.1:8790/v1/research"
};

describe("funding retry double-send protection", () => {
  it("refuses to re-plan after an incomplete attempt lock", async () => {
    let plans = 0;
    const adapter: DeficitFundingAdapter = {
      orders: [],
      planExactDeficit: async () => {
        plans += 1;
        throw new Error("simulated mid-flight adapter failure");
      }
    };

    const gateway = createGatewayRuntime({
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      dflowAdapter: adapter,
      wallet: DEMO_WALLET
    });

    const intent = { ...baseIntent, operationId: "retry-lock-1" };

    const first = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(first.status).toBe("denied");
    expect(plans).toBe(1);

    const second = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(second.status).toBe("denied");
    expect(second.reason).toMatch(/Incomplete funding attempt|terminal: failed/i);
    expect(plans).toBe(1);

    gateway.close();
  });

  it("resumes from adapter side-effect receipt without re-planning", async () => {
    let plans = 0;
    const adapter: DeficitFundingAdapter = {
      orders: [],
      planExactDeficit: async (input) => {
        plans += 1;
        const order = makeOrder(input, { mintSignature: "side-effect-sig-1" });
        adapter.orders.push(order);
        return order;
      }
    };

    const gateway = createGatewayRuntime({
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      dflowAdapter: adapter,
      wallet: DEMO_WALLET
    });

    const intent = { ...baseIntent, operationId: "retry-resume-side-effect-1" };

    const first = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(first.status).toBe("funded");
    expect(plans).toBe(1);

    const second = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(second.status).toBe("already_funded");
    expect(plans).toBe(1);
    gateway.close();
  });

  it("re-signs from plan receipt after signer failure without re-planning", async () => {
    let plans = 0;
    const adapter: DeficitFundingAdapter = {
      orders: [],
      planExactDeficit: async (input) => {
        plans += 1;
        const order = makeOrder(input);
        adapter.orders.push(order);
        return order;
      }
    };

    let signCalls = 0;
    const inner = new SimulatedSigner();
    const signer: SignerBoundary = {
      async signFundingTransaction(plan: SignableFundingPlan) {
        signCalls += 1;
        if (signCalls === 1) {
          throw new Error("simulated signer failure");
        }
        return inner.signFundingTransaction(plan);
      }
    };

    const gateway = createGatewayRuntime({
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      dflowAdapter: adapter,
      wallet: DEMO_WALLET,
      signer
    });

    const intent = { ...baseIntent, operationId: "retry-resume-plan-1" };

    const first = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(first.status).toBe("interrupted");
    expect(first.reason).toMatch(/plan receipt retained/i);
    expect(plans).toBe(1);
    expect(signCalls).toBe(1);

    const second = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(second.status).toBe("funded");
    expect(second.reason).toMatch(/plan receipt/i);
    expect(plans).toBe(1);
    expect(signCalls).toBe(2);

    const third = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(third.status).toBe("already_funded");
    expect(plans).toBe(1);
    expect(signCalls).toBe(2);

    gateway.close();
  });

  it("does not treat provisional pending receipts as chain side effects", async () => {
    let plans = 0;
    const adapter: DeficitFundingAdapter = {
      orders: [],
      planExactDeficit: async (input) => {
        plans += 1;
        return makeOrder(input);
      }
    };

    const gateway = createGatewayRuntime({
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      dflowAdapter: adapter,
      wallet: DEMO_WALLET
    });

    const intent = { ...baseIntent, operationId: "retry-no-pending-side-effect" };
    const first = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(first.status).toBe("funded");
    expect(plans).toBe(1);

    const record = await gateway.store.get(intent.operationId);
    expect(record?.events.some((e) => e.kind === "funding.plan_receipt")).toBe(true);
    expect(record?.events.some((e) => e.kind === "funding.side_effect_receipt")).toBe(false);

    gateway.close();
  });

  it("resumes from persisted send receipt without re-planning after post-send failure", async () => {
    let plans = 0;
    const adapter: DeficitFundingAdapter = {
      orders: [],
      planExactDeficit: async (input) => {
        plans += 1;
        const order = makeOrder(input, {
          inputAmountAtomic: "6000",
          transactionType: "live-funding-plan"
        });
        adapter.orders.push(order);
        return order;
      }
    };

    let signCalls = 0;
    const signer: SignerBoundary = {
      async signFundingTransaction() {
        signCalls += 1;
        return { signature: "5FutUrERealTxSig1111111111111111111111111111111" };
      }
    };

    // Simulate chain side-effect succeeding while local balance truth lags,
    // then becomes visible on resume (RPC refresh / delayed ATA visibility).
    let usdcVisible = false;
    const balances = {
      list: () => [
        {
          mint: USDC_MINT,
          symbol: "USDC",
          balanceAtomic: usdcVisible ? "1000000" : "0",
          verified: true
        },
        {
          mint: WSOL_MINT,
          symbol: "SOL",
          balanceAtomic: "5000000000",
          verified: true
        }
      ],
      get: (mint: string) =>
        balances.list().find((row) => row.mint === mint),
      applyDelta: () => {
        // Ignore optimistic deltas; visibility is controlled by usdcVisible.
      }
    };

    const gateway = createGatewayRuntime({
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      dflowAdapter: adapter,
      wallet: DEMO_WALLET,
      signer,
      balances
    });

    const intent = { ...baseIntent, operationId: "retry-side-effect-send-1" };
    const first = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(first.status).toBe("interrupted");
    expect(first.reason).toMatch(/side-effect receipt retained|Post-funding balance gate/i);
    expect(plans).toBe(1);
    expect(signCalls).toBe(1);

    usdcVisible = true;
    const second = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(second.status).toBe("funded");
    expect(second.reason).toMatch(/side-effect receipt/i);
    expect(plans).toBe(1);
    expect(signCalls).toBe(1);

    const record = await gateway.store.get(intent.operationId);
    expect(record?.events.some((e) => e.kind === "funding.side_effect_receipt")).toBe(true);
    gateway.close();
  });

  it("resumes an interrupted plan through POST /v1/executions/:id/resume", async () => {
    let plans = 0;
    const adapter: DeficitFundingAdapter = {
      orders: [],
      planExactDeficit: async (input) => {
        plans += 1;
        const order = makeOrder(input);
        adapter.orders.push(order);
        return order;
      }
    };
    let signCalls = 0;
    const inner = new SimulatedSigner();
    const signer: SignerBoundary = {
      async signFundingTransaction(plan: SignableFundingPlan) {
        signCalls += 1;
        if (signCalls === 1) throw new Error("simulated signer failure");
        return inner.signFundingTransaction(plan);
      }
    };
    const gateway = createGatewayRuntime({
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      dflowAdapter: adapter,
      wallet: DEMO_WALLET,
      signer
    });
    const intent = { ...baseIntent, operationId: "retry-http-resume-1" };
    expect((await gateway.coordinator.ensurePaymentAsset({ intent })).status).toBe(
      "interrupted"
    );
    const health = await (await gateway.app.request("/health")).json();
    expect(health.openLoopCount).toBeGreaterThanOrEqual(1);
    expect(health.parkedCount).toBe(0);

    const parkedResume = await gateway.app.request(
      `/v1/executions/${intent.operationId}/resume`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
    );
    expect(parkedResume.status).toBe(200);
    const body = (await parkedResume.json()) as {
      step?: string;
      outcome?: { status?: string };
    };
    expect(body.step).toBe("fund");
    expect(body.outcome?.status).toBe("funded");
    expect(plans).toBe(1);
    expect(signCalls).toBe(2);
    gateway.close();
  });
});

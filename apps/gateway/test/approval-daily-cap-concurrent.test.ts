import { describe, expect, it } from "vitest";
import type { PaymentPolicy } from "@agenttab/core";
import {
  GatewayFundingCoordinator,
  InMemorySpendLedger,
  MockBalanceProvider,
  MockDFlowAdapter,
  SimulatedSigner,
  SqliteExecutionStore,
  LOCAL_NETWORK,
  USDC_MINT,
  WSOL_MINT,
  type DeficitFundingAdapter
} from "../src/index.js";

/**
 * Deterministic concurrent-cap regression.
 * Compiles on 3e0f20a (T1 already shipped policy_denied). Fails there every
 * run because both callers read spend 0 before either plans. Promise.all
 * without this seam is not a regression test.
 */
const merchantOrigin = "http://127.0.0.1:8791";
const capUsdMicros = "1500000";

function approvePolicy(): PaymentPolicy {
  return {
    mode: "approve",
    allowedMerchantOrigins: [merchantOrigin],
    allowedNetworks: [LOCAL_NETWORK],
    allowedPaymentAssets: [USDC_MINT],
    allowedFundingAssets: [WSOL_MINT, USDC_MINT],
    requireVerifiedFundingAssets: true,
    maxPaymentUsdMicros: "5000000",
    maxDailyUsdMicros: capUsdMicros,
    maxSlippageBps: 50,
    maxPriceImpactPct: 1
  };
}

function intentFor(operationId: string) {
  return {
    operationId,
    requestHash: `sha256:${operationId.padEnd(64, "0")}`,
    protocol: "x402",
    network: LOCAL_NETWORK,
    merchantId: "127.0.0.1:8791",
    merchantOrigin,
    destination: "NeutralMerchant111111111111111111111111111",
    assetMint: USDC_MINT,
    amountAtomic: "1000000",
    amountUsdMicros: "1000000",
    resource: `${merchantOrigin}/v1/market-snapshot`
  };
}

class ArmedSpendLedger {
  #armed = false;
  #reads = 0;
  #unlockTwoReads: (() => void) | undefined;
  readonly twoCoordinatorReads: Promise<void>;
  constructor(private readonly inner: InMemorySpendLedger) {
    this.twoCoordinatorReads = new Promise((resolve) => {
      this.#unlockTwoReads = resolve;
    });
  }

  arm(): void {
    this.#armed = true;
  }

  getSpentUsdMicrosLast24h(): string {
    const value = this.inner.getSpentUsdMicrosLast24h();
    if (this.#armed) {
      this.#reads += 1;
      if (this.#reads >= 2) this.#unlockTwoReads?.();
    }
    return value;
  }

  getSpentUsdMicrosLast24hByAgent(): Record<string, string> {
    return this.inner.getSpentUsdMicrosLast24hByAgent();
  }

  recordSpend(usdMicros: string): void {
    this.inner.recordSpend(usdMicros);
  }

  ensureOperationSpend(
    operationId: string,
    usdMicros: string,
    agentId?: string | undefined
  ): boolean {
    return this.inner.ensureOperationSpend(operationId, usdMicros, agentId);
  }

  // Duck-typed so this file still compiles on 3e0f20a, where SpendLedger
  // has no reservation API. The unfixed coordinator never calls these.
  tryReserveOperationSpend(
    operationId: string,
    usdMicros: string,
    capUsdMicros: string,
    agentId?: string | undefined
  ): "reserved" | "duplicate" | "cap_exceeded" {
    const fn = (
      this.inner as {
        tryReserveOperationSpend?: (
          operationId: string,
          usdMicros: string,
          capUsdMicros: string,
          agentId?: string | undefined
        ) => "reserved" | "duplicate" | "cap_exceeded";
      }
    ).tryReserveOperationSpend;
    if (fn === undefined) {
      throw new Error("tryReserveOperationSpend is missing");
    }
    return fn.call(this.inner, operationId, usdMicros, capUsdMicros, agentId);
  }

  releaseOperationSpend(operationId: string): boolean {
    const fn = (this.inner as { releaseOperationSpend?: (id: string) => boolean })
      .releaseOperationSpend;
    if (fn === undefined) return false;
    return fn.call(this.inner, operationId);
  }
}

describe("daily cap holds across overlapping in-flight funds", () => {
  it("lets exactly one of two concurrent $1 funds win a $1.50 cap", async () => {
    const store = new SqliteExecutionStore(":memory:");
    const spend = new ArmedSpendLedger(new InMemorySpendLedger());
    const innerDflow = new MockDFlowAdapter();
    const dflow: DeficitFundingAdapter = {
      get orders() {
        return innerDflow.orders;
      },
      planExactDeficit: async (input) => {
        await spend.twoCoordinatorReads;
        return innerDflow.planExactDeficit(input);
      }
    };
    const coordinator = new GatewayFundingCoordinator({
      store,
      getPolicy: () => approvePolicy(),
      balances: new MockBalanceProvider([
        { mint: USDC_MINT, symbol: "USDC", balanceAtomic: "0", verified: true },
        { mint: WSOL_MINT, symbol: "SOL", balanceAtomic: "5000000000", verified: true }
      ]),
      dflow,
      signer: new SimulatedSigner(),
      spend,
      wallet: "ConcurrentCapBuyer11111111111111111111111"
    });

    try {
      for (const operationId of ["cap-race-1", "cap-race-2"]) {
        const parked = await coordinator.ensurePaymentAsset({ intent: intentFor(operationId) });
        expect(parked.status).toBe("approval_required");
        const record = await store.get(operationId);
        if (record === undefined) throw new Error(`missing ${operationId}`);
        await store.transition({
          operationId,
          expectedVersion: record.version,
          to: "approved",
          kind: "approval.granted"
        });
      }

      spend.arm();
      const first = coordinator.ensurePaymentAsset({ intent: intentFor("cap-race-1") });
      const second = coordinator.ensurePaymentAsset({ intent: intentFor("cap-race-2") });
      const outcomes = await Promise.race([
        Promise.all([first, second]),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("concurrent cap test deadlocked")), 5_000);
        })
      ]);

      const fundedOutcomes = outcomes.filter((row) => row.status === "funded");
      expect(fundedOutcomes).toHaveLength(1);
      const denied = outcomes.filter((row) => row.status === "policy_denied");
      expect(denied).toHaveLength(1);

      const states = [
        (await store.get("cap-race-1"))?.state,
        (await store.get("cap-race-2"))?.state
      ];
      expect(states.filter((state) => state === "funded")).toHaveLength(1);
      expect(states.filter((state) => state === "denied")).toHaveLength(1);
      expect(spend.getSpentUsdMicrosLast24h()).toBe("1000000");
    } finally {
      store.close();
    }
  });
});

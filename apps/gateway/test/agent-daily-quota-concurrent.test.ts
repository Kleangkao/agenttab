import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { PaymentPolicy } from "@agenttab/core";
import {
  GatewayFundingCoordinator,
  InMemorySpendLedger,
  MockBalanceProvider,
  MockDFlowAdapter,
  SimulatedSigner,
  SqliteExecutionStore,
  SqliteSpendLedger,
  LOCAL_NETWORK,
  USDC_MINT,
  WSOL_MINT,
  type DeficitFundingAdapter,
  type SpendLedger
} from "../src/index.js";

/**
 * Deterministic per-agent / cross-agent cap races.
 * The planExactDeficit barrier waits until both coordinators have read realized
 * spend (still 0). Promise.all without that seam is not a regression test.
 */
const merchantOrigin = "http://127.0.0.1:8791";

function policyFor(input: {
  maxDailyUsdMicros: string;
  maxDailyUsdMicrosByAgent?: Record<string, string>;
}): PaymentPolicy {
  return {
    mode: "approve",
    allowedMerchantOrigins: [merchantOrigin],
    allowedNetworks: [LOCAL_NETWORK],
    allowedPaymentAssets: [USDC_MINT],
    allowedFundingAssets: [WSOL_MINT, USDC_MINT],
    requireVerifiedFundingAssets: true,
    maxPaymentUsdMicros: "5000000",
    maxDailyUsdMicros: input.maxDailyUsdMicros,
    ...(input.maxDailyUsdMicrosByAgent === undefined
      ? {}
      : { maxDailyUsdMicrosByAgent: input.maxDailyUsdMicrosByAgent }),
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

class ArmedSpendLedger implements SpendLedger {
  #armed = false;
  #reads = 0;
  #unlockTwoReads: (() => void) | undefined;
  readonly twoCoordinatorReads: Promise<void>;
  constructor(private readonly inner: SpendLedger) {
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

  tryReserveOperationSpend(
    operationId: string,
    usdMicros: string,
    capUsdMicros: string,
    agentId?: string | undefined,
    agentCapUsdMicros?: string | undefined
  ): "reserved" | "duplicate" | "cap_exceeded" | "agent_cap_exceeded" {
    return this.inner.tryReserveOperationSpend(
      operationId,
      usdMicros,
      capUsdMicros,
      agentId,
      agentCapUsdMicros
    );
  }

  releaseOperationSpend(operationId: string): boolean {
    return this.inner.releaseOperationSpend(operationId);
  }
}

async function parkApproved(
  store: SqliteExecutionStore,
  coordinator: GatewayFundingCoordinator,
  operationId: string,
  agentId: string
): Promise<void> {
  const parked = await coordinator.ensurePaymentAsset({
    intent: intentFor(operationId),
    agentId
  });
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

async function raceTwoFunds(
  spend: ArmedSpendLedger,
  coordinator: GatewayFundingCoordinator,
  first: { operationId: string; agentId: string },
  second: { operationId: string; agentId: string }
) {
  spend.arm();
  const outcomes = await Promise.race([
    Promise.all([
      coordinator.ensurePaymentAsset({
        intent: intentFor(first.operationId),
        agentId: first.agentId
      }),
      coordinator.ensurePaymentAsset({
        intent: intentFor(second.operationId),
        agentId: second.agentId
      })
    ]),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("concurrent quota test deadlocked")), 5_000);
    })
  ]);
  return outcomes;
}

async function withCoordinator(
  spendInner: SpendLedger,
  policy: PaymentPolicy,
  run: (
    spend: ArmedSpendLedger,
    coordinator: GatewayFundingCoordinator,
    store: SqliteExecutionStore
  ) => Promise<void>
): Promise<void> {
  const store = new SqliteExecutionStore(":memory:");
  const spend = new ArmedSpendLedger(spendInner);
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
    getPolicy: () => policy,
    balances: new MockBalanceProvider([
      { mint: USDC_MINT, symbol: "USDC", balanceAtomic: "0", verified: true },
      { mint: WSOL_MINT, symbol: "SOL", balanceAtomic: "5000000000", verified: true }
    ]),
    dflow,
    signer: new SimulatedSigner(),
    spend,
    wallet: "ConcurrentAgentQuotaBuyer111111111111111"
  });
  try {
    await run(spend, coordinator, store);
  } finally {
    store.close();
  }
}

describe("per-agent daily cap holds across overlapping in-flight funds", () => {
  it("lets exactly one of two concurrent $1 research funds win a $1.50 agent cap in memory", async () => {
    await withCoordinator(
      new InMemorySpendLedger(),
      policyFor({
        maxDailyUsdMicros: "20000000",
        maxDailyUsdMicrosByAgent: { research: "1500000" }
      }),
      async (spend, coordinator, store) => {
        await parkApproved(store, coordinator, "agent-race-1", "research");
        await parkApproved(store, coordinator, "agent-race-2", "research");
        const outcomes = await raceTwoFunds(
          spend,
          coordinator,
          { operationId: "agent-race-1", agentId: "research" },
          { operationId: "agent-race-2", agentId: "research" }
        );
        expect(outcomes.filter((row) => row.status === "funded")).toHaveLength(1);
        const denied = outcomes.filter((row) => row.status === "policy_denied");
        expect(denied).toHaveLength(1);
        expect(denied[0]?.policyReason).toBe("agent_daily_limit_exceeded");
        const states = [
          (await store.get("agent-race-1"))?.state,
          (await store.get("agent-race-2"))?.state
        ];
        expect(states.filter((state) => state === "funded")).toHaveLength(1);
        expect(states.filter((state) => state === "denied")).toHaveLength(1);
        expect(spend.getSpentUsdMicrosLast24h()).toBe("1000000");
        expect(spend.getSpentUsdMicrosLast24hByAgent()).toEqual({ research: "1000000" });
        const leftover = ["agent-race-1", "agent-race-2"].filter(
          (_, index) => states[index] === "denied"
        );
        expect(spend.releaseOperationSpend(leftover[0] ?? "")).toBe(false);
      }
    );
  });

  it("lets exactly one of two concurrent $1 research funds win a $1.50 agent cap in sqlite", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      await withCoordinator(
        new SqliteSpendLedger(db),
        policyFor({
          maxDailyUsdMicros: "20000000",
          maxDailyUsdMicrosByAgent: { research: "1500000" }
        }),
        async (spend, coordinator, store) => {
          await parkApproved(store, coordinator, "agent-sql-1", "research");
          await parkApproved(store, coordinator, "agent-sql-2", "research");
          const outcomes = await raceTwoFunds(
            spend,
            coordinator,
            { operationId: "agent-sql-1", agentId: "research" },
            { operationId: "agent-sql-2", agentId: "research" }
          );
          expect(outcomes.filter((row) => row.status === "funded")).toHaveLength(1);
          expect(
            outcomes.filter(
              (row) =>
                row.status === "policy_denied" && row.policyReason === "agent_daily_limit_exceeded"
            )
          ).toHaveLength(1);
          expect(spend.getSpentUsdMicrosLast24h()).toBe("1000000");
          expect(spend.getSpentUsdMicrosLast24hByAgent()).toEqual({ research: "1000000" });
        }
      );
    } finally {
      db.close();
    }
  });

  it("still admits only the legal global amount when two named agents overlap", async () => {
    await withCoordinator(
      new InMemorySpendLedger(),
      policyFor({
        maxDailyUsdMicros: "1500000",
        maxDailyUsdMicrosByAgent: { research: "5000000", ops: "12000000" }
      }),
      async (spend, coordinator, store) => {
        await parkApproved(store, coordinator, "global-race-research", "research");
        await parkApproved(store, coordinator, "global-race-ops", "ops");
        const outcomes = await raceTwoFunds(
          spend,
          coordinator,
          { operationId: "global-race-research", agentId: "research" },
          { operationId: "global-race-ops", agentId: "ops" }
        );
        expect(outcomes.filter((row) => row.status === "funded")).toHaveLength(1);
        const denied = outcomes.filter((row) => row.status === "policy_denied");
        expect(denied).toHaveLength(1);
        expect(denied[0]?.policyReason).toBe("daily_limit_exceeded");
        expect(spend.getSpentUsdMicrosLast24h()).toBe("1000000");
        const byAgent = spend.getSpentUsdMicrosLast24hByAgent();
        expect(Object.values(byAgent)).toEqual(["1000000"]);
      }
    );
  });
});

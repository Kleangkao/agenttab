import { describe, expect, it } from "vitest";
import type { PaymentPolicy } from "@agenttab/core";
import {
  createDemoPolicy,
  createGatewayRuntime,
  LOCAL_NETWORK,
  MockDFlowAdapter,
  SimulatedSigner,
  USDC_MINT,
  WSOL_MINT,
  type DeficitFundingAdapter,
  type SignableFundingPlan,
  type SignerBoundary
} from "../src/index.js";

const merchantOrigin = "http://127.0.0.1:8791";
const capUsdMicros = "1500000";

function approvePolicy(overrides: Partial<PaymentPolicy> = {}): PaymentPolicy {
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
    maxPriceImpactPct: 1,
    ...overrides
  };
}

function intentFor(operationId: string) {
  return {
    operationId,
    requestHash: `sha256:${operationId.padEnd(64, "0")}`,
    protocol: "x402" as const,
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

function failingFirstSign(): SignerBoundary {
  let signCalls = 0;
  const inner = new SimulatedSigner();
  return {
    async signFundingTransaction(plan: SignableFundingPlan) {
      signCalls += 1;
      if (signCalls === 1) throw new Error("simulated signer failure");
      return inner.signFundingTransaction(plan);
    }
  };
}

async function parkAndApprove(
  gateway: ReturnType<typeof createGatewayRuntime>,
  operationId: string
): Promise<void> {
  const parked = await gateway.coordinator.ensurePaymentAsset({ intent: intentFor(operationId) });
  expect(parked.status).toBe("approval_required");
  const record = await gateway.store.get(operationId);
  if (record === undefined) throw new Error(`missing ${operationId}`);
  await gateway.store.transition({
    operationId,
    expectedVersion: record.version,
    to: "approved",
    kind: "approval.granted"
  });
}

describe("spend reservation lifecycle", () => {
  it("resumes plan-only interruption under an unchanged cap", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy(),
      wallet: "ResumeUnchangedCapBuyer111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      signer: failingFirstSign()
    });
    try {
      await parkAndApprove(gateway, "resume-unchanged-1");
      const first = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("resume-unchanged-1")
      });
      expect(first.status).toBe("interrupted");
      expect((await gateway.store.get("resume-unchanged-1"))?.state).toBe("funding_submitted");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(
        gateway.spend.tryReserveOperationSpend("peer-during-interrupt", "1000000", capUsdMicros)
      ).toBe("cap_exceeded");

      const resumed = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("resume-unchanged-1")
      });
      expect(resumed.status).toBe("funded");
      expect((await gateway.store.get("resume-unchanged-1"))?.state).toBe("funded");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("1000000");
    } finally {
      gateway.close();
    }
  });

  it("denies and releases a plan-only resume after the cap tightens", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy(),
      wallet: "ResumeTightenCapBuyer1111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      signer: failingFirstSign()
    });
    try {
      await parkAndApprove(gateway, "resume-tighten-1");
      expect(
        (await gateway.coordinator.ensurePaymentAsset({ intent: intentFor("resume-tighten-1") }))
          .status
      ).toBe("interrupted");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");

      gateway.policies.set(approvePolicy({ maxDailyUsdMicros: "500000" }));
      const resumed = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("resume-tighten-1")
      });
      expect(resumed.status).toBe("policy_denied");
      expect((await gateway.store.get("resume-tighten-1"))?.state).toBe("denied");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(
        gateway.spend.tryReserveOperationSpend("peer-after-tighten", "1000000", capUsdMicros)
      ).toBe("reserved");
    } finally {
      gateway.close();
    }
  });

  it("keeps in-flight occupancy out of realized spend, health, and preview", async () => {
    const inner = new MockDFlowAdapter();
    let signalReady: (() => void) | undefined;
    let releasePlan: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releasePlan = resolve;
    });
    const dflow: DeficitFundingAdapter = {
      get orders() {
        return inner.orders;
      },
      planExactDeficit: async (input) => {
        signalReady?.();
        await held;
        return inner.planExactDeficit(input);
      }
    };

    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: {
        ...createDemoPolicy(merchantOrigin),
        maxDailyUsdMicros: capUsdMicros
      },
      wallet: "InFlightSpendBuyer11111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      adminToken: "adm",
      agentTokens: { research: "tok-research" },
      dflowAdapter: dflow
    });

    try {
      const first = gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("inflight-1"),
        agentId: "research"
      });
      await ready;

      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({});

      const health = await gateway.app.request("/health");
      expect(await health.json()).toMatchObject({ spentUsdMicrosLast24h: "0" });
      const spend = await gateway.app.request("/v1/spend", {
        headers: { authorization: "Bearer adm" }
      });
      expect(await spend.json()).toEqual(
        expect.objectContaining({
          spentUsdMicrosLast24h: "0",
          spentUsdMicrosLast24hByAgent: {}
        })
      );

      const preview = await gateway.app.request("/v1/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tok-research"
        },
        body: JSON.stringify(intentFor("inflight-preview-1"))
      });
      expect(preview.status).toBe(200);
      const previewBody = (await preview.json()) as { decision?: { reason?: string } };
      expect(previewBody.decision?.reason).not.toBe("daily_limit_exceeded");

      const peer = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("inflight-peer-1")
      });
      expect(peer.status).toBe("policy_denied");
      expect((await gateway.store.get("inflight-peer-1"))?.state).toBe("denied");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");

      releasePlan?.();
      expect((await first).status).toBe("funded");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("1000000");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({ research: "1000000" });
      const spentAfter = await gateway.app.request("/v1/spend", {
        headers: { authorization: "Bearer adm" }
      });
      expect(await spentAfter.json()).toEqual(
        expect.objectContaining({
          spentUsdMicrosLast24h: "1000000",
          spentUsdMicrosLast24hByAgent: { research: "1000000" }
        })
      );
    } finally {
      releasePlan?.();
      gateway.close();
    }
  });

  it("reconciles a stale reservation after terminal commit without release", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy(),
      wallet: "StaleReserveBuyer111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    try {
      const intent = intentFor("stale-terminal-1");
      const created = await gateway.store.createOrGet(intent);
      expect(
        gateway.spend.tryReserveOperationSpend(intent.operationId, "1000000", capUsdMicros)
      ).toBe("reserved");
      await gateway.store.transition({
        operationId: intent.operationId,
        expectedVersion: created.record.version,
        to: "denied",
        kind: "policy.denied",
        details: { reason: "daily_limit_exceeded" }
      });
      expect(
        gateway.spend.tryReserveOperationSpend("blocked-by-stale", "1000000", capUsdMicros)
      ).toBe("cap_exceeded");

      const retry = await gateway.coordinator.ensurePaymentAsset({ intent });
      expect(retry.status).toBe("denied");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(
        gateway.spend.tryReserveOperationSpend("after-reconcile", "1000000", capUsdMicros)
      ).toBe("reserved");
    } finally {
      gateway.close();
    }
  });

  it("releases when a plan receipt has no transaction payload", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy(),
      wallet: "MissingPlanBuyer1111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    try {
      const intent = intentFor("missing-plan-1");
      const created = await gateway.store.createOrGet(intent);
      const approved = await gateway.store.transition({
        operationId: intent.operationId,
        expectedVersion: created.record.version,
        to: "approved",
        kind: "policy.allowed"
      });
      await gateway.store.appendEvent({
        operationId: intent.operationId,
        expectedVersion: approved.version,
        kind: "funding.plan_receipt",
        details: { source: "mock" }
      });
      expect(
        gateway.spend.tryReserveOperationSpend(intent.operationId, "1000000", capUsdMicros)
      ).toBe("reserved");

      const outcome = await gateway.coordinator.ensurePaymentAsset({ intent });
      expect(outcome.status).toBe("denied");
      expect((await gateway.store.get(intent.operationId))?.state).toBe("failed");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(
        gateway.spend.tryReserveOperationSpend("after-missing-plan", "1000000", capUsdMicros)
      ).toBe("reserved");
    } finally {
      gateway.close();
    }
  });
});

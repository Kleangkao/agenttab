import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PaymentPolicy } from "@agenttab/core";
import {
  createGatewayRuntime,
  loadPolicyFile,
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

function quotaPolicy(overrides: Partial<PaymentPolicy> = {}): PaymentPolicy {
  return {
    mode: "autopay",
    allowedMerchantOrigins: [merchantOrigin],
    allowedNetworks: [LOCAL_NETWORK],
    allowedPaymentAssets: [USDC_MINT],
    allowedFundingAssets: [WSOL_MINT, USDC_MINT],
    requireVerifiedFundingAssets: true,
    maxPaymentUsdMicros: "5000000",
    maxDailyUsdMicros: "20000000",
    maxDailyUsdMicrosByAgent: { research: "1500000", ops: "12000000" },
    maxSlippageBps: 50,
    maxPriceImpactPct: 1,
    ...overrides
  };
}

function intentFor(operationId: string, extras: { amountUsdMicros?: string } = {}) {
  const amount = extras.amountUsdMicros ?? "1000000";
  return {
    operationId,
    requestHash: `sha256:${operationId.padEnd(64, "0")}`,
    protocol: "x402",
    network: LOCAL_NETWORK,
    merchantId: "127.0.0.1:8791",
    merchantOrigin,
    destination: "NeutralMerchant111111111111111111111111111",
    assetMint: USDC_MINT,
    amountAtomic: amount,
    amountUsdMicros: amount,
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

function runtime(
  policy: PaymentPolicy,
  extras: {
    adminToken?: string;
    agentTokens?: Record<string, string>;
    dbPath?: string;
    signer?: SignerBoundary;
    dflowAdapter?: DeficitFundingAdapter;
    wallet?: string;
  } = {}
) {
  return createGatewayRuntime({
    merchantOrigin,
    policy,
    initialUsdcAtomic: "0",
    initialSolAtomic: "5000000000",
    wallet: extras.wallet ?? "AgentQuotaBuyer1111111111111111111111111",
    ...(extras.adminToken === undefined ? {} : { adminToken: extras.adminToken }),
    ...(extras.agentTokens === undefined ? {} : { agentTokens: extras.agentTokens }),
    ...(extras.dbPath === undefined ? {} : { dbPath: extras.dbPath }),
    ...(extras.signer === undefined ? {} : { signer: extras.signer }),
    ...(extras.dflowAdapter === undefined ? {} : { dflowAdapter: extras.dflowAdapter })
  });
}

async function fundAs(
  gateway: ReturnType<typeof createGatewayRuntime>,
  operationId: string,
  token: string,
  extras: { amountUsdMicros?: string; extraJson?: Record<string, unknown> } = {}
) {
  const response = await gateway.app.request("/v1/fund", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      ...intentFor(operationId, extras),
      ...(extras.extraJson ?? {})
    })
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    outcome: { status: string; policyReason?: string };
    record: { agentId?: string; state: string };
  };
}

function expectOccupied(status: string): void {
  // A later operation can skip DFlow when the wallet already holds USDC
  // from a prior fund; spend is still committed for the new operationId.
  expect(["funded", "already_funded"]).toContain(status);
}

describe("per-agent daily quotas", () => {
  it("lets two named agents spend under different explicit quotas", async () => {
    const gateway = runtime(quotaPolicy(), {
      adminToken: "adm",
      agentTokens: { research: "tok-research", ops: "tok-ops" }
    });
    try {
      expectOccupied((await fundAs(gateway, "quota-research-ok", "tok-research")).outcome.status);
      expectOccupied((await fundAs(gateway, "quota-ops-ok", "tok-ops")).outcome.status);
      const spend = await (
        await gateway.app.request("/v1/spend", { headers: { authorization: "Bearer adm" } })
      ).json();
      expect(spend).toMatchObject({
        spentUsdMicrosLast24h: "2000000",
        spentUsdMicrosLast24hByAgent: { research: "1000000", ops: "1000000" }
      });
    } finally {
      gateway.close();
    }
  });

  it("stops one agent at its quota while the other can still fund", async () => {
    const gateway = runtime(quotaPolicy(), {
      adminToken: "adm",
      agentTokens: { research: "tok-research", ops: "tok-ops" }
    });
    try {
      expectOccupied((await fundAs(gateway, "quota-research-1", "tok-research")).outcome.status);
      const denied = await fundAs(gateway, "quota-research-2", "tok-research");
      expect(denied.outcome).toMatchObject({
        status: "denied",
        policyReason: "agent_daily_limit_exceeded"
      });
      expect(denied.record.state).toBe("denied");
      expectOccupied((await fundAs(gateway, "quota-ops-after", "tok-ops")).outcome.status);
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("2000000");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({
        research: "1000000",
        ops: "1000000"
      });
    } finally {
      gateway.close();
    }
  });

  it("does not let a named token consume another agent's quota or restamp identity from the intent", async () => {
    const gateway = runtime(quotaPolicy(), {
      adminToken: "adm",
      agentTokens: { research: "tok-research", ops: "tok-ops" }
    });
    try {
      await fundAs(gateway, "quota-isolation-r1", "tok-research");
      const denied = await fundAs(gateway, "quota-isolation-r2", "tok-research", {
        extraJson: { agentId: "ops" }
      });
      expect(denied.outcome.policyReason).toBe("agent_daily_limit_exceeded");
      expect(denied.record.agentId).toBe("research");

      const stolen = await gateway.app.request("/v1/fund", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tok-ops"
        },
        body: JSON.stringify(intentFor("quota-isolation-r1"))
      });
      expect(stolen.status).toBe(409);
      expect(await stolen.json()).toMatchObject({ error: "agent_mismatch" });

      const asOps = await gateway.app.request("/v1/executions/quota-isolation-r1", {
        headers: { authorization: "Bearer tok-ops" }
      });
      expect(asOps.status).toBe(404);

      expectOccupied((await fundAs(gateway, "quota-isolation-ops", "tok-ops")).outcome.status);
    } finally {
      gateway.close();
    }
  });

  it("keeps the gateway-wide cap as the combined ceiling for named plus unattributed spend", async () => {
    const gateway = runtime(
      quotaPolicy({
        maxDailyUsdMicros: "1500000",
        maxDailyUsdMicrosByAgent: { research: "5000000", ops: "12000000" }
      }),
      { agentTokens: { research: "tok-research", ops: "tok-ops" } }
    );
    try {
      expect(
        (
          await gateway.coordinator.ensurePaymentAsset({
            intent: intentFor("quota-global-research"),
            agentId: "research"
          })
        ).status
      ).toBe("funded");
      const unattributed = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-global-open")
      });
      expect(unattributed).toMatchObject({
        status: "denied",
        policyReason: "daily_limit_exceeded"
      });
      const ops = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-global-ops"),
        agentId: "ops"
      });
      expect(ops).toMatchObject({
        status: "denied",
        policyReason: "daily_limit_exceeded"
      });
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("1000000");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({ research: "1000000" });
    } finally {
      gateway.close();
    }
  });

  it("leaves unattributed operations on the global cap only", async () => {
    const gateway = runtime(
      quotaPolicy({
        maxDailyUsdMicros: "1500000",
        maxDailyUsdMicrosByAgent: { research: "5000000" }
      })
    );
    try {
      const first = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-open-1")
      });
      expect(first.status).toBe("funded");
      expect((await gateway.store.get("quota-open-1"))?.agentId).toBeUndefined();
      const second = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-open-2")
      });
      expect(second).toMatchObject({
        status: "denied",
        policyReason: "daily_limit_exceeded"
      });
      expect(second.policyReason).not.toBe("agent_daily_limit_exceeded");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({});
    } finally {
      gateway.close();
    }
  });

  it("treats a named agent with no map entry as global-cap-only", async () => {
    const gateway = runtime(
      quotaPolicy({
        maxDailyUsdMicros: "2500000",
        maxDailyUsdMicrosByAgent: { ops: "12000000" }
      }),
      { agentTokens: { research: "tok-research", ops: "tok-ops" } }
    );
    try {
      expectOccupied((await fundAs(gateway, "quota-omitted-r1", "tok-research")).outcome.status);
      expectOccupied((await fundAs(gateway, "quota-omitted-r2", "tok-research")).outcome.status);
      const third = await fundAs(gateway, "quota-omitted-r3", "tok-research");
      expect(third.outcome).toMatchObject({
        status: "denied",
        policyReason: "daily_limit_exceeded"
      });
      expect((await fundAs(gateway, "quota-omitted-ops", "tok-ops")).outcome).toMatchObject({
        status: "denied",
        policyReason: "daily_limit_exceeded"
      });
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({ research: "2000000" });
    } finally {
      gateway.close();
    }
  });

  it("does not reserve parked approval_required operations", async () => {
    const gateway = runtime(quotaPolicy({ mode: "approve" }), {
      agentTokens: { research: "tok-research" }
    });
    try {
      for (const operationId of ["quota-park-1", "quota-park-2"]) {
        const parked = await gateway.coordinator.ensurePaymentAsset({
          intent: intentFor(operationId),
          agentId: "research"
        });
        expect(parked.status).toBe("approval_required");
      }
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(
        gateway.spend.tryReserveOperationSpend(
          "quota-park-peer",
          "1000000",
          "20000000",
          "research",
          "1500000"
        )
      ).toBe("reserved");
      expect(gateway.spend.releaseOperationSpend("quota-park-peer")).toBe(true);
    } finally {
      gateway.close();
    }
  });

  it("re-binds a tightened per-agent quota when a parked approval is later approved", async () => {
    const gateway = runtime(quotaPolicy({ mode: "approve" }), {
      agentTokens: { research: "tok-research" }
    });
    try {
      const parked = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-rebind-1"),
        agentId: "research"
      });
      expect(parked.status).toBe("approval_required");
      gateway.policies.set(
        quotaPolicy({
          mode: "approve",
          maxDailyUsdMicrosByAgent: { research: "500000", ops: "12000000" }
        })
      );
      const record = await gateway.store.get("quota-rebind-1");
      if (record === undefined) throw new Error("missing parked record");
      await gateway.store.transition({
        operationId: "quota-rebind-1",
        expectedVersion: record.version,
        to: "approved",
        kind: "approval.granted"
      });
      const approved = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-rebind-1"),
        agentId: "research"
      });
      expect(approved).toMatchObject({
        status: "policy_denied",
        policyReason: "agent_daily_limit_exceeded"
      });
      expect((await gateway.store.get("quota-rebind-1"))?.state).toBe("denied");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(
        gateway.spend.tryReserveOperationSpend(
          "quota-rebind-peer",
          "1000000",
          "20000000",
          "research",
          "1500000"
        )
      ).toBe("reserved");
    } finally {
      gateway.close();
    }
  });

  it("resumes plan-only interruption under an unchanged per-agent quota", async () => {
    const gateway = runtime(quotaPolicy(), {
      signer: failingFirstSign(),
      agentTokens: { research: "tok-research" },
      wallet: "QuotaResumeUnchangedBuyer1111111111111111"
    });
    try {
      const first = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-resume-ok"),
        agentId: "research"
      });
      expect(first.status).toBe("interrupted");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(
        gateway.spend.tryReserveOperationSpend(
          "quota-resume-peer",
          "1000000",
          "20000000",
          "research",
          "1500000"
        )
      ).toBe("agent_cap_exceeded");

      const resumed = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-resume-ok"),
        agentId: "research"
      });
      expect(resumed.status).toBe("funded");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("1000000");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({ research: "1000000" });
      expect(gateway.spend.ensureOperationSpend("quota-resume-ok", "1000000", "research")).toBe(
        false
      );
    } finally {
      gateway.close();
    }
  });

  it("denies and releases when an applicable per-agent quota tightens before plan-only resume", async () => {
    const gateway = runtime(quotaPolicy(), {
      signer: failingFirstSign(),
      wallet: "QuotaResumeTightenBuyer111111111111111111"
    });
    try {
      const first = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-resume-tight"),
        agentId: "research"
      });
      expect(first.status).toBe("interrupted");
      gateway.policies.set(
        quotaPolicy({ maxDailyUsdMicrosByAgent: { research: "500000", ops: "12000000" } })
      );
      const resumed = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-resume-tight"),
        agentId: "research"
      });
      expect(resumed).toMatchObject({
        status: "policy_denied",
        policyReason: "agent_daily_limit_exceeded"
      });
      expect((await gateway.store.get("quota-resume-tight"))?.state).toBe("denied");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({});
      expect(
        gateway.spend.tryReserveOperationSpend(
          "quota-after-release",
          "1000000",
          "20000000",
          "research",
          "1500000"
        )
      ).toBe("reserved");
    } finally {
      gateway.close();
    }
  });

  it("does not claw back funded or paid spend after a later per-agent tighten, and still resumes a side-effect receipt", async () => {
    let signCalls = 0;
    const inner = new SimulatedSigner();
    const signer: SignerBoundary = {
      async signFundingTransaction(plan: SignableFundingPlan) {
        signCalls += 1;
        if (signCalls === 1) throw new Error("simulated signer failure");
        return inner.signFundingTransaction(plan);
      }
    };
    const adapter: DeficitFundingAdapter = {
      orders: [],
      planExactDeficit: async (input) => ({
        inputMint: WSOL_MINT,
        outputMint: USDC_MINT,
        inputAmountAtomic: "1000",
        outputAmountAtomic: input.targetOutputAtomic,
        minimumOutputAtomic: input.targetOutputAtomic,
        priceImpactPct: "0",
        transaction: JSON.stringify({
          type: "devnet-mint-plan",
          mintSignature: "side-effect-sig-agent-quota",
          userPublicKey: input.userPublicKey
        }),
        plan: {
          inputAmountAtomic: "1000",
          expectedOutputAtomic: input.targetOutputAtomic,
          minimumOutputAtomic: input.targetOutputAtomic,
          priceImpactPct: "0",
          quoteRequests: 1,
          minimized: true
        },
        source: "devnet-mint"
      })
    };
    const gateway = runtime(quotaPolicy(), {
      signer,
      dflowAdapter: adapter,
      wallet: "QuotaSideEffectBuyer111111111111111111111"
    });
    try {
      const first = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-side-effect-1"),
        agentId: "research"
      });
      expect(first.status).toBe("interrupted");
      gateway.policies.set(
        quotaPolicy({ maxDailyUsdMicrosByAgent: { research: "1", ops: "12000000" } })
      );
      const resumed = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-side-effect-1"),
        agentId: "research"
      });
      expect(resumed.status).toBe("funded");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({ research: "1000000" });

      const again = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-side-effect-1"),
        agentId: "research"
      });
      expect(again.status).toBe("already_funded");
      expect(gateway.spend.ensureOperationSpend("quota-side-effect-1", "1000000", "research")).toBe(
        false
      );
    } finally {
      gateway.close();
    }
  });

  it("keeps in-flight agent occupancy out of realized totals and counts it toward both caps", async () => {
    const inner = new MockDFlowAdapter();
    let signalReady: (() => void) | undefined;
    let releasePlan: (() => void) | undefined;
    let holdFirstPlan = true;
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
        if (holdFirstPlan) {
          holdFirstPlan = false;
          signalReady?.();
          await held;
        }
        return inner.planExactDeficit(input);
      }
    };
    const gateway = runtime(quotaPolicy(), {
      adminToken: "adm",
      agentTokens: { research: "tok-research", ops: "tok-ops" },
      dflowAdapter: dflow
    });
    try {
      const first = gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-inflight-1"),
        agentId: "research"
      });
      await ready;
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({});

      const preview = await gateway.app.request("/v1/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tok-research"
        },
        body: JSON.stringify(intentFor("quota-inflight-preview"))
      });
      expect((await preview.json() as { decision?: { reason?: string } }).decision?.reason).not.toBe(
        "agent_daily_limit_exceeded"
      );

      const sameAgent = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-inflight-same"),
        agentId: "research"
      });
      expect(sameAgent).toMatchObject({
        status: "policy_denied",
        policyReason: "agent_daily_limit_exceeded"
      });
      const otherAgent = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-inflight-ops"),
        agentId: "ops"
      });
      expect(otherAgent.status).toBe("funded");

      releasePlan?.();
      expect((await first).status).toBe("funded");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("2000000");
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({
        research: "1000000",
        ops: "1000000"
      });
    } finally {
      releasePlan?.();
      gateway.close();
    }
  });

  it("rejects malformed per-agent caps instead of treating them as unlimited", async () => {
    const gateway = runtime(quotaPolicy(), { adminToken: "adm" });
    try {
      const response = await gateway.app.request("/v1/policy", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer adm"
        },
        body: JSON.stringify({
          ...quotaPolicy(),
          maxDailyUsdMicrosByAgent: { research: "unlimited" }
        })
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_policy" });
      expect(gateway.policies.get().maxDailyUsdMicrosByAgent).toEqual({
        research: "1500000",
        ops: "12000000"
      });
    } finally {
      gateway.close();
    }
  });

  it("keeps example policies without per-agent quotas valid and fundable", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/autopay.local.json")
    );
    expect(policy.maxDailyUsdMicrosByAgent).toBeUndefined();
    const gateway = runtime(policy);
    try {
      const outcome = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("quota-compat-1")
      });
      expect(outcome.status).toBe("funded");
    } finally {
      gateway.close();
    }
  });

  it("enforces the same per-agent contract on the durable sqlite spend ledger", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenttab-quota-"));
    const gateway = runtime(quotaPolicy(), {
      adminToken: "adm",
      agentTokens: { research: "tok-research", ops: "tok-ops" },
      dbPath: join(dir, "gateway.db")
    });
    try {
      expectOccupied((await fundAs(gateway, "quota-sqlite-r1", "tok-research")).outcome.status);
      const denied = await fundAs(gateway, "quota-sqlite-r2", "tok-research");
      expect(denied.outcome.policyReason).toBe("agent_daily_limit_exceeded");
      expectOccupied((await fundAs(gateway, "quota-sqlite-ops", "tok-ops")).outcome.status);
      expect(gateway.spend.getSpentUsdMicrosLast24hByAgent()).toEqual({
        research: "1000000",
        ops: "1000000"
      });
    } finally {
      gateway.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

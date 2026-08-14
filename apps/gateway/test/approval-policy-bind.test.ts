import { describe, expect, it } from "vitest";
import type { PaymentPolicy } from "@agenttab/core";
import {
  createGatewayRuntime,
  LOCAL_NETWORK,
  SimulatedSigner,
  USDC_MINT,
  WSOL_MINT,
  type SignableFundingPlan,
  type SignerBoundary
} from "../src/index.js";

const merchantOrigin = "http://127.0.0.1:8791";

function approvePolicy(overrides: Partial<PaymentPolicy> = {}): PaymentPolicy {
  return {
    mode: "approve",
    allowedMerchantOrigins: [merchantOrigin],
    allowedNetworks: [LOCAL_NETWORK],
    allowedPaymentAssets: [USDC_MINT],
    allowedFundingAssets: [WSOL_MINT, USDC_MINT],
    requireVerifiedFundingAssets: true,
    maxPaymentUsdMicros: "5000000",
    maxDailyUsdMicros: "1500000",
    maxSlippageBps: 50,
    maxPriceImpactPct: 1,
    ...overrides
  };
}

function intentFor(operationId: string, extras: { amountUsdMicros?: string; expiresAt?: string } = {}) {
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
    resource: `${merchantOrigin}/v1/market-snapshot`,
    ...(extras.expiresAt === undefined ? {} : { expiresAt: extras.expiresAt })
  };
}

async function park(gateway: ReturnType<typeof createGatewayRuntime>, operationId: string) {
  const intent = intentFor(operationId);
  const outcome = await gateway.coordinator.ensurePaymentAsset({ intent });
  expect(outcome.status).toBe("approval_required");
  expect((await gateway.store.get(operationId))?.state).toBe("approval_required");
  return intent;
}

async function postApprove(gateway: ReturnType<typeof createGatewayRuntime>, operationId: string) {
  return gateway.app.request(`/v1/approvals/${operationId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
}

describe("approval cannot override hard policy denials", () => {
  it("refuses later parked approvals once realized spend would pass the daily cap", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy(),
      wallet: "CapBindBuyer111111111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      await park(gateway, "cap-park-1");
      await park(gateway, "cap-park-2");
      await park(gateway, "cap-park-3");

      const first = await postApprove(gateway, "cap-park-1");
      const second = await postApprove(gateway, "cap-park-2");
      const third = await postApprove(gateway, "cap-park-3");
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(200);

      const firstBody = (await first.json()) as {
        outcome: { status: string; policyReason?: string };
        record: { state: string };
      };
      const secondBody = (await second.json()) as {
        outcome: { status: string; policyReason?: string; reason: string };
        record: { state: string; events: Array<{ kind: string; details?: { afterApproval?: boolean } }> };
      };
      const thirdBody = (await third.json()) as {
        outcome: { status: string; policyReason?: string };
        record: { state: string };
      };

      expect(firstBody.record.state).toBe("funded");
      expect(["funded", "already_funded"]).toContain(firstBody.outcome.status);

      expect(secondBody.outcome.status).toBe("policy_denied");
      expect(secondBody.outcome.policyReason).toBe("daily_limit_exceeded");
      expect(secondBody.record.state).toBe("denied");
      expect(secondBody.record.events.some((event) => event.kind === "approval.granted")).toBe(true);
      expect(secondBody.record.events.some((event) => event.kind === "policy.denied")).toBe(true);
      expect(secondBody.record.events.some((event) => event.kind === "funding.confirmed")).toBe(
        false
      );
      expect(
        secondBody.record.events.find((event) => event.kind === "policy.denied")?.details
      ).toMatchObject({ afterApproval: true });

      expect(thirdBody.outcome.status).toBe("policy_denied");
      expect(thirdBody.outcome.policyReason).toBe("daily_limit_exceeded");
      expect(thirdBody.record.state).toBe("denied");

      expect((await gateway.store.get("cap-park-1"))?.state).toBe("funded");
      expect((await gateway.store.get("cap-park-2"))?.state).toBe("denied");
      expect((await gateway.store.get("cap-park-3"))?.state).toBe("denied");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("1000000");
    } finally {
      gateway.close();
    }
  });

  it("does not fund an approval after the parked challenge expires", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy({ maxDailyUsdMicros: "20000000" }),
      wallet: "ExpiryBindBuyer111111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      const created = await gateway.store.createOrGet(
        intentFor("expiry-park-1", { expiresAt: new Date(Date.now() - 60_000).toISOString() })
      );
      await gateway.store.transition({
        operationId: created.record.operationId,
        expectedVersion: created.record.version,
        to: "approval_required",
        kind: "policy.approval_required",
        details: { reason: "approval_threshold_exceeded" }
      });

      const response = await postApprove(gateway, "expiry-park-1");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        outcome: { status: string; policyReason?: string };
        record: { state: string };
      };
      expect(body.outcome.status).toBe("policy_denied");
      expect(body.outcome.policyReason).toBe("challenge_expired");
      expect(body.record.state).toBe("denied");
      expect((await gateway.store.get("expiry-park-1"))?.state).toBe("denied");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
    } finally {
      gateway.close();
    }
  });

  it("rebinds a tightened policy at approve time, not at park time", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy({ maxDailyUsdMicros: "20000000" }),
      wallet: "TightenBindBuyer11111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      await park(gateway, "tighten-merchant-1");
      await park(gateway, "tighten-asset-1");
      await park(gateway, "tighten-cap-1");

      gateway.policies.set(
        approvePolicy({
          maxDailyUsdMicros: "20000000",
          deniedMerchantOrigins: [merchantOrigin]
        })
      );
      const merchant = (await (await postApprove(gateway, "tighten-merchant-1")).json()) as {
        outcome: { status: string; policyReason?: string };
        record: { state: string };
      };
      expect(merchant.outcome.status).toBe("policy_denied");
      expect(merchant.outcome.policyReason).toBe("merchant_denied");
      expect(merchant.record.state).toBe("denied");

      gateway.policies.set(
        approvePolicy({
          maxDailyUsdMicros: "20000000",
          allowedPaymentAssets: [WSOL_MINT]
        })
      );
      const asset = (await (await postApprove(gateway, "tighten-asset-1")).json()) as {
        outcome: { status: string; policyReason?: string };
        record: { state: string };
      };
      expect(asset.outcome.status).toBe("policy_denied");
      expect(asset.outcome.policyReason).toBe("payment_asset_not_allowed");
      expect(asset.record.state).toBe("denied");

      gateway.policies.set(approvePolicy({ maxDailyUsdMicros: "500000" }));
      const cap = (await (await postApprove(gateway, "tighten-cap-1")).json()) as {
        outcome: { status: string; policyReason?: string };
        record: { state: string };
      };
      expect(cap.outcome.status).toBe("policy_denied");
      expect(cap.outcome.policyReason).toBe("daily_limit_exceeded");
      expect(cap.record.state).toBe("denied");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
    } finally {
      gateway.close();
    }
  });

  it("does not claw back an already funded or paid operation when the cap tightens", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy({ maxDailyUsdMicros: "20000000" }),
      wallet: "FundedBindBuyer111111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      await park(gateway, "already-funded-1");
      const funded = await postApprove(gateway, "already-funded-1");
      expect(funded.status).toBe(200);
      expect((await gateway.store.get("already-funded-1"))?.state).toBe("funded");

      gateway.policies.set(approvePolicy({ maxDailyUsdMicros: "1" }));

      const again = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("already-funded-1")
      });
      expect(again.status).toBe("already_funded");
      expect((await gateway.store.get("already-funded-1"))?.state).toBe("funded");

      const pay = await gateway.app.request("/v1/executions/already-funded-1/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(pay.status).toBe(200);
      expect((await gateway.store.get("already-funded-1"))?.state).toBe("paid");

      const replay = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("already-funded-1")
      });
      expect(replay.status).toBe("already_paid");
      expect((await gateway.store.get("already-funded-1"))?.state).toBe("paid");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("1000000");
    } finally {
      gateway.close();
    }
  });

  it("still resumes interrupted funding after a later hard policy tighten", async () => {
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
      merchantOrigin,
      policy: approvePolicy({ maxDailyUsdMicros: "20000000" }),
      wallet: "InterruptBindBuyer111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      signer
    });

    try {
      await park(gateway, "interrupt-resume-1");
      const first = await postApprove(gateway, "interrupt-resume-1");
      expect(first.status).toBe(200);
      const parkedFund = (await first.json()) as { outcome: { status: string } };
      expect(parkedFund.outcome.status).toBe("interrupted");
      expect((await gateway.store.get("interrupt-resume-1"))?.state).toBe("funding_submitted");

      gateway.policies.set(
        approvePolicy({
          maxDailyUsdMicros: "20000000",
          deniedMerchantOrigins: [merchantOrigin]
        })
      );

      const resumed = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("interrupt-resume-1")
      });
      expect(resumed.status).toBe("funded");
      expect((await gateway.store.get("interrupt-resume-1"))?.state).toBe("funded");
    } finally {
      gateway.close();
    }
  });
});

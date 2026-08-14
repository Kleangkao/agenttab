import { describe, expect, it } from "vitest";
import type { PaymentPolicy } from "@agenttab/core";
import {
  createGatewayRuntime,
  LOCAL_NETWORK,
  USDC_MINT,
  WSOL_MINT
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
    maxDailyUsdMicros: "20000000",
    maxSlippageBps: 50,
    maxPriceImpactPct: 1,
    ...overrides
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
    amountAtomic: "1000",
    amountUsdMicros: "1000",
    resource: `${merchantOrigin}/v1/market-snapshot`
  };
}

describe("parked approval TTL", () => {
  it("rejects approve after the default park TTL and flags the row as expired", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy(),
      wallet: "ParkTtlBuyer11111111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      const created = await gateway.store.createOrGet(intentFor("park-ttl-default-1"));
      await gateway.store.transition({
        operationId: created.record.operationId,
        expectedVersion: created.record.version,
        to: "approval_required",
        kind: "policy.approval_required",
        details: { reason: "approval_threshold_exceeded" },
        now: new Date(Date.now() - 2 * 60 * 60 * 1000)
      });

      const listed = (await (
        await gateway.app.request("/v1/executions?state=approval_required", {
          headers: { authorization: "Bearer unused" }
        })
      ).json()) as {
        liveCount: number;
        expiredCount: number;
        expired: Array<{ operationId: string; parkedExpired?: boolean }>;
      };
      expect(listed.expiredCount).toBe(1);
      expect(listed.liveCount).toBe(0);
      expect(listed.expired[0]).toMatchObject({
        operationId: "park-ttl-default-1",
        parkedExpired: true
      });

      const planted = await gateway.store.get("park-ttl-default-1");
      const parkedEvent = planted?.events.find((event) => event.kind === "policy.approval_required");
      expect(new Date(parkedEvent?.at ?? "").getTime()).toBeLessThan(Date.now() - 60 * 60 * 1000);

      const health = (await (await gateway.app.request("/health")).json()) as {
        parkedCount: number;
        expiredParkedCount: number;
      };
      expect(health.parkedCount).toBe(0);
      expect(health.expiredParkedCount).toBe(1);

      const response = await gateway.app.request("/v1/approvals/park-ttl-default-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        outcome: { status: string; policyReason?: string };
        record: { state: string };
      };
      expect(body.outcome.status).toBe("policy_denied");
      expect(body.outcome.policyReason).toBe("parked_approval_expired");
      expect(body.record.state).toBe("denied");
      expect((await gateway.store.get("park-ttl-default-1"))?.state).toBe("denied");
    } finally {
      gateway.close();
    }
  });

  it("still funds a live park inside a configured TTL", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy({ parkedApprovalTtlSeconds: 3600 }),
      wallet: "ParkTtlLiveBuyer1111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      const outcome = await gateway.coordinator.ensurePaymentAsset({
        intent: intentFor("park-ttl-live-1")
      });
      expect(outcome.status).toBe("approval_required");
      const approved = await gateway.app.request("/v1/approvals/park-ttl-live-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(approved.status).toBe(200);
      expect((await gateway.store.get("park-ttl-live-1"))?.state).toBe("funded");
    } finally {
      gateway.close();
    }
  });
});

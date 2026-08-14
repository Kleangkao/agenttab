import { describe, expect, it } from "vitest";
import type { PaymentPolicy } from "@agenttab/core";
import {
  createGatewayRuntime,
  LOCAL_NETWORK,
  USDC_MINT,
  WSOL_MINT
} from "../src/index.js";

/**
 * Regression for approval-as-policy-override.
 * Uses only spend totals and execution states that existed before
 * `policy_denied` so this file compiles and runs against main.
 */
const merchantOrigin = "http://127.0.0.1:8791";

function approvePolicy(): PaymentPolicy {
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

describe("daily cap holds across sequential approvals", () => {
  it("does not let N parked $1 approvals push realized spend past a $1.50 cap", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy(),
      wallet: "CapRegressionBuyer11111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      for (const operationId of ["cap-reg-1", "cap-reg-2", "cap-reg-3"]) {
        const outcome = await gateway.coordinator.ensurePaymentAsset({
          intent: intentFor(operationId)
        });
        expect(outcome.status).toBe("approval_required");
        expect((await gateway.store.get(operationId))?.state).toBe("approval_required");
      }

      for (const operationId of ["cap-reg-1", "cap-reg-2", "cap-reg-3"]) {
        const response = await gateway.app.request(`/v1/approvals/${operationId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        });
        expect(response.status).toBe(200);
      }

      const states = [];
      for (const operationId of ["cap-reg-1", "cap-reg-2", "cap-reg-3"]) {
        states.push((await gateway.store.get(operationId))?.state);
      }
      const funded = states.filter((state) => state === "funded").length;
      expect(funded).toBeLessThanOrEqual(1);
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("1000000");
    } finally {
      gateway.close();
    }
  });
});

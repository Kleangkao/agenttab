import { describe, expect, it } from "vitest";
import type { PaymentPolicy } from "@agenttab/core";
import {
  createGatewayRuntime,
  LOCAL_NETWORK,
  USDC_MINT,
  WSOL_MINT
} from "../src/index.js";

/**
 * Baseline characterization for Issue #3, not a per-agent schema test.
 *
 * Compiles and runs on unmodified `fdf55fa` (named-agent identity + gateway-wide
 * cap only). A named agent can occupy the entire `maxDailyUsdMicros` budget;
 * a second named agent with $0 realized spend is then denied as
 * `daily_limit_exceeded`.
 *
 * On the Issue #3 branch this file stays green because omitted
 * `maxDailyUsdMicrosByAgent` means global-cap-only. Per-agent enforcement is
 * proven in `agent-daily-quota.test.ts` and `agent-daily-quota-concurrent.test.ts`.
 */
const merchantOrigin = "http://127.0.0.1:8791";

function globalOnlyPolicy(): PaymentPolicy {
  return {
    mode: "autopay",
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

describe("named agents share one gateway-wide daily cap when no per-agent map is set", () => {
  it("lets research exhaust the global cap and then blocks ops who have spent nothing", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: globalOnlyPolicy(),
      adminToken: "adm",
      agentTokens: { research: "tok-research", ops: "tok-ops" },
      wallet: "BaselineQuotaBuyer11111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      const research = await gateway.app.request("/v1/fund", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tok-research"
        },
        body: JSON.stringify(intentFor("baseline-research-1"))
      });
      expect(research.status).toBe(200);
      const researchBody = (await research.json()) as {
        outcome: { status: string };
        record: { agentId?: string; state: string };
      };
      expect(researchBody.outcome.status).toBe("funded");
      expect(researchBody.record).toMatchObject({ agentId: "research", state: "funded" });

      const ops = await gateway.app.request("/v1/fund", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tok-ops"
        },
        body: JSON.stringify(intentFor("baseline-ops-1"))
      });
      expect(ops.status).toBe(200);
      const opsBody = (await ops.json()) as {
        outcome: { status: string; policyReason?: string };
        record: { agentId?: string; state: string };
      };
      // Autopay denies from `discovered` as `denied`. `policy_denied` is the
      // after-approval status used by the T1/Issue #2 approve-mode tests.
      expect(opsBody.outcome.status).toBe("denied");
      expect(opsBody.outcome.policyReason).toBe("daily_limit_exceeded");
      expect(opsBody.record).toMatchObject({ agentId: "ops", state: "denied" });

      const spend = await (
        await gateway.app.request("/v1/spend", {
          headers: { authorization: "Bearer adm" }
        })
      ).json();
      expect(spend).toMatchObject({
        spentUsdMicrosLast24h: "1000000",
        spentUsdMicrosLast24hByAgent: { research: "1000000" }
      });
      expect(
        (spend as { spentUsdMicrosLast24hByAgent: Record<string, string> })
          .spentUsdMicrosLast24hByAgent.ops
      ).toBeUndefined();
    } finally {
      gateway.close();
    }
  });
});

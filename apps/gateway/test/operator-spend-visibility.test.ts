import { describe, expect, it } from "vitest";
import type { PaymentPolicy } from "@agenttab/core";
import { createGatewayRuntime, LOCAL_NETWORK, USDC_MINT, WSOL_MINT } from "../src/index.js";
import { operatorHtml, operatorJs } from "../src/ui/operator-page.js";

/**
 * Cap decisions count realized spend PLUS in-flight reservations. An operator
 * surface that shows realized alone advertises headroom the gateway will refuse
 * to use, so the reserved figure has to reach the console.
 */
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

describe("operator spend visibility", () => {
  it("reports in-flight reservations separately from realized spend", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: approvePolicy(),
      adminToken: "spend-admin",
      wallet: "SpendVisibilityBuyer111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      const auth = { authorization: "Bearer spend-admin" };

      const before = (await (await gateway.app.request("/v1/spend", { headers: auth })).json()) as {
        spentUsdMicrosLast24h: string;
        reservedUsdMicros: string;
      };
      expect(before.spentUsdMicrosLast24h).toBe("0");
      expect(before.reservedUsdMicros).toBe("0");

      gateway.spend.tryReserveOperationSpend("hold-1", "1000000", "20000000");

      const held = (await (await gateway.app.request("/v1/spend", { headers: auth })).json()) as {
        spentUsdMicrosLast24h: string;
        reservedUsdMicros: string;
      };
      expect(held.spentUsdMicrosLast24h).toBe("0");
      expect(held.reservedUsdMicros).toBe("1000000");

      const health = (await (await gateway.app.request("/health")).json()) as {
        spentUsdMicrosLast24h: string;
        reservedUsdMicros: string;
      };
      expect(health.reservedUsdMicros).toBe("1000000");

      gateway.spend.releaseOperationSpend("hold-1");
      const released = (await (
        await gateway.app.request("/v1/spend", { headers: auth })
      ).json()) as { reservedUsdMicros: string };
      expect(released.reservedUsdMicros).toBe("0");

      gateway.spend.tryReserveOperationSpend("hold-2", "2000000", "20000000");
      gateway.spend.ensureOperationSpend("hold-2", "2000000");
      const realized = (await (
        await gateway.app.request("/v1/spend", { headers: auth })
      ).json()) as { spentUsdMicrosLast24h: string; reservedUsdMicros: string };
      expect(realized.spentUsdMicrosLast24h).toBe("2000000");
      expect(realized.reservedUsdMicros).toBe("0");
    } finally {
      gateway.close();
    }
  });

  it("renders held funds in the stance line so headroom is not overstated", () => {
    const js = operatorJs();
    expect(js).toContain("reservedUsdMicros");
    expect(js).toContain("held in flight");
  });

  it("ships judge landing, mode badge, and chain proof in the operator console", () => {
    const html = operatorHtml({
      adminRequired: false,
      policyMode: "observe"
    });
    const js = operatorJs();
    expect(html).toContain('id="mode-badge"');
    expect(html).toContain('id="judge-stats"');
    expect(js).toContain("renderJudgeLanding");
    expect(js).toContain("renderModeBadge");
    expect(js).toContain("renderChainProof");
    expect(js).toContain("Held in flight");
    expect(js).toContain("Already proven on Solana Mainnet");
    expect(js).toContain(
      "DFlow is required here: without the exact-deficit swap, the agent stops at insufficient funds."
    );
  });
});

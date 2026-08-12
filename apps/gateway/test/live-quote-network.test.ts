import { describe, expect, it } from "vitest";
import {
  DEMO_PAYMENT_AMOUNT_ATOMIC,
  DEMO_PAYMENT_USD_MICROS,
  LOCAL_NETWORK,
  USDC_MINT,
  createGatewayRuntime
} from "../src/index.js";

/**
 * Optional live network check. Skips automatically when DFlow is unreachable
 * or rate-limited. Never broadcasts: quote-only path with simulated balances/signer.
 */
describe.skipIf(process.env.AGENTTAB_NETWORK_TESTS !== "1")(
  "live-quote funding mode (network)",
  () => {
  it("funds a USDC deficit using real DFlow developer quotes without broadcasting", async () => {
    let reachable = true;
    try {
      const probe = await fetch(
        "https://dev-quote-api.dflow.net/order?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000&slippageBps=50",
        { signal: AbortSignal.timeout(8_000) }
      );
      reachable = probe.ok;
      if (probe.ok) {
        const body = await probe.text();
        if (!body.trim()) reachable = false;
      }
    } catch {
      reachable = false;
    }
    if (!reachable) {
      console.warn("Skipping live-quote network test: DFlow dev API unreachable/rate-limited");
      return;
    }

    const gateway = createGatewayRuntime({
      fundingMode: "live-quote",
      merchantOrigin: "http://merchant.local",
      initialUsdcAtomic: "200000",
      initialSolAtomic: "5000000000"
    });

    try {
      expect(gateway.fundingMode).toBe("live-quote");
      const outcome = await gateway.coordinator.ensurePaymentAsset({
        intent: {
          operationId: `live-quote-net-${Date.now()}`,
          requestHash: "sha256:live-quote-network-test-1",
          protocol: "x402",
          network: LOCAL_NETWORK,
          merchantId: "merchant.local",
          merchantOrigin: "http://merchant.local",
          destination: "PaidApiMerchantDest11111111111111111111111",
          assetMint: USDC_MINT,
          amountAtomic: DEMO_PAYMENT_AMOUNT_ATOMIC,
          amountUsdMicros: DEMO_PAYMENT_USD_MICROS,
          resource: "http://merchant.local/v1/research"
        }
      });

      if (outcome.status === "denied") {
        console.warn(
          `Skipping live-quote network test after transient DFlow denial: ${outcome.reason}`
        );
        return;
      }

      expect(outcome.status).toBe("funded");
      expect(gateway.dflow.orders).toHaveLength(1);
      expect(gateway.dflow.orders[0]?.source).toBe("live-quote");
      expect(JSON.parse(gateway.dflow.orders[0]!.transaction).broadcast).toBe(false);
      expect(BigInt(gateway.balances.get(USDC_MINT)!.balanceAtomic)).toBeGreaterThanOrEqual(
        BigInt(DEMO_PAYMENT_AMOUNT_ATOMIC)
      );
    } finally {
      gateway.close();
    }
  }, 60_000);
});

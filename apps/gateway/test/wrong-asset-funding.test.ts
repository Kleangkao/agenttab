import { describe, expect, it } from "vitest";
import {
  createDemoPolicy,
  createGatewayRuntime,
  MockBalanceProvider,
  USDC_MINT,
  WSOL_MINT
} from "../src/index.js";

const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

describe("wrong-asset exact-deficit funding", () => {
  it("swaps an allowed non-SOL asset when the wallet has no SOL", async () => {
    const merchantOrigin = "http://merchant.local";
    const policy = {
      ...createDemoPolicy(merchantOrigin),
      allowedFundingAssets: [WSOL_MINT, USDT_MINT]
    };
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy,
      wallet: "WrongAssetBuyer11111111111111111111111111",
      balances: new MockBalanceProvider([
        {
          mint: USDC_MINT,
          symbol: "USDC",
          balanceAtomic: "0",
          verified: true
        },
        {
          mint: WSOL_MINT,
          symbol: "SOL",
          balanceAtomic: "0",
          verified: true
        },
        {
          mint: USDT_MINT,
          symbol: "USDT",
          balanceAtomic: "5000000",
          verified: true
        }
      ])
    });

    const outcome = await gateway.coordinator.ensurePaymentAsset({
      intent: {
        operationId: "wrong-asset-usdt-1",
        requestHash: "sha256:wrong-asset-usdt-001",
        protocol: "x402",
        network: "solana:local",
        merchantId: "merchant.local",
        merchantOrigin,
        destination: "PaidApiMerchantDest11111111111111111111111",
        assetMint: USDC_MINT,
        amountAtomic: "1000",
        amountUsdMicros: "1000",
        resource: `${merchantOrigin}/v1/research`
      }
    });

    expect(outcome.status).toBe("funded");
    expect(gateway.dflow.orders).toHaveLength(1);
    expect(gateway.dflow.orders[0]?.inputMint).toBe(USDT_MINT);
    expect(gateway.dflow.orders[0]?.outputMint).toBe(USDC_MINT);
    expect(BigInt(gateway.balances.get(USDC_MINT)?.balanceAtomic ?? "0")).toBeGreaterThanOrEqual(
      1000n
    );
    gateway.close();
  });

  it("still prefers SOL when both SOL and another funding asset are held", async () => {
    const merchantOrigin = "http://merchant.local";
    const policy = {
      ...createDemoPolicy(merchantOrigin),
      allowedFundingAssets: [USDT_MINT, WSOL_MINT]
    };
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy,
      wallet: "PreferSolBuyer111111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      balances: new MockBalanceProvider([
        {
          mint: USDC_MINT,
          symbol: "USDC",
          balanceAtomic: "0",
          verified: true
        },
        {
          mint: WSOL_MINT,
          symbol: "SOL",
          balanceAtomic: "5000000000",
          verified: true
        },
        {
          mint: USDT_MINT,
          symbol: "USDT",
          balanceAtomic: "5000000",
          verified: true
        }
      ])
    });

    const outcome = await gateway.coordinator.ensurePaymentAsset({
      intent: {
        operationId: "prefer-sol-1",
        requestHash: "sha256:prefer-sol-001",
        protocol: "x402",
        network: "solana:local",
        merchantId: "merchant.local",
        merchantOrigin,
        destination: "PaidApiMerchantDest11111111111111111111111",
        assetMint: USDC_MINT,
        amountAtomic: "1000",
        amountUsdMicros: "1000",
        resource: `${merchantOrigin}/v1/research`
      }
    });

    expect(outcome.status).toBe("funded");
    expect(gateway.dflow.orders[0]?.inputMint).toBe(WSOL_MINT);
    gateway.close();
  });
});

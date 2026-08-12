/**
 * Neutral x402 merchant — no AgentTab imports.
 *
 * Mimics a third-party paid data API: issues a standard PAYMENT-REQUIRED
 * challenge and serves the resource after a payment signature is present.
 *
 * Modes:
 * - `signature-present` (default): accepts any PAYMENT-SIGNATURE header.
 *   Safe local/CI smoke for buyer-side AgentTab adoption without on-chain settle.
 * - Production merchants should verify/settle via a facilitator instead; this
 *   example intentionally stays AgentTab-agnostic and facilitator-pluggable.
 */
import { Hono } from "hono";

/** Solana local CAIP-2 id used by the AgentTab local/mock gateway policy. */
export const LOCAL_NETWORK = "solana:local";
/** Circle USDC mint (Mainnet id; also used as the local demo payment asset id). */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MERCHANT_PAY_TO = "NeutralMerchant111111111111111111111111111";
export const DEFAULT_PRICE_ATOMIC = "1000";

export interface NeutralMerchantOptions {
  origin: string;
  network?: string;
  assetMint?: string;
  payTo?: string;
  priceAtomic?: string;
  /**
   * `signature-present`: any PAYMENT-SIGNATURE unlocks the resource (local smoke).
   * `reject`: always 402 (useful for negative tests).
   */
  acceptMode?: "signature-present" | "reject";
}

export interface MarketSnapshot {
  service: "neutral-market-snapshot";
  paid: true;
  asOf: string;
  symbol: string;
  markUsd: number;
  note: string;
}

export function createNeutralMerchant(options: NeutralMerchantOptions): Hono {
  const network = options.network ?? LOCAL_NETWORK;
  const assetMint = options.assetMint ?? USDC_MINT;
  const payTo = options.payTo ?? MERCHANT_PAY_TO;
  const priceAtomic = options.priceAtomic ?? DEFAULT_PRICE_ATOMIC;
  const acceptMode = options.acceptMode ?? "signature-present";
  const resourcePath = "/v1/market-snapshot";

  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "neutral-merchant",
      agenttab: false,
      network,
      assetMint,
      priceAtomic,
      acceptMode
    })
  );

  app.get(resourcePath, (c) => {
    const requestOrigin = new URL(c.req.url).origin;
    const resourceUrl = `${requestOrigin}${resourcePath}`;
    const paymentHeader =
      c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");

    if (!paymentHeader || acceptMode === "reject") {
      const challenge = {
        x402Version: 2,
        resource: { url: resourceUrl },
        accepts: [
          {
            scheme: "exact",
            network,
            asset: assetMint,
            amount: priceAtomic,
            payTo,
            maxTimeoutSeconds: 60,
            extra: {
              description: "Neutral market snapshot (AgentTab-agnostic merchant)"
            }
          }
        ]
      };
      const encoded = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
      return c.json(
        {
          error: "payment_required",
          accepts: challenge.accepts
        },
        402,
        {
          "PAYMENT-REQUIRED": encoded,
          "Content-Type": "application/json"
        }
      );
    }

    const body: MarketSnapshot = {
      service: "neutral-market-snapshot",
      paid: true,
      asOf: new Date().toISOString(),
      symbol: "SOL",
      markUsd: 148.25,
      note: "Paid resource from a merchant that does not know AgentTab exists."
    };

    return c.json(body, 200, {
      "PAYMENT-RESPONSE": `neutral-${Buffer.from(paymentHeader).toString("base64url").slice(0, 24)}`
    });
  });

  return app;
}

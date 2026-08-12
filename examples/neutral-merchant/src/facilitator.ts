import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { Hono } from "hono";
import {
  DEFAULT_PRICE_ATOMIC,
  LOCAL_NETWORK,
  MERCHANT_PAY_TO,
  USDC_MINT,
  type NeutralMerchantOptions
} from "./server.js";

export interface FacilitatorNeutralMerchantOptions extends NeutralMerchantOptions {
  /** Facilitator base URL (e.g. https://x402.org/facilitator). */
  facilitatorUrl: string;
  /** CAIP-2 network for the paid route. */
  network: string;
  /** SPL mint charged by the route. */
  assetMint: string;
  /** Merchant receive address. */
  payTo: string;
}

/**
 * Neutral merchant that settles through a real x402 facilitator.
 * Still has zero AgentTab imports — only official @x402 packages.
 */
export function createFacilitatorNeutralMerchant(
  options: FacilitatorNeutralMerchantOptions
): Hono {
  const priceAtomic = options.priceAtomic ?? DEFAULT_PRICE_ATOMIC;
  const facilitatorClient = new HTTPFacilitatorClient({ url: options.facilitatorUrl });
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "neutral-merchant",
      agenttab: false,
      acceptMode: "facilitator",
      network: options.network,
      assetMint: options.assetMint,
      payTo: options.payTo,
      priceAtomic,
      facilitatorUrl: options.facilitatorUrl
    })
  );

  app.use(
    paymentMiddleware(
      {
        "GET /v1/market-snapshot": {
          accepts: [
            {
              scheme: "exact",
              price: {
                amount: priceAtomic,
                asset: options.assetMint
              },
              network: options.network as `${string}:${string}`,
              payTo: options.payTo
            }
          ],
          description: "Neutral market snapshot (facilitator-settled, AgentTab-agnostic)",
          mimeType: "application/json"
        }
      },
      new x402ResourceServer(facilitatorClient).register(
        options.network as `${string}:${string}`,
        // Do not embed rpcUrl/blockhash in the challenge — funding can land
        // between challenge and payment payload construction.
        new ExactSvmScheme()
      )
    )
  );

  app.get("/v1/market-snapshot", (c) =>
    c.json({
      service: "neutral-market-snapshot",
      paid: true,
      asOf: new Date().toISOString(),
      symbol: "SOL",
      markUsd: 148.25,
      note: "Facilitator-settled resource from a merchant that does not know AgentTab exists.",
      network: options.network,
      assetMint: options.assetMint
    })
  );

  return app;
}

export function createLocalNeutralMerchantDefaults(): NeutralMerchantOptions {
  return {
    origin: "http://127.0.0.1:8791",
    network: LOCAL_NETWORK,
    assetMint: USDC_MINT,
    payTo: MERCHANT_PAY_TO,
    priceAtomic: DEFAULT_PRICE_ATOMIC,
    acceptMode: "signature-present"
  };
}

/** Re-export serve helper for demos that boot this package directly. */
export { serve };

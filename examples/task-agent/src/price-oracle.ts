import { Hono } from "hono";
import {
  DEMO_PAYMENT_AMOUNT_ATOMIC,
  LOCAL_NETWORK,
  USDC_MINT
} from "@agenttab/gateway";

export const PRICE_ORACLE_PAY_TO = "PriceOracleDest11111111111111111111111111";

export const DEFAULT_PRICE_USD_MICROS_FOR_SOL = "148250000";

export interface PriceOracleOptions {
  origin: string;
  /**
   * When true, the merchant only checks that some payment header exists.
   * This keeps the local demo compatible with the local smoke scheme.
   */
  acceptMode?: "signature-present";
}

export function createPriceOracle(options: PriceOracleOptions): Hono {
  const app = new Hono();
  const acceptMode = options.acceptMode ?? "signature-present";

  app.get("/health", (c) =>
    c.json({ ok: true, service: "task-agent-price-oracle", agenttab: false })
  );

  app.get("/v1/price", (c) => {
    const requestUrl = new URL(c.req.url);
    const resourceUrl = requestUrl.toString();

    const asset = requestUrl.searchParams.get("asset") ?? requestUrl.searchParams.get("symbol") ?? "SOL";
    const assetUpper = asset.toUpperCase();

    const paymentHeader =
      c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");

    const priceUsdMicros =
      assetUpper === "SOL" ? DEFAULT_PRICE_USD_MICROS_FOR_SOL : "0";

    if (!paymentHeader || acceptMode === "signature-present") {
      // If no payment header exists, issue a standard x402 payment challenge.
      if (!paymentHeader) {
        const challenge = {
          x402Version: 2,
          resource: { url: resourceUrl },
          accepts: [
            {
              scheme: "exact",
              network: LOCAL_NETWORK,
              asset: USDC_MINT,
              amount: DEMO_PAYMENT_AMOUNT_ATOMIC,
              payTo: PRICE_ORACLE_PAY_TO,
              maxTimeoutSeconds: 60,
              extra: {
                description: "Paid price oracle response used by a wallet valuation agent"
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
    }

    return c.json({
      service: "task-agent-price-oracle",
      paid: true,
      asset: assetUpper,
      priceUsdMicros,
      note: "Paid resource returned after AgentTab payment-readiness unlocked the task"
    }, 200, {
      "PAYMENT-RESPONSE": `price-oracle-${Buffer.from(paymentHeader ?? "").toString("base64url").slice(0, 24)}`
    });
  });

  return app;
}


import { Hono } from "hono";
import {
  DEMO_PAYMENT_AMOUNT_ATOMIC,
  LOCAL_NETWORK,
  USDC_MINT,
  verifyPaymentToken
} from "@agenttab/gateway";

export const DEMO_MERCHANT_DESTINATION = "PaidApiMerchantDest11111111111111111111111";

export interface PaidApiOptions {
  origin: string;
  paymentHmacSecret: string;
  /** Optional remote verify URL; when omitted, verifies HMAC locally. */
  gatewayVerifyUrl?: string;
}

export interface PaymentChallenge {
  x402Version: 2;
  resource: { url: string };
  accepts: Array<{
    scheme: "exact";
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: Record<string, string>;
  }>;
}

export function createPaidApi(options: PaidApiOptions): Hono {
  const app = new Hono();
  const resourcePath = "/v1/research";

  app.get("/health", (c) => c.json({ ok: true, service: "agenttab-paid-api" }));

  app.get(resourcePath, async (c) => {
    const paymentHeader = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");
    const resourceUrl = `${options.origin}${resourcePath}`;

    if (!paymentHeader) {
      const challenge: PaymentChallenge = {
        x402Version: 2,
        resource: { url: resourceUrl },
        accepts: [
          {
            scheme: "exact",
            network: LOCAL_NETWORK,
            asset: USDC_MINT,
            amount: DEMO_PAYMENT_AMOUNT_ATOMIC,
            payTo: DEMO_MERCHANT_DESTINATION,
            maxTimeoutSeconds: 60,
            extra: { description: "Research brief for Solana agent payments" }
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

    let claims;
    try {
      if (options.gatewayVerifyUrl) {
        const response = await fetch(options.gatewayVerifyUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: paymentHeader })
        });
        const body = (await response.json()) as {
          valid?: boolean;
          claims?: ReturnType<typeof verifyPaymentToken>;
          error?: string;
        };
        if (!response.ok || !body.valid || !body.claims) {
          return c.json({ error: "invalid_payment", detail: body.error ?? "verify_failed" }, 402);
        }
        claims = body.claims;
      } else {
        claims = verifyPaymentToken(paymentHeader, options.paymentHmacSecret);
      }
    } catch (error) {
      return c.json(
        {
          error: "invalid_payment",
          detail: error instanceof Error ? error.message : "verify_failed"
        },
        402
      );
    }

    if (
      claims.resource !== resourceUrl ||
      claims.amountAtomic !== DEMO_PAYMENT_AMOUNT_ATOMIC ||
      claims.assetMint !== USDC_MINT ||
      claims.destination !== DEMO_MERCHANT_DESTINATION ||
      claims.merchantOrigin !== options.origin
    ) {
      return c.json({ error: "payment_binding_mismatch" }, 402);
    }

    return c.json({
      title: "Agent-native payment inventory report",
      summary:
        "USDC inventory was the blocker. Exact-deficit funding unblocked the research fetch.",
      paid: true,
      operationId: claims.operationId,
      generatedAt: new Date().toISOString()
    });
  });

  return app;
}

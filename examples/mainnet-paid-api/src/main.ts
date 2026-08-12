import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { Hono } from "hono";
import {
  fetchFacilitatorMinimum,
  resolvePaymentAtomicFloor
} from "@agenttab/gateway";
import {
  DEFAULT_FACILITATOR_URL,
  MAINNET_PRICE_ATOMIC,
  SOLANA_MAINNET,
  USDC_MINT,
  readMerchantAddress
} from "./constants.js";

const port = Number(process.env.MAINNET_PAID_API_PORT ?? "4022");
const host = process.env.MAINNET_PAID_API_HOST ?? "127.0.0.1";
const merchant = readMerchantAddress();
const facilitatorUrl = process.env.FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL;
const liveMinimum = await fetchFacilitatorMinimum({
  facilitatorUrl
}).catch((error: unknown) => ({
  facilitatorUrl,
  network: SOLANA_MAINNET,
  scheme: "exact",
  minPaymentAmountAtomic: MAINNET_PRICE_ATOMIC,
  minPaymentAmountUsd: null,
  error: error instanceof Error ? error.message : String(error)
}));
const priceAtomic = resolvePaymentAtomicFloor(
  process.env.MAINNET_PRICE_ATOMIC ?? MAINNET_PRICE_ATOMIC,
  liveMinimum.minPaymentAmountAtomic
);

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "agenttab-mainnet-paid-api",
    network: SOLANA_MAINNET,
    merchant,
    mint: USDC_MINT,
    priceAtomic,
    facilitatorUrl,
    liveMinimum,
    note: "Scaffolding only until funded Mainnet test is explicitly approved"
  })
);

app.use(
  paymentMiddleware(
    {
      "GET /v1/research": {
        accepts: [
          {
            scheme: "exact",
            price: {
              amount: priceAtomic,
              asset: USDC_MINT
            },
            network: SOLANA_MAINNET,
            payTo: merchant
          }
        ],
        description: "AgentTab Mainnet research brief (tiny USDC)",
        mimeType: "application/json"
      }
    },
    new x402ResourceServer(facilitatorClient).register(
      SOLANA_MAINNET,
      // Do not embed recentBlockhash — AgentTab funding can take longer than a blockhash window.
      new ExactSvmScheme()
    )
  )
);

app.get("/v1/research", (c) =>
  c.json({
    title: "Mainnet x402 research brief",
    network: SOLANA_MAINNET,
    paid: true,
    mint: USDC_MINT,
    summary: "Official @x402/hono + production facilitator settlement on Solana Mainnet."
  })
);

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Mainnet paid API listening on http://${host}:${info.port}`);
  console.log(`merchant=${merchant}`);
  console.log(`facilitator=${facilitatorUrl}`);
  console.log(`priceAtomic=${priceAtomic} USDC (broadcast of payments requires funded buyer)`);
});

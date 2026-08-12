import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { Hono } from "hono";
import {
  FACILITATOR_URL,
  SOLANA_DEVNET,
  readMerchantAddress,
  readTestUsdcMint
} from "./constants.js";

const port = Number(process.env.DEVNET_PAID_API_PORT ?? "4021");
const host = process.env.DEVNET_PAID_API_HOST ?? "127.0.0.1";
const merchant = process.env.SVM_ADDRESS ?? readMerchantAddress();
const mint = process.env.DEVNET_TEST_USDC_MINT ?? readTestUsdcMint();
const facilitatorUrl = process.env.FACILITATOR_URL ?? FACILITATOR_URL;
const debugFacilitator = process.env.AGENTTAB_DEBUG_FACILITATOR === "1";

const innerFacilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });

const facilitatorClient = debugFacilitator
  ? {
      getSupported: () => innerFacilitator.getSupported(),
      verify: async (
        paymentPayload: Parameters<HTTPFacilitatorClient["verify"]>[0],
        paymentRequirements: Parameters<HTTPFacilitatorClient["verify"]>[1]
      ) => {
        const result = await innerFacilitator.verify(paymentPayload, paymentRequirements);
        console.log(
          JSON.stringify({
            phase: "facilitator-verify",
            isValid: result.isValid,
            invalidReason: result.invalidReason ?? null
          })
        );
        return result;
      },
      settle: async (
        paymentPayload: Parameters<HTTPFacilitatorClient["settle"]>[0],
        paymentRequirements: Parameters<HTTPFacilitatorClient["settle"]>[1]
      ) => {
        const result = await innerFacilitator.settle(paymentPayload, paymentRequirements);
        console.log(
          JSON.stringify({
            phase: "facilitator-settle",
            success: result.success,
            errorReason: result.errorReason ?? null,
            transaction: result.transaction?.slice(0, 88) ?? null
          })
        );
        return result;
      }
    }
  : innerFacilitator;

const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "agenttab-devnet-paid-api",
    network: SOLANA_DEVNET,
    merchant,
    mint,
    facilitatorUrl
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
              amount: "1000",
              asset: mint
            },
            network: SOLANA_DEVNET,
            payTo: merchant
          }
        ],
        description: "AgentTab Devnet research brief",
        mimeType: "application/json"
      }
    },
    new x402ResourceServer(facilitatorClient).register(
      SOLANA_DEVNET,
      // Do NOT pass rpcUrl here. Embedding recentBlockhash in the 402 challenge
      // breaks AgentTab's fund-during-hook path: after minting the deficit, the
      // retry's freshly built requirements get a new blockhash and fail
      // paymentRequirementsMatchAccepted before facilitator verify. Without an
      // embedded blockhash, @x402/svm client fetches one after funding completes.
      new ExactSvmScheme()
    )
  )
);

app.get("/v1/research", (c) =>
  c.json({
    title: "Devnet x402 research brief",
    network: SOLANA_DEVNET,
    paid: true,
    mint,
    summary: "Official @x402/hono + x402.org facilitator settlement succeeded on Solana Devnet."
  })
);

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Devnet paid API listening on http://${host}:${info.port}`);
  console.log(`merchant=${merchant}`);
  console.log(`mint=${mint}`);
  console.log(`facilitator=${facilitatorUrl}`);
});

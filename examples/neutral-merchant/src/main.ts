import { serve } from "@hono/node-server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFacilitatorNeutralMerchant } from "./facilitator.js";
import { createNeutralMerchant } from "./server.js";

const port = Number(process.env.PORT ?? "8791");
const host = process.env.HOST ?? "127.0.0.1";
const origin = process.env.MERCHANT_ORIGIN ?? `http://${host}:${port}`;
const acceptMode = process.env.ACCEPT_MODE ?? "signature-present";

function readDevnetFile(name: string): string {
  const dataDir = resolve(process.cwd(), "../../.data/devnet");
  const path = resolve(dataDir, name);
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run pnpm devnet:setup first.`);
  }
  return readFileSync(path, "utf8").trim();
}

const app =
  acceptMode === "facilitator"
    ? createFacilitatorNeutralMerchant({
        origin,
        facilitatorUrl: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator",
        network:
          process.env.PAYMENT_NETWORK ?? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        assetMint: process.env.PAYMENT_ASSET_MINT ?? readDevnetFile("test-usdc-mint.txt"),
        payTo: process.env.MERCHANT_PAY_TO ?? readDevnetFile("merchant.address.txt"),
        priceAtomic: process.env.PAYMENT_AMOUNT_ATOMIC ?? "1000"
      })
    : createNeutralMerchant({
        origin,
        ...(acceptMode === "reject"
          ? { acceptMode: "reject" }
          : { acceptMode: "signature-present" })
      });

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(
    JSON.stringify({
      phase: "neutral-merchant-listen",
      url: `http://${host}:${info.port}`,
      resource: `${origin}/v1/market-snapshot`,
      acceptMode,
      agenttab: false
    })
  );
});

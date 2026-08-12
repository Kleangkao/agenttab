import { serve } from "@hono/node-server";
import { createPaidApi } from "./server.js";

const port = Number(process.env.PAID_API_PORT ?? "8790");
const host = process.env.PAID_API_HOST ?? "127.0.0.1";
const origin = process.env.PAID_API_ORIGIN ?? `http://${host}:${port}`;
const paymentHmacSecret =
  process.env.PAYMENT_HMAC_SECRET ??
  process.env.AGENTTAB_PAYMENT_HMAC_SECRET ??
  "local-dev-only-change-me";
const gatewayVerifyUrl =
  process.env.GATEWAY_VERIFY_URL ?? "http://127.0.0.1:8787/v1/settlements/verify";

const app = createPaidApi({
  origin,
  paymentHmacSecret,
  gatewayVerifyUrl
});

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Paid API listening on http://${host}:${info.port}`);
});

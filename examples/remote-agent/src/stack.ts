/**
 * One-process local control plane: gateway + neutral merchant.
 *
 *   pnpm demo:stack
 *
 * Then operate at http://127.0.0.1:8787/ui and:
 *   pnpm demo:remote-agent
 */
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createNeutralMerchant } from "@agenttab/example-neutral-merchant";
import { createGatewayRuntime, loadPolicyFile } from "@agenttab/gateway";

const gatewayPort = Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? "8787");
const merchantPort = Number(process.env.MERCHANT_PORT ?? "8791");
const host = process.env.HOST ?? "127.0.0.1";
const merchantOrigin =
  process.env.MERCHANT_ORIGIN ?? `http://${host}:${merchantPort}`;

const seedPolicy = {
  ...loadPolicyFile(resolve(process.cwd(), "../../examples/policies/approve.local.json")),
  allowedMerchantOrigins: [merchantOrigin]
};

const gateway = createGatewayRuntime({
  dbPath: process.env.AGENTTAB_DB_PATH ?? ".data/stack-gateway.sqlite",
  merchantOrigin,
  policy: seedPolicy,
  paymentHmacSecret:
    process.env.PAYMENT_HMAC_SECRET ??
    process.env.AGENTTAB_PAYMENT_HMAC_SECRET ??
    "local-dev-only-change-me",
  initialUsdcAtomic: process.env.AGENTTAB_INITIAL_USDC_ATOMIC ?? "0",
  initialSolAtomic: process.env.AGENTTAB_INITIAL_SOL_ATOMIC ?? "5000000000",
  ...(process.env.AGENTTAB_ADMIN_TOKEN
    ? { adminToken: process.env.AGENTTAB_ADMIN_TOKEN }
    : {}),
  ...(process.env.AGENTTAB_NOTIFY_URL
    ? { notifyUrl: process.env.AGENTTAB_NOTIFY_URL }
    : {}),
  ...(process.env.AGENTTAB_NOTIFY_SECRET
    ? { notifySecret: process.env.AGENTTAB_NOTIFY_SECRET }
    : {})
});
const live = gateway.policies.get();
if (
  process.env.AGENTTAB_POLICY_REPLACE === "1" ||
  !live.allowedMerchantOrigins.includes(merchantOrigin)
) {
  gateway.policies.set(seedPolicy);
}

const merchant = createNeutralMerchant({ origin: merchantOrigin });

serve({ fetch: gateway.app.fetch, port: gatewayPort, hostname: host }, (info) => {
  console.log(
    JSON.stringify(
      {
        phase: "stack-gateway-listen",
        url: `http://${host}:${info.port}`,
        operatorUi: `http://${host}:${info.port}/ui`,
        openapi: `http://${host}:${info.port}/openapi.json`,
        policyMode: gateway.policies.get().mode,
        next: `RESOURCE_URL=${merchantOrigin}/v1/market-snapshot pnpm demo:remote-agent`
      },
      null,
      2
    )
  );
});

serve({ fetch: merchant.fetch, port: merchantPort, hostname: host }, (info) => {
  console.log(
    JSON.stringify(
      {
        phase: "stack-merchant-listen",
        url: `http://${host}:${info.port}`,
        resource: `${merchantOrigin}/v1/market-snapshot`,
        agenttab: false
      },
      null,
      2
    )
  );
});

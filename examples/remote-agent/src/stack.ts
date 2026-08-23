/**
 * One-process local/public control plane: gateway + neutral merchant.
 *
 *   pnpm demo:stack
 *
 * Public demo host (Railway): HOST=0.0.0.0 PORT=$PORT, merchant stays on
 * loopback so fulfill works with a single exposed port. Auto-reseed parks a
 * fresh Now card after visitors finish (AGENTTAB_STACK_RESEED_MS, default 15s).
 */
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createNeutralMerchant } from "@agenttab/example-neutral-merchant";
import {
  createGatewayRuntime,
  loadPolicyFile,
  loadPolicyFromEnv,
  notifyBoundsFromEnv
} from "@agenttab/gateway";
import { seedNowIfEmpty, startAutoReseed } from "./stack-seed.js";

const gatewayPort = Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? "8787");
const merchantPort = Number(process.env.MERCHANT_PORT ?? "8791");
/** Public bind for the operator UI (Railway sets HOST=0.0.0.0). */
const gatewayHost = process.env.HOST ?? "127.0.0.1";
/**
 * Merchant stays on loopback. Railway/Fly expose one port; fulfill still needs
 * an HTTP merchant inside the same container.
 */
const merchantHost = "127.0.0.1";
const merchantOrigin =
  process.env.MERCHANT_ORIGIN ?? `http://${merchantHost}:${merchantPort}`;

const initialUsdcAtomic = process.env.AGENTTAB_INITIAL_USDC_ATOMIC ?? "0";
const initialSolAtomic = process.env.AGENTTAB_INITIAL_SOL_ATOMIC ?? "5000000000";
const seedEnabled = process.env.AGENTTAB_STACK_SEED !== "0";
const reseedMs = Number(process.env.AGENTTAB_STACK_RESEED_MS ?? "15000");

const policyFromEnv = loadPolicyFromEnv();
const basePolicy =
  policyFromEnv?.policy ??
  loadPolicyFile(resolve(process.cwd(), "../../examples/policies/approve.local.json"));
const seedPolicy = {
  ...basePolicy,
  allowedMerchantOrigins: [merchantOrigin]
};
const notifyBounds = notifyBoundsFromEnv();

const gateway = createGatewayRuntime({
  dbPath: process.env.AGENTTAB_DB_PATH ?? ".data/stack-gateway.sqlite",
  merchantOrigin,
  policy: seedPolicy,
  paymentHmacSecret:
    process.env.PAYMENT_HMAC_SECRET ??
    process.env.AGENTTAB_PAYMENT_HMAC_SECRET ??
    "local-dev-only-change-me",
  initialUsdcAtomic,
  initialSolAtomic,
  ...(process.env.AGENTTAB_ADMIN_TOKEN
    ? { adminToken: process.env.AGENTTAB_ADMIN_TOKEN }
    : {}),
  ...(process.env.AGENTTAB_AGENT_TOKEN
    ? { agentToken: process.env.AGENTTAB_AGENT_TOKEN }
    : {}),
  ...(process.env.AGENTTAB_NOTIFY_URL
    ? { notifyUrl: process.env.AGENTTAB_NOTIFY_URL }
    : {}),
  ...(process.env.AGENTTAB_NOTIFY_SECRET
    ? { notifySecret: process.env.AGENTTAB_NOTIFY_SECRET }
    : {}),
  notifyBudgetMs: notifyBounds.budgetMs,
  notifyAttemptTimeoutMs: notifyBounds.attemptTimeoutMs
});
const live = gateway.policies.get();
if (
  process.env.AGENTTAB_POLICY_REPLACE === "1" ||
  !live.allowedMerchantOrigins.includes(merchantOrigin)
) {
  gateway.policies.set(seedPolicy);
}

const merchant = createNeutralMerchant({ origin: merchantOrigin });

async function seedDemoCard() {
  if (!seedEnabled) return undefined;
  return seedNowIfEmpty({
    gateway,
    merchantOrigin,
    initialUsdcAtomic,
    initialSolAtomic,
    resetDemoState: true,
    seedPolicy
  });
}

serve({ fetch: gateway.app.fetch, port: gatewayPort, hostname: gatewayHost }, (info) => {
  void seedDemoCard()
    .then((seeded) => {
      console.log(
        JSON.stringify(
          {
            phase: "stack-gateway-listen",
            url: `http://${gatewayHost}:${info.port}`,
            operatorUi: `http://${gatewayHost}:${info.port}/ui`,
            openapi: `http://${gatewayHost}:${info.port}/openapi.json`,
            policyMode: gateway.policies.get().mode,
            seededOperationId: seeded?.operationId ?? null,
            reseedMs: seedEnabled ? reseedMs : 0,
            fidelity: "local DFlow mock — no chain",
            next: `Open /ui and confirm buy-and-continue. Mainnet proof: docs/DEMO.md`
          },
          null,
          2
        )
      );
      startAutoReseed({
        enabled: seedEnabled,
        intervalMs: reseedMs,
        seed: seedDemoCard,
        onSeeded: (operationId) => {
          console.log(
            JSON.stringify({ phase: "stack-reseed", seededOperationId: operationId })
          );
        },
        onError: (error) => {
          console.error(
            JSON.stringify({
              phase: "stack-reseed-failed",
              error: error instanceof Error ? error.message : String(error)
            })
          );
        }
      });
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          phase: "stack-seed-failed",
          error: error instanceof Error ? error.message : String(error)
        })
      );
    });
});

serve({ fetch: merchant.fetch, port: merchantPort, hostname: merchantHost }, (info) => {
  console.log(
    JSON.stringify(
      {
        phase: "stack-merchant-listen",
        url: `http://${merchantHost}:${info.port}`,
        resource: `${merchantOrigin}/v1/market-snapshot`,
        agenttab: false
      },
      null,
      2
    )
  );
});

/**
 * One-process local control plane: gateway + neutral merchant.
 *
 *   pnpm demo:stack
 *
 * Then operate at http://127.0.0.1:8787/ui. A local mock request is parked on
 * Now so a judge can confirm buy-and-continue without a second terminal.
 * Optional: RESOURCE_URL=… pnpm demo:remote-agent
 */
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import {
  createNeutralMerchant,
  MERCHANT_PAY_TO
} from "@agenttab/example-neutral-merchant";
import {
  createGatewayRuntime,
  loadPolicyFile,
  LOCAL_NETWORK,
  USDC_MINT,
  notifyBoundsFromEnv
} from "@agenttab/gateway";

const gatewayPort = Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? "8787");
const merchantPort = Number(process.env.MERCHANT_PORT ?? "8791");
const host = process.env.HOST ?? "127.0.0.1";
const merchantOrigin =
  process.env.MERCHANT_ORIGIN ?? `http://${host}:${merchantPort}`;

const seedPolicy = {
  ...loadPolicyFile(resolve(process.cwd(), "../../examples/policies/approve.local.json")),
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
  initialUsdcAtomic: process.env.AGENTTAB_INITIAL_USDC_ATOMIC ?? "0",
  initialSolAtomic: process.env.AGENTTAB_INITIAL_SOL_ATOMIC ?? "5000000000",
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

async function seedNowIfEmpty(): Promise<string | undefined> {
  if (process.env.AGENTTAB_STACK_SEED === "0") return undefined;
  const parked = await gateway.store.listRecent({
    state: "approval_required",
    limit: 1
  });
  if (parked[0]) return parked[0].operationId;
  const operationId = `demo-now-${randomUUID()}`;
  const requestHash = `sha256:${createHash("sha256").update(operationId).digest("hex")}`;
  const resource = `${merchantOrigin}/v1/market-snapshot`;
  const result = await gateway.coordinator.ensurePaymentAsset({
    intent: {
      operationId,
      requestHash,
      protocol: "x402",
      network: LOCAL_NETWORK,
      merchantId: new URL(merchantOrigin).host,
      merchantOrigin,
      destination: MERCHANT_PAY_TO,
      assetMint: USDC_MINT,
      amountAtomic: "4000000",
      amountUsdMicros: "4000000",
      resource
    }
  });
  if (result.status !== "approval_required") {
    throw new Error(`stack seed expected approval_required, got ${result.status}`);
  }
  return operationId;
}

serve({ fetch: gateway.app.fetch, port: gatewayPort, hostname: host }, (info) => {
  void seedNowIfEmpty()
    .then((seededOperationId) => {
      console.log(
        JSON.stringify(
          {
            phase: "stack-gateway-listen",
            url: `http://${host}:${info.port}`,
            operatorUi: `http://${host}:${info.port}/ui`,
            openapi: `http://${host}:${info.port}/openapi.json`,
            policyMode: gateway.policies.get().mode,
            seededOperationId: seededOperationId ?? null,
            fidelity: "local DFlow mock — no chain",
            next: `Open /ui and confirm buy-and-continue. Mainnet proof: docs/DEMO.md`
          },
          null,
          2
        )
      );
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

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
  notifyBoundsFromEnv,
  USDC_MINT
} from "@agenttab/gateway";
import {
  applyDemoScenario,
  DEMO_SEED_USDC_ATOMIC,
  DEMO_SCENARIOS,
  type DemoScenarioId,
  seedNowIfEmpty,
  startAutoReseed,
  topupDemoUsdc
} from "./stack-seed.js";

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

const initialUsdcAtomic =
  process.env.AGENTTAB_INITIAL_USDC_ATOMIC ?? DEMO_SEED_USDC_ATOMIC;
const initialSolAtomic = process.env.AGENTTAB_INITIAL_SOL_ATOMIC ?? "5000000000";
const seedEnabled = process.env.AGENTTAB_STACK_SEED !== "0";
const reseedMs = Number(process.env.AGENTTAB_STACK_RESEED_MS ?? "15000");

const policyFromEnv = loadPolicyFromEnv();
const basePolicy =
  policyFromEnv?.policy ??
  loadPolicyFile(resolve(process.cwd(), "../../examples/policies/approve.local.json"));
const seedPolicy = {
  ...basePolicy,
  allowedMerchantOrigins: [merchantOrigin],
  /**
   * This stack is always fundingMode=mock, but its spend ledger is durable, so
   * a production-sized daily cap denies public visitors after a few loops.
   */
  maxDailyUsdMicros:
    process.env.AGENTTAB_MAX_DAILY_USD_MICROS ?? "1000000000"
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
  demoControls: true,
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

gateway.app.post("/v1/demo/scenario", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { scenario?: string };
  const scenario = body.scenario as DemoScenarioId | undefined;
  if (!scenario || !(scenario in DEMO_SCENARIOS)) {
    return c.json(
      {
        error: "invalid_scenario",
        scenarios: Object.keys(DEMO_SCENARIOS)
      },
      400
    );
  }
  try {
    const seeded = await applyDemoScenario({
      gateway,
      merchantOrigin,
      scenario,
      seedPolicy,
      initialSolAtomic
    });
    return c.json({
      ok: true,
      scenario,
      operationId: seeded.operationId,
      created: seeded.created,
      message: `Scenario ${DEMO_SCENARIOS[scenario].label} parked.`
    });
  } catch (error) {
    return c.json(
      {
        error: "scenario_failed",
        message: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
});

gateway.app.post("/v1/demo/topup", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { usdcAtomic?: string };
  const usdcAtomic = body.usdcAtomic ?? "1000000";
  if (!/^\d+$/.test(usdcAtomic) || BigInt(usdcAtomic) <= 0n) {
    return c.json({ error: "invalid_usdc_atomic" }, 400);
  }
  try {
    const seeded = await topupDemoUsdc({
      gateway,
      merchantOrigin,
      usdcAtomic,
      seedPolicy,
      initialSolAtomic
    });
    return c.json({
      ok: true,
      operationId: seeded.operationId,
      balanceAtomic: seeded.balanceAtomic,
      mint: USDC_MINT,
      message: `Added $${(Number(usdcAtomic) / 1_000_000).toFixed(2)} USDC and re-parked.`
    });
  } catch (error) {
    return c.json(
      {
        error: "topup_failed",
        message: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
});

serve({ fetch: gateway.app.fetch, port: gatewayPort, hostname: gatewayHost }, (info) => {
  void seedDemoCard()
    .then((seeded) => {
      console.log(
        JSON.stringify(
          {
            phase: "stack-gateway-listen",
            url: `http://${gatewayHost}:${info.port}`,
            landing: `http://${gatewayHost}:${info.port}/`,
            playableDemo: `http://${gatewayHost}:${info.port}/demo`,
            operatorUi: `http://${gatewayHost}:${info.port}/ui`,
            openapi: `http://${gatewayHost}:${info.port}/openapi.json`,
            policyMode: gateway.policies.get().mode,
            seededOperationId: seeded?.operationId ?? null,
            reseedMs: seedEnabled ? reseedMs : 0,
            fidelity: "local DFlow mock — no chain",
            next: `Open / then Try the demo. Operator proof: /ui. Mainnet proof: docs/DEMO.md`
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

/**
 * One-shot judge run (no human approval).
 *
 * This is meant to be CI-friendly and produces a stable JSON report.
 */
import { createGatewayRuntime, createDemoPolicy } from "@agenttab/gateway";
import { serve } from "@hono/node-server";
import { createPriceOracle } from "./price-oracle.js";
import { runWalletValuationTask } from "./workflow.js";

const host = process.env.HOST ?? "127.0.0.1";
const gatewayPort = Number(process.env.GATEWAY_PORT ?? "8787");
const merchantPort = Number(process.env.MERCHANT_PORT ?? "8792");

const gatewayOrigin = `http://${host}:${gatewayPort}`;
const priceOracleOrigin = `http://${host}:${merchantPort}`;

const initialUsdcAtomic = process.env.AGENTTAB_INITIAL_USDC_ATOMIC ?? "0";
const initialSolAtomic = process.env.AGENTTAB_INITIAL_SOL_ATOMIC ?? "5000000000";

async function main(): Promise<void> {
  const gateway = createGatewayRuntime({
    dbPath: process.env.AGENTTAB_DB_PATH ?? ".data/task-agent-judge-gateway.sqlite",
    merchantOrigin: priceOracleOrigin,
    policy: createDemoPolicy(priceOracleOrigin),
    initialUsdcAtomic,
    initialSolAtomic
  });

  const priceOracle = createPriceOracle({ origin: priceOracleOrigin });

  serve({ fetch: gateway.app.fetch, port: gatewayPort, hostname: host }, () => {
    console.log(JSON.stringify({ phase: "task-agent-gateway-listen", gatewayOrigin }));
  });
  serve(
    { fetch: priceOracle.fetch, port: merchantPort, hostname: host },
    () => {
      console.log(JSON.stringify({ phase: "task-agent-price-oracle-listen", priceOracleOrigin }));
    }
  );

  const taskId = `task-agent-judge-${Date.now()}`;
  const taskContext = {
    purpose: "USD valuation report (judge run)",
    stepLabel: "Paid oracle step if SOL price is missing"
  };

  const result = await runWalletValuationTask({
    gatewayBaseUrl: gatewayOrigin,
    priceOracleOrigin,
    taskId,
    taskContext,
    autoApprove: true
  });

  console.log(JSON.stringify({ phase: "task-agent-judge-complete", result }, null, 2));
  gateway.close();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});


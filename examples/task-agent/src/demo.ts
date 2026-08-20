/**
 * Human-in-the-loop demo (local vertical slice).
 *
 * 1) Start gateway + price oracle
 * 2) Agent reads balances, computes a valuation draft, and hits a payment barrier
 * 3) Operator approves the parked payment in /ui
 * 4) Agent continues and prints the completed valuation report
 */
import { createGatewayRuntime, createDemoPolicy } from "@agenttab/gateway";
import { serve } from "@hono/node-server";
import { createPriceOracle } from "./price-oracle.js";
import { runWalletValuationTask } from "./workflow.js";

const host = process.env.HOST ?? "127.0.0.1";
const gatewayPort = Number(process.env.GATEWAY_PORT ?? process.env.PORT ?? "8787");
const merchantPort = Number(process.env.MERCHANT_PORT ?? "8792");

const gatewayOrigin = `http://${host}:${gatewayPort}`;
const priceOracleOrigin = `http://${host}:${merchantPort}`;

const initialUsdcAtomic = process.env.AGENTTAB_INITIAL_USDC_ATOMIC ?? "0";
const initialSolAtomic = process.env.AGENTTAB_INITIAL_SOL_ATOMIC ?? "5000000000";

function seedPolicy(): ReturnType<typeof createDemoPolicy> {
  const policy = createDemoPolicy(priceOracleOrigin);
  // Force the payment barrier into the demo.
  return { ...policy, mode: "approve" };
}

async function main(): Promise<void> {
  const policy = seedPolicy();

  const gateway = createGatewayRuntime({
    dbPath: process.env.AGENTTAB_DB_PATH ?? ".data/task-agent-gateway.sqlite",
    merchantOrigin: priceOracleOrigin,
    policy,
    initialUsdcAtomic,
    initialSolAtomic
  });

  const priceOracle = createPriceOracle({ origin: priceOracleOrigin });

  const gatewayServer = serve(
    { fetch: gateway.app.fetch, port: gatewayPort, hostname: host },
    () => {
      console.log(
        JSON.stringify(
          {
            phase: "task-agent-gateway-listen",
            gatewayOrigin,
            operatorUi: `${gatewayOrigin}/ui`,
            openapi: `${gatewayOrigin}/openapi.json`,
            paymentBarrier: "mode=approve: agent will wait for /ui approval",
            initialUsdcAtomic,
            initialSolAtomic
          },
          null,
          2
        )
      );
    }
  );

  const priceOracleServer = serve(
    { fetch: priceOracle.fetch, port: merchantPort, hostname: host },
    () => {
      console.log(
        JSON.stringify(
          {
            phase: "task-agent-price-oracle-listen",
            priceOracleOrigin,
            endpoint: `${priceOracleOrigin}/v1/price?asset=SOL`
          },
          null,
          2
        )
      );
    }
  );

  const shutdown = () => {
    priceOracleServer.close();
    gatewayServer.close();
    gateway.close();
  };
  process.once("SIGINT", () => {
    shutdown();
    process.exit(process.exitCode ?? 0);
  });
  process.once("SIGTERM", () => {
    shutdown();
    process.exit(process.exitCode ?? 0);
  });

  const taskId = `task-agent-${Date.now()}`;
  const taskContext = {
    purpose: "Estimate the wallet's USD value after my first paid oracle step",
    stepLabel: "Pricing missing SOL via AgentTab before completing the report"
  };

  try {
    const result = await runWalletValuationTask({
      gatewayBaseUrl: gatewayOrigin,
      priceOracleOrigin,
      taskId,
      taskContext,
      autoApprove: false
    });

    console.log(
      JSON.stringify(
        {
          phase: "task-agent-complete",
          ok: true,
          result,
          operatorUi: `${gatewayOrigin}/ui`,
          next: "Leave this process running so /ui stays readable. Ctrl+C to stop. AGENTTAB_INITIAL_USDC_ATOMIC=1000000 skips the DFlow buy."
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          phase: "task-agent-failed",
          error: error instanceof Error ? error.message : String(error),
          operatorUi: `${gatewayOrigin}/ui`
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

void main();


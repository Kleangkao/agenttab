/**
 * One-command judge / Buildathon demo.
 *
 * Runs the full local thesis in-process (no open ports, no chain, no funds):
 * 402 → policy → exact-deficit funding → pay → retry → fulfill → audit.
 *
 * Usage: pnpm demo:judge
 */
import { createGatewayRuntime, USDC_MINT, createDemoPolicy } from "@agenttab/gateway";
import { createPaidApi } from "@agenttab/example-paid-api";
import { runAgentPurchase } from "./purchase.js";

const MERCHANT_ORIGIN = "http://merchant.local";
const RESOURCE_URL = `${MERCHANT_ORIGIN}/v1/research`;
const GATEWAY_ORIGIN = "http://gateway.local";

function createFetch(
  gateway: ReturnType<typeof createGatewayRuntime>,
  paid: ReturnType<typeof createPaidApi>
) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    if (parsed.origin === GATEWAY_ORIGIN) {
      return gateway.app.request(path, init);
    }
    if (parsed.origin === MERCHANT_ORIGIN) {
      return paid.request(path, init);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
}

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  AgentTab judge demo (local vertical slice)              ║
║  Thesis: policy + exact-deficit funding around x402      ║
╚══════════════════════════════════════════════════════════╝
`);
  console.log("Fidelity: local mock (HMAC pay + mock DFlow). This is not the implementation limit.");
  console.log("Already proven on Solana Mainnet — see docs/DEMO.md");
  console.log("  DFlow  https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg");
  console.log("  x402   https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR");
  console.log("Do not arm Mainnet broadcast. Devnet funding is a mint stand-in, not DFlow.");
  console.log("");
}

async function main(): Promise<void> {
  printBanner();

  const gateway = createGatewayRuntime({
    merchantOrigin: MERCHANT_ORIGIN,
    initialUsdcAtomic: "200000",
    initialSolAtomic: "5000000000",
    policy: createDemoPolicy(MERCHANT_ORIGIN)
  });
  const paid = createPaidApi({
    origin: MERCHANT_ORIGIN,
    paymentHmacSecret: gateway.paymentHmacSecret
  });
  const fetchImpl = createFetch(gateway, paid);
  const usdcBefore = gateway.balances.get(USDC_MINT)!.balanceAtomic;

  try {
    const result = await runAgentPurchase({
      gatewayBaseUrl: GATEWAY_ORIGIN,
      resourceUrl: RESOURCE_URL,
      fetchImpl,
      operationId: `judge-${Date.now()}`
    });

    const execution = result.execution as {
      state: string;
      events: Array<{ kind: string; to: string; at?: string; details?: unknown }>;
    };
    const usdcAfter = gateway.balances.get(USDC_MINT)!.balanceAtomic;
    const order = gateway.dflow.orders[0];

    console.log("Audit timeline");
    console.log("──────────────");
    for (const event of execution.events) {
      console.log(`  ${event.kind.padEnd(28)} → ${event.to}`);
    }
    console.log("");
    console.log(
      JSON.stringify(
        {
          ok: execution.state === "fulfilled",
          operationId: result.operationId,
          fundingStatus: result.funding.status,
          executionState: execution.state,
          balances: {
            usdcBefore,
            usdcAfter,
            fundedOutputAtomic: order?.outputAmountAtomic ?? null
          },
          dflowOrders: gateway.dflow.orders.length,
          resource: result.resource,
          fidelity: {
            payment: "local-hmac-demo",
            funding: "mock-exact-deficit",
            chain: "none"
          }
        },
        null,
        2
      )
    );

    if (execution.state !== "fulfilled") {
      process.exitCode = 1;
    }
  } finally {
    gateway.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

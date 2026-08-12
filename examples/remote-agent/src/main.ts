/**
 * Run against a live AgentTab gateway + neutral merchant:
 *
 *   Terminal 1: MERCHANT_ORIGIN=http://127.0.0.1:8791 pnpm demo:gateway
 *   Terminal 2: pnpm --filter @agenttab/example-neutral-merchant dev
 *   Terminal 3: pnpm --filter @agenttab/example-remote-agent demo
 *
 * This entrypoint uses the smoke payment scheme (no wallet keys / no chain).
 * Swap in ExactSvmScheme + a real signer for Devnet/Mainnet.
 */
import {
  createLocalSmokeScheme,
  isAgentTabApprovalRequiredError
} from "@agenttab/fetch";
import { createRemoteAgent, purchasePaidResource } from "./agent.js";

const gatewayBaseUrl = process.env.AGENTTAB_GATEWAY_URL ?? "http://127.0.0.1:8787";
const resourceUrl =
  process.env.RESOURCE_URL ?? "http://127.0.0.1:8791/v1/market-snapshot";
const network = (process.env.PAYMENT_NETWORK ?? "solana:local") as `${string}:${string}`;
const autoApprove = process.env.AGENTTAB_AUTO_APPROVE === "1";

async function main(): Promise<void> {
  const agent = createRemoteAgent({
    gatewayBaseUrl,
    schemes: [{ network, client: createLocalSmokeScheme() }],
    onAuditError: (error, meta) => {
      console.error(
        JSON.stringify({
          phase: "remote-agent-audit-error",
          error: error instanceof Error ? error.message : String(error),
          meta
        })
      );
    }
  });

  console.log(
    JSON.stringify(
      {
        phase: "remote-agent-start",
        gatewayBaseUrl,
        resourceUrl,
        network,
        integration: "@agenttab/fetch",
        embedsGateway: false,
        autoApprove
      },
      null,
      2
    )
  );

  try {
    const result = await purchasePaidResource(
      agent,
      resourceUrl,
      { method: "GET" },
      {
        onApprovalRequired: async (error) => {
          console.error(
            JSON.stringify({
              phase: "remote-agent-approval-required",
              operationId: error.operationId,
              hint: autoApprove
                ? "AGENTTAB_AUTO_APPROVE=1: approving via gateway"
                : `Run: pnpm approve -- ${error.operationId}   then run this command again (same URL reuses that id)`
            })
          );
          return autoApprove ? "approve" : "abort";
        }
      }
    );
    console.log(
      JSON.stringify(
        {
          phase: "remote-agent-result",
          status: result.response.status,
          body: result.body,
          meta: result.meta,
          approvedByHook: result.approvedByHook,
          executionState:
            result.execution &&
            typeof result.execution === "object" &&
            "state" in result.execution
              ? (result.execution as { state: string }).state
              : null
        },
        null,
        2
      )
    );

    if (!result.response.ok || result.meta?.auditRecorded !== true) {
      process.exit(1);
    }
  } catch (error) {
    if (isAgentTabApprovalRequiredError(error)) {
      console.error(
        JSON.stringify({
          phase: "remote-agent-waiting-for-human",
          operationId: error.operationId,
          next: `pnpm approve -- ${error.operationId} && re-run this command`
        })
      );
      process.exit(2);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

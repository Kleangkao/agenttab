#!/usr/bin/env node
/**
 * Reject a parked execution. Terminal: same operationId will not fund later.
 *
 *   pnpm deny -- <operationId>
 *   agenttab-deny -- <operationId>
 */
import { gatewayFetch } from "./gateway-http.js";
import { resolveOperationId } from "./operation-id.js";

async function main(): Promise<void> {
  const operationId = resolveOperationId(process.argv.slice(2), {
    command: "deny",
    envKeys: ["DENY_OPERATION_ID"],
    usage: "Usage: pnpm deny -- <operationId>   or set DENY_OPERATION_ID"
  });
  const response = await gatewayFetch(`/v1/denials/${encodeURIComponent(operationId)}`, {
    method: "POST",
    body: "{}"
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(
      JSON.stringify(
        { error: "deny_failed", operationId, status: response.status, body },
        null,
        2
      )
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        operationId,
        state: (body as { record?: { state?: string } }).record?.state
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

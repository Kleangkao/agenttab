#!/usr/bin/env node
/**
 * Grant human approval for an execution stuck in approval_required.
 *
 *   pnpm approve -- <operationId>
 *   agenttab-approve -- <operationId>
 */
import { gatewayFetch } from "./gateway-http.js";

function resolveOperationId(argv: string[]): string {
  const flagIndex = argv.findIndex((arg) => arg === "--" || arg === "--id" || arg === "-i");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1]!;
  }
  const positional = argv.find(
    (arg) => !arg.startsWith("-") && arg !== "approve" && !arg.endsWith(".ts")
  );
  if (positional) return positional;
  const fromEnv = process.env.APPROVE_OPERATION_ID?.trim();
  if (fromEnv) return fromEnv;
  throw new Error("Usage: pnpm approve -- <operationId>   or set APPROVE_OPERATION_ID");
}

async function main(): Promise<void> {
  const operationId = resolveOperationId(process.argv.slice(2));
  const response = await gatewayFetch(
    `/v1/approvals/${encodeURIComponent(operationId)}`,
    { method: "POST", body: "{}" }
  );
  const body = await response.json();
  if (!response.ok) {
    console.error(
      JSON.stringify(
        { error: "approve_failed", operationId, status: response.status, body },
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
        outcome: (body as { outcome?: unknown }).outcome,
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

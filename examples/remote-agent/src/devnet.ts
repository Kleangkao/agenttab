/**
 * Devnet remote agent — ExactSvmScheme + @agenttab/fetch against a standalone gateway.
 *
 * Does not embed the gateway. Expects:
 *   - AGENTTAB_GATEWAY_URL (default http://127.0.0.1:8787)
 *   - RESOURCE_URL (default http://127.0.0.1:8791/v1/market-snapshot)
 *   - disposable keys under .data/devnet/
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createRemoteAgent, purchasePaidResource } from "./agent.js";

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DATA_DIR = resolve(process.cwd(), "../../.data/devnet");

function requireText(name: string): string {
  const candidates = [
    resolve(process.cwd(), "../../.data/devnet", name),
    resolve(process.cwd(), ".data/devnet", name)
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf8").trim();
  }
  throw new Error(`Missing Devnet artifact ${name}. Run pnpm devnet:setup`);
}

const gatewayBaseUrl = process.env.AGENTTAB_GATEWAY_URL ?? "http://127.0.0.1:8787";
const resourceUrl =
  process.env.RESOURCE_URL ?? "http://127.0.0.1:8791/v1/market-snapshot";
const operationId = process.env.OPERATION_ID ?? `devnet-remote-${randomUUID()}`;

const svmSigner = await createKeyPairSignerFromBytes(base58.decode(requireText("buyer.base58")));

const agent = createRemoteAgent({
  gatewayBaseUrl,
  schemes: [
    {
      network: SOLANA_DEVNET,
      client: new ExactSvmScheme(svmSigner)
    }
  ],
  createOperationId: () => operationId,
  onPaymentCreationFailure: async (ctx) => {
    console.error(
      JSON.stringify({
        phase: "devnet-remote-payment-creation-failure",
        error: ctx.error instanceof Error ? ctx.error.message : String(ctx.error)
      })
    );
  },
  onAuditError: (error, meta) => {
    console.error(
      JSON.stringify({
        phase: "devnet-remote-audit-error",
        error: error instanceof Error ? error.message : String(error),
        meta
      })
    );
  }
});

console.log(
  JSON.stringify(
    {
      phase: "devnet-remote-agent-start",
      gatewayBaseUrl,
      resourceUrl,
      operationId,
      buyer: requireText("buyer.address.txt"),
      integration: "@agenttab/fetch",
      embedsGateway: false,
      scheme: "ExactSvmScheme"
    },
    null,
    2
  )
);

const result = await purchasePaidResource(agent, resourceUrl, { method: "GET" });
console.log(
  JSON.stringify(
    {
      phase: "devnet-remote-agent-result",
      status: result.response.status,
      body: result.body,
      meta: result.meta,
      executionState:
        result.execution &&
        typeof result.execution === "object" &&
        "state" in result.execution
          ? (result.execution as { state: string }).state
          : null,
      events:
        result.execution &&
        typeof result.execution === "object" &&
        "events" in result.execution
          ? (result.execution as { events: Array<{ kind: string }> }).events.map(
              (event) => event.kind
            )
          : []
    },
    null,
    2
  )
);

if (!result.response.ok || result.meta?.auditRecorded !== true) {
  process.exit(1);
}

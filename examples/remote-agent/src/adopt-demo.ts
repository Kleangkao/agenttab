/**
 * One-command HTTP adopt proof.
 *
 * Real gateway + AgentTab-agnostic merchant + @agenttab/fetch over loopback:
 * preview (no fund) → park → approve → fulfill → park → deny (not reusable).
 *
 *   pnpm demo:adopt
 */
import { resolve } from "node:path";
import { createNeutralMerchant } from "@agenttab/example-neutral-merchant";
import {
  createGatewayClient,
  isAgentTabApprovalRequiredError,
  isAgentTabFundingDeniedError
} from "@agenttab/fetch";
import {
  createGatewayRuntime,
  loadPolicyFile,
  LOCAL_NETWORK,
  USDC_MINT
} from "@agenttab/gateway";
import { createRemoteAgent, purchasePaidResource } from "./agent.js";
import { listenApp } from "./listen.js";
import { createSmokePaymentScheme } from "./smoke-scheme.js";

export interface AdoptDemoResult {
  previewFunded: boolean;
  approvedOperationId: string;
  fulfilledState: string;
  deniedOperationId: string;
  deniedReusable: string | undefined;
  events: string[];
  openapiPreview: boolean;
  parkedAfter: number;
}

export async function runAdoptDemo(): Promise<AdoptDemoResult> {
  const merchantApp = createNeutralMerchant({
    origin: "http://127.0.0.1",
    network: LOCAL_NETWORK,
    priceAtomic: "1000"
  });
  const merchantHttp = await listenApp(merchantApp);
  const merchantOrigin = merchantHttp.baseUrl;
  const policy = {
    ...loadPolicyFile(resolve(process.cwd(), "../../examples/policies/approve.local.json")),
    allowedMerchantOrigins: [merchantOrigin]
  };
  const gateway = createGatewayRuntime({
    merchantOrigin,
    policy,
    wallet: "AdoptDemoBuyer11111111111111111111111111",
    initialUsdcAtomic: "0",
    initialSolAtomic: "5000000000"
  });
  const gatewayHttp = await listenApp(gateway.app);

  try {
    const client = createGatewayClient({ baseUrl: gatewayHttp.baseUrl });
    const resourceUrl = `${merchantOrigin}/v1/market-snapshot`;
    const previewIntent = {
      operationId: "adopt-preview",
      requestHash: "sha256:adoptadoptadoptadoptadoptadoptadoptadoptadoptadoptadoptadoptad",
      protocol: "x402",
      network: LOCAL_NETWORK,
      merchantId: new URL(merchantOrigin).host,
      merchantOrigin,
      destination: "NeutralMerchant111111111111111111111111111",
      assetMint: USDC_MINT,
      amountAtomic: "1000",
      amountUsdMicros: "1000",
      resource: resourceUrl
    };
    const preview = await client.preview(previewIntent);
    if (preview.funded !== false || (await gateway.store.get("adopt-preview")) !== undefined) {
      throw new Error("preview created or funded an execution");
    }
    const spec = (await (await fetch(`${gatewayHttp.baseUrl}/openapi.json`)).json()) as {
      paths?: Record<string, unknown>;
    };
    if (spec.paths?.["/v1/preview"] === undefined || spec.paths?.["/v1/denials/{operationId}"] === undefined) {
      throw new Error("openapi.json is missing preview or deny");
    }
    const health = await client.getHealth();
    if (health.openapi !== "/openapi.json") {
      throw new Error("health is missing openapi");
    }

    const agent = createRemoteAgent({
      gatewayBaseUrl: gatewayHttp.baseUrl,
      schemes: [{ network: LOCAL_NETWORK, client: createSmokePaymentScheme() }]
    });

    const approved = await purchasePaidResource(
      agent,
      resourceUrl,
      { method: "GET" },
      { onApprovalRequired: async () => "approve" as const }
    );
    if (approved.response.status !== 200 || approved.execution === undefined) {
      throw new Error("approve path did not fulfill");
    }
    const approvedExecution = approved.execution as {
      operationId: string;
      state: string;
      events: Array<{ kind: string }>;
    };

    const denyAgent = createRemoteAgent({
      gatewayBaseUrl: gatewayHttp.baseUrl,
      schemes: [{ network: LOCAL_NETWORK, client: createSmokePaymentScheme() }]
    });
    let deniedOperationId = "";
    try {
      await purchasePaidResource(
        denyAgent,
        `${resourceUrl}?pass=deny`,
        { method: "GET" },
        { onApprovalRequired: async (error) => {
          deniedOperationId = error.operationId;
          return "deny" as const;
        } }
      );
      throw new Error("deny path unexpectedly succeeded");
    } catch (error) {
      if (!isAgentTabFundingDeniedError(error) && !isAgentTabApprovalRequiredError(error)) {
        throw error;
      }
      if (isAgentTabFundingDeniedError(error)) {
        deniedOperationId = error.operationId;
      }
    }
    if (deniedOperationId.length === 0) {
      throw new Error("deny path did not surface an operationId");
    }
    const deniedRecord = await gateway.store.get(deniedOperationId);
    if (deniedRecord?.state !== "denied") {
      throw new Error(`expected denied, got ${deniedRecord?.state ?? "missing"}`);
    }
    const deniedReusable = await client.findReusableOperationId(
      deniedRecord.intent.requestHash
    );
    const parkedAfter = (await client.listParked()).count;

    return {
      previewFunded: preview.funded,
      approvedOperationId: approvedExecution.operationId,
      fulfilledState: approvedExecution.state,
      deniedOperationId,
      deniedReusable,
      events: approvedExecution.events.map((event) => event.kind),
      openapiPreview: true,
      parkedAfter
    };
  } finally {
    await gatewayHttp.close();
    await merchantHttp.close();
    gateway.close();
  }
}

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  AgentTab adopt demo (HTTP control plane)                ║
║  fetch SDK → gateway → neutral merchant → approve/deny   ║
╚══════════════════════════════════════════════════════════╝
`);
  console.log("Fidelity: local mock settlement + mock DFlow. No chain, no funds.");
  console.log("Operator UI (long-running): pnpm demo:stack");
  console.log("");
}

async function main(): Promise<void> {
  printBanner();
  const result = await runAdoptDemo();
  console.log("Adopt timeline");
  console.log("──────────────");
  console.log(`preview funded:          ${result.previewFunded}`);
  console.log(`approve → fulfill:       ${result.approvedOperationId}  ${result.fulfilledState}`);
  console.log(`deny (terminal):         ${result.deniedOperationId}`);
  console.log(`denied id reusable:      ${result.deniedReusable ?? "no"}`);
  console.log(`openapi preview/deny:    ${result.openapiPreview}`);
  console.log(`parked leftover:         ${result.parkedAfter}`);
  console.log("");
  console.log("Approved execution events");
  for (const kind of result.events) {
    console.log(`  • ${kind}`);
  }
  console.log("");
  console.log("ok: HTTP adopt loop (preview / approve / deny) completed.");
}

const isCli =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("adopt-demo.ts") || process.argv[1].endsWith("adopt-demo.js"));
if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

import { runAgentPurchase } from "./purchase.js";

const gatewayBaseUrl = process.env.GATEWAY_BASE_URL ?? "http://127.0.0.1:8787";
const resourceUrl = process.env.RESOURCE_URL ?? "http://127.0.0.1:8790/v1/research";

const result = await runAgentPurchase({ gatewayBaseUrl, resourceUrl });

console.log(
  JSON.stringify(
    {
      ok: true,
      operationId: result.operationId,
      fundingStatus: result.funding.status,
      resource: result.resource,
      executionState:
        typeof result.execution === "object" &&
        result.execution !== null &&
        "state" in result.execution
          ? (result.execution as { state: string }).state
          : undefined
    },
    null,
    2
  )
);

/**
 * Machine-readable control-plane contract. Keep in lockstep with `app.ts` routes
 * (see test/openapi-contract.test.ts).
 */
export const GATEWAY_OPENAPI_VERSION = "0.1.0";

type HttpMethod = "get" | "post" | "put";

export interface GatewayOpenApiOperation {
  summary: string;
  admin?: boolean;
  agent?: boolean;
  funds?: boolean;
}

export interface GatewayOpenApiPath {
  [method: string]: GatewayOpenApiOperation | undefined;
  get?: GatewayOpenApiOperation;
  post?: GatewayOpenApiOperation;
  put?: GatewayOpenApiOperation;
}

export const GATEWAY_OPENAPI_PATHS: Record<string, GatewayOpenApiPath> = {
  "/": { get: { summary: "Redirect to /ui" } },
  "/ui": { get: { summary: "Operator HTML (preview never funds; approve funds)" } },
  "/health": {
    get: { summary: "Liveness plus policyMode, parkedCount, 24h spend" }
  },
  "/openapi.json": { get: { summary: "This OpenAPI document" } },
  "/v1/spend": {
    get: { summary: "Rolling 24h spend vs daily and per-payment caps", admin: true }
  },
  "/v1/policy": {
    get: { summary: "Current payment policy", admin: true },
    put: { summary: "Replace payment policy", admin: true }
  },
  "/v1/balances": {
    get: { summary: "Buyer wallet balances as seen by the coordinator", admin: true }
  },
  "/v1/executions": {
    get: {
      summary:
        "Recent execution summaries. Unfiltered lists require admin when AGENTTAB_ADMIN_TOKEN is set; requestHash lookup stays available for agent resume.",
      admin: true
    },
    post: {
      summary: "Create or replay an execution from a PaymentIntent",
      funds: false,
      agent: true
    }
  },
  "/v1/executions/{operationId}": {
    get: { summary: "Full execution record and events", agent: true }
  },
  "/v1/preview": {
    post: {
      summary: "Evaluate policy only. Never creates an execution or funds.",
      agent: true
    }
  },
  "/v1/fund": {
    post: { summary: "Ensure payment asset (may park, fund, or deny)", funds: true, agent: true }
  },
  "/v1/approvals/{operationId}": {
    post: { summary: "Human approve a parked execution, then fund", admin: true, funds: true }
  },
  "/v1/denials/{operationId}": {
    post: { summary: "Terminal reject. Same operationId will not fund later.", admin: true }
  },
  "/v1/executions/{operationId}/pay": {
    post: {
      summary: "Record x402 settlement or issue local HMAC token",
      funds: false,
      agent: true
    }
  },
  "/v1/executions/{operationId}/fulfill": {
    post: { summary: "Mark resource fulfilled after settle", agent: true }
  },
  "/v1/settlements/verify": {
    post: { summary: "Verify a local HMAC payment token", agent: true }
  }
};

export function gatewayOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const [path, methods] of Object.entries(GATEWAY_OPENAPI_PATHS)) {
    const item: Record<string, unknown> = {};
    for (const method of ["get", "post", "put"] as HttpMethod[]) {
      const op = methods[method];
      if (op === undefined) continue;
      item[method] = {
        operationId: `${method}_${path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        summary: op.summary,
        ...(op.admin === true || op.agent === true
          ? {
              security: [
                ...(op.admin === true ? [{ bearerAdmin: [] }] : []),
                ...(op.agent === true ? [{ bearerAgent: [] }] : [])
              ],
              description:
                `${op.summary} ` +
                (op.admin === true
                  ? "Requires AGENTTAB_ADMIN_TOKEN when that env is set. "
                  : "") +
                (op.agent === true
                  ? "Requires AGENTTAB_AGENT_TOKEN (or admin) when that env is set."
                  : "")
            }
          : {}),
        ...(op.funds === true ? { "x-agenttab-funds": true } : {}),
        ...(op.funds === false ? { "x-agenttab-funds": false } : {}),
        responses: {
          "200": { description: "OK" },
          ...(method === "post" && path === "/v1/executions"
            ? { "201": { description: "Created" } }
            : {}),
          ...(op.admin === true ? { "401": { description: "Unauthorized" } } : {})
        }
      };
    }
    paths[path] = item;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "AgentTab gateway",
      version: GATEWAY_OPENAPI_VERSION,
      description:
        "Buyer-side policy + exact-deficit funding around standard x402. " +
        "POST /v1/preview never funds. POST /v1/denials/:id is terminal. " +
        "Observe mode is not a dry-run — approving still funds."
    },
    servers: [{ url: "/", description: "This gateway process" }],
    tags: [
      { name: "operator", description: "Human control plane" },
      { name: "agent", description: "Fund / pay / fulfill" }
    ],
    components: {
      securitySchemes: {
        bearerAdmin: {
          type: "http",
          scheme: "bearer",
          description: "AGENTTAB_ADMIN_TOKEN when configured"
        },
        bearerAgent: {
          type: "http",
          scheme: "bearer",
          description: "AGENTTAB_AGENT_TOKEN when configured (admin bearer also accepted)"
        }
      }
    },
    paths
  };
}

export function honoPathToOpenApi(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

import type {
  PaymentFundingCoordinator,
  PaymentIntent,
  PaymentPolicy,
  PolicyDecision
} from "@agenttab/core";
import {
  createGatewayAuditRecorder,
  createGatewayFundingCoordinator,
  type AgentTabAuditRecorder,
  type GatewayHttpOptions
} from "./gateway-client.js";

export interface AgentTabExecutionSummary {
  operationId: string;
  state: string;
  requestHash?: string;
  merchantOrigin?: string;
  resource?: string;
  amountAtomic?: string;
  amountUsdMicros?: string;
  lastEventKind?: string | null;
}

export interface AgentTabSpendSnapshot {
  spentUsdMicrosLast24h: string;
  maxDailyUsdMicros: string;
  maxPaymentUsdMicros: string;
}

export interface AgentTabGatewayHealth {
  ok: boolean;
  policyMode?: string;
  parkedCount?: number;
  spentUsdMicrosLast24h?: string;
  maxDailyUsdMicros?: string;
  notifyConfigured?: boolean;
  notifySigned?: boolean;
  operatorUi?: string;
  preview?: string;
  openapi?: string;
}

export interface AgentTabGatewayClient {
  funding: PaymentFundingCoordinator;
  audit: AgentTabAuditRecorder;
  getExecution(operationId: string): Promise<unknown>;
  listExecutions(query?: {
    limit?: number;
    state?: string;
    requestHash?: string;
    reusable?: boolean;
  }): Promise<{ executions: AgentTabExecutionSummary[]; count: number }>;
  listParked(): Promise<{ executions: AgentTabExecutionSummary[]; count: number }>;
  findReusableOperationId(requestHash: string): Promise<string | undefined>;
  getPolicy(): Promise<PaymentPolicy>;
  putPolicy(policy: PaymentPolicy): Promise<PaymentPolicy>;
  /** Append one origin to allowedMerchantOrigins (idempotent). */
  allowMerchantOrigin(origin: string): Promise<PaymentPolicy>;
  getSpend(): Promise<AgentTabSpendSnapshot>;
  getHealth(): Promise<AgentTabGatewayHealth>;
  approve(operationId: string): Promise<unknown>;
  /** Terminal reject. Same operationId will not fund later. */
  deny(operationId: string, reason?: string): Promise<unknown>;
  /** Read-only policy check. Never creates an execution or funds. */
  preview(intent: PaymentIntent): Promise<AgentTabPreviewResult>;
}

export interface AgentTabPreviewResult {
  preview: true;
  funded: false;
  policyMode: PaymentPolicy["mode"];
  decision: PolicyDecision;
  hint: string;
  observeIsNotDryRun: boolean;
}

/**
 * Thin HTTP client for a running AgentTab gateway.
 * Prefer this when an agent or operator needs policy/approve/audit outside fetch.
 */
export function createGatewayClient(options: GatewayHttpOptions): AgentTabGatewayClient {
  const funding = createGatewayFundingCoordinator(options);
  const audit = createGatewayAuditRecorder(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = options.headers ?? {};
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  const listExecutions: AgentTabGatewayClient["listExecutions"] = async (query = {}) => {
    const url = new URL(`${baseUrl}/v1/executions`);
    if (query.limit !== undefined) url.searchParams.set("limit", String(query.limit));
    if (query.state !== undefined) url.searchParams.set("state", query.state);
    if (query.requestHash !== undefined) {
      url.searchParams.set("requestHash", query.requestHash);
    }
    if (query.reusable === true) url.searchParams.set("reusable", "1");
    const response = await fetchImpl(url.toString(), {
      headers: { ...headers }
    });
    if (!response.ok) {
      throw new Error(`AgentTab gateway list executions failed (${response.status})`);
    }
    return (await response.json()) as {
      executions: AgentTabExecutionSummary[];
      count: number;
    };
  };

  const getPolicy: AgentTabGatewayClient["getPolicy"] = async () => {
    const response = await fetchImpl(`${baseUrl}/v1/policy`, {
      headers: { ...headers }
    });
    if (!response.ok) {
      throw new Error(`AgentTab gateway get policy failed (${response.status})`);
    }
    return (await response.json()) as PaymentPolicy;
  };

  const putPolicy: AgentTabGatewayClient["putPolicy"] = async (policy) => {
    const response = await fetchImpl(`${baseUrl}/v1/policy`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(policy)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        `AgentTab gateway put policy failed (${response.status}): ${JSON.stringify(body)}`
      );
    }
    return (await response.json()) as PaymentPolicy;
  };

  return {
    funding,
    audit,
    getExecution: async (operationId) => {
      if (audit.getExecution === undefined) {
        throw new Error("Gateway audit recorder is missing getExecution");
      }
      return audit.getExecution(operationId);
    },
    listExecutions,
    listParked: () => listExecutions({ state: "approval_required", limit: 50 }),
    findReusableOperationId: async (requestHash) => {
      try {
        const listed = await listExecutions({
          requestHash,
          reusable: true,
          limit: 1
        });
        const operationId = listed.executions[0]?.operationId;
        return typeof operationId === "string" && operationId.length > 0
          ? operationId
          : undefined;
      } catch {
        return undefined;
      }
    },
    getPolicy,
    putPolicy,
    allowMerchantOrigin: async (origin) => {
      const canonical = new URL(origin).origin;
      const policy = await getPolicy();
      if (policy.allowedMerchantOrigins.includes(canonical)) {
        return policy;
      }
      return putPolicy({
        ...policy,
        allowedMerchantOrigins: [...policy.allowedMerchantOrigins, canonical]
      });
    },
    getSpend: async () => {
      const response = await fetchImpl(`${baseUrl}/v1/spend`, {
        headers: { ...headers }
      });
      if (!response.ok) {
        throw new Error(`AgentTab gateway get spend failed (${response.status})`);
      }
      return (await response.json()) as AgentTabSpendSnapshot;
    },
    getHealth: async () => {
      const response = await fetchImpl(`${baseUrl}/health`, {
        headers: { ...headers }
      });
      if (!response.ok) {
        throw new Error(`AgentTab gateway health failed (${response.status})`);
      }
      return (await response.json()) as AgentTabGatewayHealth;
    },
    approve: async (operationId) => {
      const response = await fetchImpl(
        `${baseUrl}/v1/approvals/${encodeURIComponent(operationId)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers
          },
          body: "{}"
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          `AgentTab gateway approve failed (${response.status}): ${JSON.stringify(body)}`
        );
      }
      return response.json();
    },
    deny: async (operationId, reason) => {
      const response = await fetchImpl(
        `${baseUrl}/v1/denials/${encodeURIComponent(operationId)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers
          },
          body: JSON.stringify(reason === undefined ? {} : { reason })
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          `AgentTab gateway deny failed (${response.status}): ${JSON.stringify(body)}`
        );
      }
      return response.json();
    },
    preview: async (intent) => {
      const response = await fetchImpl(`${baseUrl}/v1/preview`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers
        },
        body: JSON.stringify(intent)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          `AgentTab gateway preview failed (${response.status}): ${JSON.stringify(body)}`
        );
      }
      return (await response.json()) as AgentTabPreviewResult;
    }
  };
}

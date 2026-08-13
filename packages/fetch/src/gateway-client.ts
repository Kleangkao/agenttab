import type { FundingOutcome, PaymentFundingCoordinator, PaymentIntent } from "@agenttab/core";

export interface GatewayHttpOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Bearer token for AGENTTAB_AGENT_TOKEN / admin when the gateway requires it. */
  headers?: Record<string, string>;
}

/** Explicit headers win; otherwise `AGENTTAB_AGENT_TOKEN` if set. */
export function resolveGatewayHeaders(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (headers !== undefined) return headers;
  const token = process.env.AGENTTAB_AGENT_TOKEN?.trim();
  if (token === undefined || token.length === 0) return undefined;
  return { authorization: `Bearer ${token}` };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/**
 * PaymentFundingCoordinator that calls a running AgentTab gateway over HTTP.
 * This is the primary remote integration path for agents that do not embed the gateway.
 */
export function createGatewayFundingCoordinator(
  options: GatewayHttpOptions
): PaymentFundingCoordinator {
  const fetchImpl = options.fetchImpl ?? fetch;
  const extraHeaders = options.headers ?? {};

  return {
    async ensurePaymentAsset({ intent, signal }) {
      const response = await fetchImpl(joinUrl(options.baseUrl, "/v1/fund"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...extraHeaders
        },
        body: JSON.stringify(intent),
        ...(signal === undefined ? {} : { signal })
      });
      const payload = (await response.json()) as {
        outcome?: FundingOutcome;
        error?: string;
        message?: string;
      };
      if (!response.ok || payload.outcome === undefined) {
        throw new Error(
          `AgentTab gateway fund failed (${response.status}): ${
            payload.error ?? payload.message ?? response.statusText
          }`
        );
      }
      return payload.outcome;
    }
  };
}

export interface AgentTabAuditRecorder {
  recordPayment(input: {
    operationId: string;
    settlementId?: string;
    transaction?: string;
    /** Persist payment_submitted before the merchant retry (blocks a second x402 pay). */
    submitted?: boolean;
  }): Promise<void>;
  recordFulfillment(input: {
    operationId: string;
    responseHash: string;
  }): Promise<void>;
  getExecution?(operationId: string): Promise<unknown>;
}

/**
 * Records external x402 settlement + resource fulfillment against the gateway audit store.
 */
export function createGatewayAuditRecorder(options: GatewayHttpOptions): AgentTabAuditRecorder {
  const fetchImpl = options.fetchImpl ?? fetch;
  const extraHeaders = options.headers ?? {};

  return {
    async recordPayment(input) {
      const response = await fetchImpl(
        joinUrl(options.baseUrl, `/v1/executions/${encodeURIComponent(input.operationId)}/pay`),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...extraHeaders
          },
          body: JSON.stringify({
            ...(input.submitted === true ? { submitted: true } : {}),
            ...(input.settlementId === undefined ? {} : { settlementId: input.settlementId }),
            ...(input.transaction === undefined ? {} : { transaction: input.transaction })
          })
        }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          state?: string;
        };
        throw new Error(
          `AgentTab gateway pay failed (${response.status}): ${
            payload.error ?? payload.state ?? response.statusText
          }`
        );
      }
    },

    async recordFulfillment(input) {
      const response = await fetchImpl(
        joinUrl(options.baseUrl, `/v1/executions/${encodeURIComponent(input.operationId)}/fulfill`),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...extraHeaders
          },
          body: JSON.stringify({ responseHash: input.responseHash })
        }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          state?: string;
        };
        throw new Error(
          `AgentTab gateway fulfill failed (${response.status}): ${
            payload.error ?? payload.state ?? response.statusText
          }`
        );
      }
    },

    async getExecution(operationId) {
      const response = await fetchImpl(
        joinUrl(options.baseUrl, `/v1/executions/${encodeURIComponent(operationId)}`),
        {
          headers: { ...extraHeaders }
        }
      );
      if (response.status === 404) return undefined;
      if (!response.ok) {
        throw new Error(`AgentTab gateway get execution failed (${response.status})`);
      }
      return response.json();
    }
  };
}

/** @internal helper for tests */
export type { PaymentIntent };

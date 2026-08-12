import {
  createAgentTabFetch,
  getAgentTabMeta,
  type AgentTabFetch,
  type AgentTabRequestMeta,
  type CreateAgentTabFetchOptions
} from "./create-fetch.js";
import { createGatewayClient, type AgentTabGatewayClient } from "./gateway-api.js";
import type { AgentTabApprovalRequiredError } from "./errors.js";
import { isAgentTabApprovalRequiredError } from "./errors.js";

export interface AgentTabClient {
  /** Drop-in paid fetch. Reuses a pending approval operationId by default. */
  fetch: AgentTabFetch;
  /** Read per-response AgentTab metadata (operationId, audit status). */
  getMeta(response: Response): AgentTabRequestMeta | undefined;
  /**
   * Load a durable execution receipt from the gateway.
   * Requires `gatewayBaseUrl` (or an `audit` recorder that implements getExecution).
   */
  getExecution(operationId: string): Promise<unknown>;
  /** Last `approval_required` thrown by `fetch`, if any. */
  getLastApprovalRequired(): AgentTabApprovalRequiredError | undefined;
  /** Optional gateway HTTP helpers when `gatewayBaseUrl` was provided. */
  gateway?: AgentTabGatewayClient;
}

/**
 * Higher-level agent entrypoint: paid fetch + execution lookup.
 * Use this when adopting AgentTab from an existing agent loop.
 */
export function createAgentTabClient(
  options: CreateAgentTabFetchOptions
): AgentTabClient {
  const fetchPaid = createAgentTabFetch(options);
  const gateway =
    options.gatewayBaseUrl !== undefined && options.gatewayBaseUrl.length > 0
      ? createGatewayClient({
          baseUrl: options.gatewayBaseUrl,
          fetchImpl: options.gatewayFetchImpl ?? options.fetchImpl ?? fetch,
          ...(options.gatewayHeaders === undefined
            ? {}
            : { headers: options.gatewayHeaders })
        })
      : undefined;

  let lastApproval: AgentTabApprovalRequiredError | undefined;

  const fetchWithMemory: AgentTabFetch = async (input, init) => {
    try {
      const response = await fetchPaid(input, init);
      lastApproval = undefined;
      return response;
    } catch (error) {
      if (isAgentTabApprovalRequiredError(error)) {
        lastApproval = error;
      }
      throw error;
    }
  };

  return {
    fetch: fetchWithMemory,
    getMeta: getAgentTabMeta,
    getLastApprovalRequired: () => lastApproval,
    getExecution: async (operationId) => {
      if (options.audit?.getExecution !== undefined) {
        return options.audit.getExecution(operationId);
      }
      if (gateway !== undefined) {
        return gateway.getExecution(operationId);
      }
      throw new Error(
        "getExecution requires `gatewayBaseUrl` or an `audit` recorder with getExecution"
      );
    },
    ...(gateway === undefined ? {} : { gateway })
  };
}

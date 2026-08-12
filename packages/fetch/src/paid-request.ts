import {
  isAgentTabApprovalRequiredError,
  type AgentTabApprovalRequiredError
} from "./errors.js";
import type { AgentTabClient } from "./client.js";

export interface RequestPaidResourceOptions {
  /**
   * Called when policy parks the payment. Return `"approve"` to POST
   * `/v1/approvals/:operationId` (requires `gateway` on the client) and retry
   * the same request. Return `"abort"` (default) to rethrow.
   */
  onApprovalRequired?: (
    error: AgentTabApprovalRequiredError
  ) => Promise<"approve" | "abort"> | "approve" | "abort";
}

export interface PaidResourceResult {
  response: Response;
  body: unknown;
  meta: ReturnType<AgentTabClient["getMeta"]>;
  execution: unknown;
  approvedByHook: boolean;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Paid fetch with optional in-process approve + same-operationId retry.
 * Use this instead of rolling your own catch/approve/retry loop.
 */
export async function requestPaidResource(
  agent: AgentTabClient,
  resourceUrl: string,
  init?: RequestInit,
  options: RequestPaidResourceOptions = {}
): Promise<PaidResourceResult> {
  const attempt = async (): Promise<PaidResourceResult> => {
    const response = await agent.fetch(resourceUrl, init);
    const meta = agent.getMeta(response);
    const body = await readBody(response);
    let execution: unknown;
    if (meta?.operationId) {
      try {
        execution = await agent.getExecution(meta.operationId);
      } catch {
        execution = undefined;
      }
    }
    return { response, body, meta, execution, approvedByHook: false };
  };

  try {
    return await attempt();
  } catch (error) {
    if (!isAgentTabApprovalRequiredError(error)) throw error;
    const decision = options.onApprovalRequired
      ? await options.onApprovalRequired(error)
      : "abort";
    if (decision !== "approve") throw error;
    if (agent.gateway === undefined) {
      throw new Error(
        `Approval granted by hook but AgentTab client has no gateway (need gatewayBaseUrl) for ${error.operationId}`
      );
    }
    await agent.gateway.approve(error.operationId);
    const retry = await attempt();
    return { ...retry, approvedByHook: true };
  }
}

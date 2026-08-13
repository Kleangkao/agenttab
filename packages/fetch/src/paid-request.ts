import {
  AgentTabFundingDeniedError,
  isAgentTabApprovalRequiredError,
  isAgentTabFundingInterruptedError,
  type AgentTabApprovalRequiredError
} from "./errors.js";
import type { AgentTabClient } from "./client.js";

const INTERRUPT_RETRIES = 1;

export interface RequestPaidResourceOptions {
  /**
   * Called when policy parks the payment. Return `"approve"` to POST
   * `/v1/approvals/:operationId` (requires `gateway` on the client) and retry
   * the same request. Return `"deny"` to POST `/v1/denials/:operationId` and
   * throw `AgentTabFundingDeniedError`. Return `"abort"` (default) to rethrow.
   */
  onApprovalRequired?: (
    error: AgentTabApprovalRequiredError
  ) => Promise<"approve" | "deny" | "abort"> | "approve" | "deny" | "abort";
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

async function withInterruptRetry(
  run: () => Promise<PaidResourceResult>
): Promise<PaidResourceResult> {
  let last: unknown;
  for (let attempt = 0; attempt <= INTERRUPT_RETRIES; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!isAgentTabFundingInterruptedError(error) || attempt === INTERRUPT_RETRIES) {
        throw error;
      }
    }
  }
  throw last;
}

/**
 * Paid fetch with optional in-process approve + same-operationId retry.
 * Use this instead of rolling your own catch/approve/retry loop.
 * Interrupted DFlow/sign attempts retry the same request once.
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
    return await withInterruptRetry(attempt);
  } catch (error) {
    if (!isAgentTabApprovalRequiredError(error)) throw error;
    const decision = options.onApprovalRequired
      ? await options.onApprovalRequired(error)
      : "abort";
    if (decision === "deny") {
      if (agent.gateway === undefined) {
        throw new Error(
          `Deny requested by hook but AgentTab client has no gateway (need gatewayBaseUrl) for ${error.operationId}`
        );
      }
      await agent.gateway.deny(error.operationId, "hook_denied");
      throw new AgentTabFundingDeniedError({
        code: "denied",
        message: "Denied by operator hook.",
        operationId: error.operationId,
        requestHash: error.requestHash,
        merchantId: error.merchantId
      });
    }
    if (decision !== "approve") throw error;
    if (agent.gateway === undefined) {
      throw new Error(
        `Approval granted by hook but AgentTab client has no gateway (need gatewayBaseUrl) for ${error.operationId}`
      );
    }
    const approved = (await agent.gateway.approve(error.operationId)) as {
      outcome?: { status?: string; reason?: string };
    };
    const status = approved.outcome?.status;
    if (
      status !== "funded" &&
      status !== "already_funded" &&
      status !== "interrupted"
    ) {
      throw new AgentTabFundingDeniedError({
        code: "denied",
        message:
          approved.outcome?.reason ??
          `Approve did not fund (status ${status ?? "unknown"}).`,
        operationId: error.operationId,
        requestHash: error.requestHash,
        merchantId: error.merchantId
      });
    }
    const retry = await withInterruptRetry(attempt);
    if (!retry.response.ok) {
      throw new Error(
        `AgentTab paid retry returned HTTP ${retry.response.status} for ${error.operationId}`
      );
    }
    return { ...retry, approvedByHook: true };
  }
}

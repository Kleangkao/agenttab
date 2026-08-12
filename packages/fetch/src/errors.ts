import {
  parseFundingAbortReason,
  type AgentTabFundingAbortPayload
} from "@agenttab/x402";

export class AgentTabFundingError extends Error {
  readonly operationId: string;
  readonly requestHash: string;
  readonly merchantId: string;
  readonly fundingMessage: string;

  constructor(
    message: string,
    payload: AgentTabFundingAbortPayload,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AgentTabFundingError";
    this.operationId = payload.operationId;
    this.requestHash = payload.requestHash;
    this.merchantId = payload.merchantId;
    this.fundingMessage = payload.message;
  }
}

/**
 * Policy parked this payment for a human.
 * Approve with the same `operationId`, then retry the fetch with the same id.
 */
export class AgentTabApprovalRequiredError extends AgentTabFundingError {
  readonly code = "approval_required" as const;

  constructor(payload: AgentTabFundingAbortPayload, options?: { cause?: unknown }) {
    super(
      `AgentTab approval required for operation ${payload.operationId}: ${payload.message}`,
      payload,
      options
    );
    this.name = "AgentTabApprovalRequiredError";
  }
}

/** Policy denied funding/payment. Do not retry without changing policy or intent. */
export class AgentTabFundingDeniedError extends AgentTabFundingError {
  readonly code = "denied" as const;

  constructor(payload: AgentTabFundingAbortPayload, options?: { cause?: unknown }) {
    super(
      `AgentTab funding denied for operation ${payload.operationId}: ${payload.message}`,
      payload,
      options
    );
    this.name = "AgentTabFundingDeniedError";
  }
}

export function toAgentTabFundingError(error: unknown): AgentTabFundingError | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const payload = parseFundingAbortReason(message);
  if (payload === undefined) return undefined;
  if (payload.code === "approval_required") {
    return new AgentTabApprovalRequiredError(payload, { cause: error });
  }
  return new AgentTabFundingDeniedError(payload, { cause: error });
}

export function isAgentTabApprovalRequiredError(
  error: unknown
): error is AgentTabApprovalRequiredError {
  return error instanceof AgentTabApprovalRequiredError;
}

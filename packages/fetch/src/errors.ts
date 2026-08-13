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

/** x402 payment already left this operation; do not create another payload. */
export class AgentTabAlreadyPaidError extends AgentTabFundingError {
  readonly code = "already_paid" as const;

  constructor(payload: AgentTabFundingAbortPayload, options?: { cause?: unknown }) {
    super(
      `AgentTab payment already submitted for operation ${payload.operationId}: ${payload.message}`,
      payload,
      options
    );
    this.name = "AgentTabAlreadyPaidError";
  }
}

/**
 * Funding stopped mid-flight but the same operationId can finish it
 * (plan or side-effect receipt retained). Retry the same request.
 */
export class AgentTabFundingInterruptedError extends AgentTabFundingError {
  readonly code = "interrupted" as const;

  constructor(payload: AgentTabFundingAbortPayload, options?: { cause?: unknown }) {
    super(
      `AgentTab funding interrupted for operation ${payload.operationId}: ${payload.message}`,
      payload,
      options
    );
    this.name = "AgentTabFundingInterruptedError";
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
  if (payload.code === "interrupted") {
    return new AgentTabFundingInterruptedError(payload, { cause: error });
  }
  if (payload.code === "already_paid") {
    return new AgentTabAlreadyPaidError(payload, { cause: error });
  }
  return new AgentTabFundingDeniedError(payload, { cause: error });
}

export function isAgentTabApprovalRequiredError(
  error: unknown
): error is AgentTabApprovalRequiredError {
  return error instanceof AgentTabApprovalRequiredError;
}

export function isAgentTabFundingDeniedError(
  error: unknown
): error is AgentTabFundingDeniedError {
  return error instanceof AgentTabFundingDeniedError;
}

export function isAgentTabFundingInterruptedError(
  error: unknown
): error is AgentTabFundingInterruptedError {
  return error instanceof AgentTabFundingInterruptedError;
}

export function isAgentTabAlreadyPaidError(
  error: unknown
): error is AgentTabAlreadyPaidError {
  return error instanceof AgentTabAlreadyPaidError;
}

/** Keep this operationId and retry the same request. */
export function isAgentTabRetryableFundingError(
  error: unknown
): error is AgentTabApprovalRequiredError | AgentTabFundingInterruptedError {
  return isAgentTabApprovalRequiredError(error) || isAgentTabFundingInterruptedError(error);
}

/** Do not mint a new operationId (retry funding, or avoid a second x402 pay). */
export function shouldReuseOperationId(
  error: unknown
): error is
  | AgentTabApprovalRequiredError
  | AgentTabFundingInterruptedError
  | AgentTabAlreadyPaidError {
  return isAgentTabRetryableFundingError(error) || isAgentTabAlreadyPaidError(error);
}

import type { FundingStatus } from "@agenttab/core";
import type { RequestBinding } from "./index.js";

export type AgentTabFundingAbortCode = Extract<
  FundingStatus,
  "approval_required" | "interrupted" | "already_paid" | "denied"
>;

export interface AgentTabFundingAbortPayload {
  code: AgentTabFundingAbortCode;
  message: string;
  operationId: string;
  requestHash: string;
  merchantId: string;
}

const PREFIX = "agenttab:";

/**
 * Encode a recoverable funding abort for x402's string `reason` field.
 * Parsed by `@agenttab/fetch` into typed errors that carry `operationId`.
 */
export function encodeFundingAbortReason(payload: AgentTabFundingAbortPayload): string {
  return `${PREFIX}${payload.code}:${JSON.stringify({
    message: payload.message,
    operationId: payload.operationId,
    requestHash: payload.requestHash,
    merchantId: payload.merchantId
  })}`;
}

export function parseFundingAbortReason(
  reasonOrErrorMessage: string
): AgentTabFundingAbortPayload | undefined {
  const marker = reasonOrErrorMessage.indexOf(PREFIX);
  if (marker < 0) return undefined;
  const body = reasonOrErrorMessage.slice(marker + PREFIX.length);
  const split = body.indexOf(":");
  if (split < 0) return undefined;
  const code = body.slice(0, split);
  if (
    code !== "approval_required" &&
    code !== "interrupted" &&
    code !== "already_paid" &&
    code !== "denied"
  ) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(body.slice(split + 1)) as {
      message?: string;
      operationId?: string;
      requestHash?: string;
      merchantId?: string;
    };
    if (
      typeof parsed.message !== "string" ||
      typeof parsed.operationId !== "string" ||
      typeof parsed.requestHash !== "string" ||
      typeof parsed.merchantId !== "string"
    ) {
      return undefined;
    }
    return {
      code,
      message: parsed.message,
      operationId: parsed.operationId,
      requestHash: parsed.requestHash,
      merchantId: parsed.merchantId
    };
  } catch {
    return undefined;
  }
}

export function fundingAbortFromOutcome(input: {
  status: AgentTabFundingAbortCode;
  reason: string;
  binding: RequestBinding;
}): AgentTabFundingAbortPayload {
  return {
    code: input.status,
    message: input.reason,
    operationId: input.binding.operationId,
    requestHash: input.binding.requestHash,
    merchantId: input.binding.merchantId
  };
}

/**
 * Remote agent integration template.
 *
 * Dependencies intentionally exclude `@agenttab/gateway`: the agent talks to a
 * running gateway over HTTP through `@agenttab/fetch`, the same way a third-party
 * agent process would.
 */
import {
  createAgentTabClient,
  requestPaidResource,
  stablecoinAtomicAsUsdMicros,
  type AgentTabClient,
  type CreateAgentTabFetchOptions,
  type PaidResourceResult,
  type RequestPaidResourceOptions
} from "@agenttab/fetch";
import type { SchemeRegistration } from "@x402/core/client";

export interface RemoteAgentOptions {
  gatewayBaseUrl: string;
  schemes: SchemeRegistration[];
  gatewayHeaders?: Record<string, string>;
  createOperationId?: CreateAgentTabFetchOptions["createOperationId"];
  onPaymentCreationFailure?: CreateAgentTabFetchOptions["onPaymentCreationFailure"];
  onAuditError?: CreateAgentTabFetchOptions["onAuditError"];
}

export function createRemoteAgent(options: RemoteAgentOptions): AgentTabClient {
  return createAgentTabClient({
    gatewayBaseUrl: options.gatewayBaseUrl,
    schemes: options.schemes,
    getUsdValueMicros: async ({ amountAtomic }) =>
      stablecoinAtomicAsUsdMicros(amountAtomic),
    ...(options.gatewayHeaders === undefined
      ? {}
      : { gatewayHeaders: options.gatewayHeaders }),
    ...(options.createOperationId === undefined
      ? {}
      : { createOperationId: options.createOperationId }),
    ...(options.onPaymentCreationFailure === undefined
      ? {}
      : { onPaymentCreationFailure: options.onPaymentCreationFailure }),
    ...(options.onAuditError === undefined ? {} : { onAuditError: options.onAuditError })
  });
}

export async function purchasePaidResource(
  agent: AgentTabClient,
  resourceUrl: string,
  init?: RequestInit,
  options?: RequestPaidResourceOptions
): Promise<PaidResourceResult> {
  return requestPaidResource(agent, resourceUrl, init, options);
}

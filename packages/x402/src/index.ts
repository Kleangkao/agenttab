import type { BeforePaymentCreationHook } from "@x402/core/client";
import type { PaymentIntent, PaymentFundingCoordinator } from "@agenttab/core";
import {
  encodeFundingAbortReason,
  fundingAbortFromOutcome,
  type AgentTabFundingAbortCode
} from "./abort.js";

export {
  encodeFundingAbortReason,
  fundingAbortFromOutcome,
  parseFundingAbortReason,
  type AgentTabFundingAbortCode,
  type AgentTabFundingAbortPayload
} from "./abort.js";

/**
 * Protocol boundary for x402. Concrete parsing and payment execution will use
 * the official x402 packages rather than reimplementing wire formats.
 */
export interface X402ChallengeAdapter {
  discover(response: Response, request: Request): Promise<PaymentIntent | null>;
  pay(input: { intent: PaymentIntent; request: Request }): Promise<{
    settlementId: string;
    retryRequest: Request;
  }>;
}

export interface RequestBinding {
  operationId: string;
  requestHash: string;
  merchantId: string;
}

/**
 * Creates an official x402 client hook that funds a selected Solana payment
 * requirement before the x402 package signs its payment payload.
 *
 * Request binding is mandatory: resource URL alone is not enough to safely
 * identify a retried POST request or prevent duplicate payment.
 *
 * Non-funded outcomes abort with a structured reason that includes
 * `operationId` so agents can `approve` and retry the **same** operation.
 */
export function createAgentTabFundingHook(input: {
  coordinator: PaymentFundingCoordinator;
  getRequestBinding: () => Promise<RequestBinding>;
  getUsdValueMicros: (payment: {
    network: string;
    assetMint: string;
    amountAtomic: string;
  }) => Promise<string | undefined>;
}): BeforePaymentCreationHook {
  return async ({ paymentRequired, selectedRequirements }) => {
    const binding = await input.getRequestBinding();
    const resourceUrl = paymentRequired.resource.url;
    const merchantOrigin = new URL(resourceUrl).origin;
    const amountUsdMicros = await input.getUsdValueMicros({
      network: selectedRequirements.network,
      assetMint: selectedRequirements.asset,
      amountAtomic: selectedRequirements.amount
    });

    const intent: PaymentIntent = {
      operationId: binding.operationId,
      requestHash: binding.requestHash,
      protocol: "x402",
      network: selectedRequirements.network,
      merchantId: binding.merchantId,
      merchantOrigin,
      destination: selectedRequirements.payTo,
      assetMint: selectedRequirements.asset,
      amountAtomic: selectedRequirements.amount,
      resource: resourceUrl,
      ...(amountUsdMicros === undefined ? {} : { amountUsdMicros })
    };

    const outcome = await input.coordinator.ensurePaymentAsset({ intent });
    if (outcome.status === "already_funded" || outcome.status === "funded") return;

    const code = outcome.status as AgentTabFundingAbortCode;
    return {
      abort: true,
      reason: encodeFundingAbortReason(
        fundingAbortFromOutcome({
          status: code,
          reason: outcome.reason,
          binding
        })
      )
    };
  };
}

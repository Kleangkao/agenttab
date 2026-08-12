import { createHash, randomUUID } from "node:crypto";
import type { FundingOutcome, PaymentIntent } from "@agenttab/core";
import { createAgentTabFundingHook, type RequestBinding } from "@agenttab/x402";
import {
  DEMO_PAYMENT_AMOUNT_ATOMIC,
  DEMO_PAYMENT_USD_MICROS,
  LOCAL_NETWORK,
  USDC_MINT
} from "@agenttab/gateway";

export interface AgentClientOptions {
  gatewayBaseUrl: string;
  resourceUrl: string;
  fetchImpl?: typeof fetch;
  operationId?: string;
}

export interface AgentPurchaseResult {
  operationId: string;
  requestHash: string;
  funding: FundingOutcome;
  paymentToken: string;
  resource: unknown;
  execution: unknown;
}

function hashRequest(method: string, url: string, body: string): string {
  return `sha256:${createHash("sha256").update(`${method}\n${url}\n${body}`).digest("hex")}`;
}

function decodeChallenge(encoded: string): {
  resource: { url: string };
  accepts: Array<{
    network: string;
    asset: string;
    amount: string;
    payTo: string;
  }>;
} {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    resource: { url: string };
    accepts: Array<{
      network: string;
      asset: string;
      amount: string;
      payTo: string;
    }>;
  };
}

export async function runAgentPurchase(options: AgentClientOptions): Promise<AgentPurchaseResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const operationId = options.operationId ?? `research-${randomUUID()}`;
  const method = "GET";
  const body = "";
  const requestHash = hashRequest(method, options.resourceUrl, body);
  const merchantOrigin = new URL(options.resourceUrl).origin;
  const merchantId = new URL(options.resourceUrl).host;

  const binding: RequestBinding = { operationId, requestHash, merchantId };

  const initial = await fetchImpl(options.resourceUrl, { method });
  if (initial.status !== 402) {
    throw new Error(`Expected 402 from paid API, got ${initial.status}`);
  }

  const paymentRequiredHeader = initial.headers.get("PAYMENT-REQUIRED");
  if (!paymentRequiredHeader) {
    throw new Error("Missing PAYMENT-REQUIRED header");
  }
  const challenge = decodeChallenge(paymentRequiredHeader);
  const requirement = challenge.accepts[0];
  if (requirement === undefined) {
    throw new Error("Payment challenge has no accepts");
  }

  const intent: PaymentIntent = {
    operationId,
    requestHash,
    protocol: "x402",
    network: requirement.network || LOCAL_NETWORK,
    merchantId,
    merchantOrigin,
    destination: requirement.payTo,
    assetMint: requirement.asset || USDC_MINT,
    amountAtomic: requirement.amount || DEMO_PAYMENT_AMOUNT_ATOMIC,
    amountUsdMicros: DEMO_PAYMENT_USD_MICROS,
    resource: options.resourceUrl
  };

  const fundResponse = await fetchImpl(`${options.gatewayBaseUrl}/v1/fund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(intent)
  });
  const fundPayload = (await fundResponse.json()) as {
    outcome: FundingOutcome;
    record: unknown;
  };
  if (!fundResponse.ok) {
    throw new Error(`Gateway fund failed: ${fundResponse.status}`);
  }
  if (fundPayload.outcome.status !== "funded" && fundPayload.outcome.status !== "already_funded") {
    throw new Error(`Funding not ready: ${fundPayload.outcome.status}: ${fundPayload.outcome.reason}`);
  }

  // Exercise the official x402 funding-hook contract against the durable coordinator.
  const hook = createAgentTabFundingHook({
    coordinator: {
      ensurePaymentAsset: async ({ intent: hookIntent }) => {
        const response = await fetchImpl(`${options.gatewayBaseUrl}/v1/fund`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(hookIntent)
        });
        const payload = (await response.json()) as { outcome: FundingOutcome };
        if (!response.ok) {
          throw new Error(`Gateway fund failed: ${response.status}`);
        }
        return payload.outcome;
      }
    },
    getRequestBinding: async () => binding,
    getUsdValueMicros: async () => DEMO_PAYMENT_USD_MICROS
  });

  const hookResult = await hook({
    paymentRequired: {
      x402Version: 2,
      resource: { url: options.resourceUrl },
      accepts: []
    },
    selectedRequirements: {
      scheme: "exact",
      network: intent.network as `${string}:${string}`,
      asset: intent.assetMint,
      amount: intent.amountAtomic,
      payTo: intent.destination,
      maxTimeoutSeconds: 60,
      extra: {}
    }
  });

  if (hookResult?.abort) {
    throw new Error(`Funding aborted: ${hookResult.reason}`);
  }

  const payResponse = await fetchImpl(
    `${options.gatewayBaseUrl}/v1/executions/${operationId}/pay`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }
  );
  const payPayload = (await payResponse.json()) as { token?: string; error?: string };
  if (!payResponse.ok || !payPayload.token) {
    throw new Error(`Payment failed: ${payPayload.error ?? payResponse.status}`);
  }

  const fulfilled = await fetchImpl(options.resourceUrl, {
    method,
    headers: {
      "PAYMENT-SIGNATURE": payPayload.token
    }
  });
  if (!fulfilled.ok) {
    throw new Error(`Resource fulfillment failed: ${fulfilled.status}`);
  }
  const resource = await fulfilled.json();

  const complete = await fetchImpl(
    `${options.gatewayBaseUrl}/v1/executions/${operationId}/fulfill`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        responseHash: hashRequest("RESPONSE", options.resourceUrl, JSON.stringify(resource))
      })
    }
  );
  const completePayload = (await complete.json()) as { record: unknown };
  if (!complete.ok) {
    throw new Error(`Fulfillment record failed: ${complete.status}`);
  }

  return {
    operationId,
    requestHash,
    funding: fundPayload.outcome,
    paymentToken: payPayload.token,
    resource,
    execution: completePayload.record
  };
}

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  createAgentTabClient,
  createLocalSmokeScheme,
  isAgentTabApprovalRequiredError,
  isAgentTabFundingDeniedError,
  requestPaidResource
} from "@agenttab/fetch";
import {
  createGatewayRuntime,
  loadPolicyFile,
  LOCAL_NETWORK,
  USDC_MINT
} from "../src/index.js";
import { honoRequestPath } from "./request-path.js";

function encodePaymentRequired(url: string): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url },
      accepts: [
        {
          scheme: "exact",
          network: LOCAL_NETWORK,
          asset: USDC_MINT,
          amount: "1000",
          payTo: "NeutralMerchant111111111111111111111111111",
          maxTimeoutSeconds: 60,
          extra: {}
        }
      ]
    }),
    "utf8"
  ).toString("base64");
}

describe("approve → retry same operationId via @agenttab/fetch", () => {
  it("requestPaidResource approves and fulfills without a new operationId", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const merchantOrigin = "http://127.0.0.1:8791";
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy,
      wallet: "ApproveRetryBuyer11111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    const merchantFetch = async (request: Request): Promise<Response> => {
      const paid =
        request.headers.has("PAYMENT-SIGNATURE") || request.headers.has("X-PAYMENT");
      if (!paid) {
        return new Response(JSON.stringify({ error: "payment_required" }), {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": encodePaymentRequired(request.url),
            "content-type": "application/json"
          }
        });
      }
      return new Response(
        JSON.stringify({ service: "neutral-market-snapshot", paid: true }),
        {
          status: 200,
          headers: {
            "PAYMENT-RESPONSE": "settle-approve-retry",
            "content-type": "application/json"
          }
        }
      );
    };

    const agent = createAgentTabClient({
      gatewayBaseUrl: "http://gateway.test",
      gatewayFetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        return gateway.app.request(honoRequestPath(input), init);
      }) as typeof fetch,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        return merchantFetch(request);
      }) as typeof fetch,
      schemes: [{ network: LOCAL_NETWORK, client: createLocalSmokeScheme() }],
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic
    });

    const result = await requestPaidResource(
      agent,
      `${merchantOrigin}/v1/market-snapshot`,
      { method: "GET" },
      { onApprovalRequired: async () => "approve" }
    );

    expect(result.approvedByHook).toBe(true);
    expect(result.response.status).toBe(200);
    expect(result.meta?.auditRecorded).toBe(true);
    expect(result.execution).toMatchObject({ state: "fulfilled" });
    gateway.close();
  });

  it("a new client resumes the parked operationId after human approve", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const merchantOrigin = "http://127.0.0.1:8791";
    const resourceUrl = `${merchantOrigin}/v1/market-snapshot`;
    const otherUrl = `${merchantOrigin}/v1/other-snapshot`;
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy,
      wallet: "ApproveRetryBuyer11111111111111111111112",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    const merchantFetch = async (request: Request): Promise<Response> => {
      const paid =
        request.headers.has("PAYMENT-SIGNATURE") || request.headers.has("X-PAYMENT");
      if (!paid) {
        return new Response(JSON.stringify({ error: "payment_required" }), {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": encodePaymentRequired(request.url),
            "content-type": "application/json"
          }
        });
      }
      return new Response(
        JSON.stringify({ service: "neutral-market-snapshot", paid: true }),
        {
          status: 200,
          headers: {
            "PAYMENT-RESPONSE": "settle-cross-process",
            "content-type": "application/json"
          }
        }
      );
    };

    const newClient = () =>
      createAgentTabClient({
        gatewayBaseUrl: "http://gateway.test",
        gatewayFetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          return gateway.app.request(honoRequestPath(input), init);
        }) as typeof fetch,
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(String(input), init);
          return merchantFetch(request);
        }) as typeof fetch,
        schemes: [{ network: LOCAL_NETWORK, client: createLocalSmokeScheme() }],
        getUsdValueMicros: async ({ amountAtomic }) => amountAtomic
      });

    const first = newClient();
    const parked = first.fetch(resourceUrl, { method: "GET" });
    await expect(parked).rejects.toSatisfy(isAgentTabApprovalRequiredError);
    const error = await parked.catch((value: unknown) => value);
    if (!isAgentTabApprovalRequiredError(error)) throw error;
    const parkedId = error.operationId;

    await first.gateway!.approve(parkedId);

    const second = newClient();
    const result = await requestPaidResource(second, resourceUrl, { method: "GET" });
    expect(result.response.status).toBe(200);
    expect(result.meta?.operationId).toBe(parkedId);
    expect(result.execution).toMatchObject({ state: "fulfilled", operationId: parkedId });

    const third = newClient();
    const other = third.fetch(otherUrl, { method: "GET" });
    await expect(other).rejects.toSatisfy(isAgentTabApprovalRequiredError);
    const otherError = await other.catch((value: unknown) => value);
    if (!isAgentTabApprovalRequiredError(otherError)) throw otherError;
    expect(otherError.operationId).not.toBe(parkedId);

    const fourth = newClient();
    const replay = fourth.fetch(resourceUrl, { method: "GET" });
    await expect(replay).rejects.toSatisfy(isAgentTabApprovalRequiredError);
    const replayError = await replay.catch((value: unknown) => value);
    if (!isAgentTabApprovalRequiredError(replayError)) throw replayError;
    expect(replayError.operationId).not.toBe(parkedId);

    gateway.close();
  });

  it("requestPaidResource deny hook terminals the parked id without funding", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const merchantOrigin = "http://127.0.0.1:8791";
    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy,
      wallet: "DenyRetryBuyer1111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    const merchantFetch = async (request: Request): Promise<Response> => {
      return new Response(JSON.stringify({ error: "payment_required" }), {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": encodePaymentRequired(request.url),
          "content-type": "application/json"
        }
      });
    };
    const agent = createAgentTabClient({
      gatewayBaseUrl: "http://gateway.test",
      gatewayFetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        return gateway.app.request(honoRequestPath(input), init);
      }) as typeof fetch,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        return merchantFetch(request);
      }) as typeof fetch,
      schemes: [{ network: LOCAL_NETWORK, client: createLocalSmokeScheme() }],
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic
    });

    await expect(
      requestPaidResource(
        agent,
        `${merchantOrigin}/v1/market-snapshot`,
        { method: "GET" },
        { onApprovalRequired: async () => "deny" }
      )
    ).rejects.toSatisfy(isAgentTabFundingDeniedError);

    const records = await gateway.store.listRecent({ limit: 5 });
    expect(records[0]?.state).toBe("denied");
    expect(records[0]?.lastEventKind).toBe("approval.denied");
    gateway.close();
  });
});

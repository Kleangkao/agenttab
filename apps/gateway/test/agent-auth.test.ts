import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  createGatewayRuntime,
  loadPolicyFile,
  LOCAL_NETWORK,
  USDC_MINT
} from "../src/index.js";
import { createGatewayClient } from "@agenttab/fetch";

describe("optional agent token", () => {
  it("leaves fund open when no agent token is configured", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: loadPolicyFile(
        resolve(process.cwd(), "../../examples/policies/approve.local.json")
      ),
      initialUsdcAtomic: "0"
    });
    expect(await (await gateway.app.request("/health")).json()).toMatchObject({
      agentAuth: false
    });
    const fund = await gateway.app.request("/v1/fund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationId: "agent-auth-open",
        requestHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
        protocol: "x402",
        network: LOCAL_NETWORK,
        merchantId: "127.0.0.1:8791",
        merchantOrigin: "http://127.0.0.1:8791",
        destination: "NeutralMerchant111111111111111111111111111",
        assetMint: USDC_MINT,
        amountAtomic: "1000",
        amountUsdMicros: "1000",
        resource: "http://127.0.0.1:8791/v1/market-snapshot"
      })
    });
    expect(fund.status).toBe(200);
    gateway.close();
  });

  it("requires agent or admin bearer for fund and still parks under policy", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: loadPolicyFile(
        resolve(process.cwd(), "../../examples/policies/approve.local.json")
      ),
      adminToken: "secret-admin",
      agentToken: "secret-agent",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    const intent = {
      operationId: "agent-auth-gated",
      requestHash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      protocol: "x402",
      network: LOCAL_NETWORK,
      merchantId: "127.0.0.1:8791",
      merchantOrigin: "http://127.0.0.1:8791",
      destination: "NeutralMerchant111111111111111111111111111",
      assetMint: USDC_MINT,
      amountAtomic: "1000",
      amountUsdMicros: "1000",
      resource: "http://127.0.0.1:8791/v1/market-snapshot"
    };
    expect((await gateway.app.request("/v1/fund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent)
    })).status).toBe(401);
    expect((await gateway.app.request("/v1/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent)
    })).status).toBe(401);

    const agentFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = String(input instanceof Request ? input.url : input);
      const path = raw.startsWith("http")
        ? `${new URL(raw).pathname}${new URL(raw).search}`
        : raw;
      return gateway.app.request(path, init);
    }) as typeof fetch;
    const client = createGatewayClient({
      baseUrl: "http://agenttab.local",
      fetchImpl: agentFetch,
      headers: { authorization: "Bearer secret-agent" }
    });
    const preview = await client.preview(intent);
    expect(preview.funded).toBe(false);
    const funded = await client.funding.ensurePaymentAsset({ intent });
    expect(funded.status).toBe("approval_required");

    const asAdmin = await gateway.app.request("/v1/fund", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret-admin"
      },
      body: JSON.stringify({ ...intent, operationId: "agent-auth-admin" })
    });
    expect(asAdmin.status).toBe(200);
    expect(await (await gateway.app.request("/health")).json()).toMatchObject({
      agentAuth: true,
      policyWriteAuth: true
    });
    const ui = await (await gateway.app.request("/ui")).text();
    expect(ui).toContain("Gateway token");
    gateway.close();
  });
});

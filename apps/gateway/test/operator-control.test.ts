import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paymentIntentSchema } from "@agenttab/core";
import {
  createGatewayRuntime,
  loadPolicyFile,
  LOCAL_NETWORK,
  USDC_MINT
} from "../src/index.js";
import { createGatewayClient } from "@agenttab/fetch";

describe("operator control spine", () => {
  it("seeds from policy file, requires approve, then funds after approval", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy,
      wallet: "OperatorControlBuyer111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    const gatewayFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = String(input instanceof Request ? input.url : input);
      const path = raw.startsWith("http")
        ? `${new URL(raw).pathname}${new URL(raw).search}`
        : raw;
      return gateway.app.request(path, init);
    }) as typeof fetch;

    const client = createGatewayClient({
      baseUrl: "http://agenttab.local",
      fetchImpl: gatewayFetch
    });

    expect((await client.getPolicy()).mode).toBe("approve");

    const autopay = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/autopay.local.json")
    );
    const updated = await client.putPolicy(autopay);
    expect(updated.mode).toBe("autopay");
    await client.putPolicy(policy);

    const operationId = "operator-approve-1";
    const intent = {
      operationId,
      requestHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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

    const before = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(before.status).toBe("approval_required");

    const waiting = await gateway.store.get(operationId);
    expect(waiting?.state).toBe("approval_required");

    const approved = await client.approve(operationId);
    expect(approved).toMatchObject({
      outcome: { status: expect.stringMatching(/funded|already_funded/) }
    });

    const funded = await gateway.store.get(operationId);
    expect(funded?.state).toBe("funded");
    gateway.close();
  });

  it("previews policy without creating or funding an execution", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy,
      wallet: "OperatorPreviewBuyer111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    const intent = {
      operationId: "operator-preview-1",
      requestHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
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

    const preview = await gateway.app.request("/v1/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent)
    });
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as {
      preview: boolean;
      funded: boolean;
      decision: { kind: string; reason: string };
    };
    expect(body).toMatchObject({
      preview: true,
      funded: false,
      decision: { kind: "approval_required" }
    });
    expect(await gateway.store.get(intent.operationId)).toBeUndefined();

    const blocked = await gateway.app.request("/v1/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...intent, merchantOrigin: "http://evil.example" })
    });
    const denied = (await blocked.json()) as { decision: { reason: string }; hint: string };
    expect(denied.decision.reason).toBe("merchant_not_allowed");
    expect(denied.hint).toMatch(/allowedMerchantOrigins/);

    const gatewayFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = String(input instanceof Request ? input.url : input);
      const path = raw.startsWith("http")
        ? `${new URL(raw).pathname}${new URL(raw).search}`
        : raw;
      return gateway.app.request(path, init);
    }) as typeof fetch;
    const client = createGatewayClient({
      baseUrl: "http://agenttab.local",
      fetchImpl: gatewayFetch
    });
    const allowed = await client.allowMerchantOrigin("http://evil.example/ignored");
    expect(allowed.allowedMerchantOrigins).toContain("http://evil.example");
    const admitted = await (
      await gateway.app.request("/v1/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...intent, merchantOrigin: "http://evil.example" })
      })
    ).json();
    expect(admitted.decision.reason).not.toBe("merchant_not_allowed");

    const observePolicy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/observe.local.json")
    );
    const observeGw = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: observePolicy
    });
    const unknownUsd = await observeGw.app.request("/v1/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...intent,
        operationId: "operator-preview-observe",
        amountUsdMicros: undefined
      })
    });
    const observeBody = (await unknownUsd.json()) as {
      observeIsNotDryRun: boolean;
      decision: { kind: string; reason: string };
    };
    expect(observeBody.observeIsNotDryRun).toBe(true);
    expect(observeBody.decision).toMatchObject({
      kind: "approval_required",
      reason: "usd_value_unknown"
    });
    const exampleRaw = JSON.parse(
      readFileSync(resolve(process.cwd(), "../../examples/intents/preview.local.json"), "utf8")
    ) as { notes?: unknown };
    delete exampleRaw.notes;
    const exampleIntent = paymentIntentSchema.parse(exampleRaw);
    const examplePreview = await gateway.app.request("/v1/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(exampleIntent)
    });
    expect(examplePreview.status).toBe(200);
    expect(await examplePreview.json()).toMatchObject({
      preview: true,
      funded: false,
      decision: { kind: "approval_required" }
    });

    observeGw.close();
    gateway.close();
  });

  it("serves operator UI and gates approve when admin token is set", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy,
      adminToken: "secret-admin",
      wallet: "OperatorUiBuyer1111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    const home = await gateway.app.request("/");
    expect(home.status).toBe(302);
    expect(home.headers.get("location")).toBe("/ui");

    const ui = await gateway.app.request("/ui");
    expect(ui.status).toBe(200);
    const html = await ui.text();
    expect(html).toContain("AgentTab operator");
    expect(html).toContain("adminRequired = true");
    expect(html).toContain("Allow origin");
    expect(html).toContain("Set mode");
    expect(html).toContain("µUSD");
    expect(html).toContain("<th>last</th>");
    expect(html).toContain("/openapi.json");

    const health = await gateway.app.request("/health");
    expect(await health.json()).toMatchObject({
      operatorUi: "/ui",
      preview: "/v1/preview",
      policyWriteAuth: true,
      parkedCount: 0,
      spentUsdMicrosLast24h: "0"
    });
    const spend = await gateway.app.request("/v1/spend");
    expect(await spend.json()).toMatchObject({
      spentUsdMicrosLast24h: "0",
      maxDailyUsdMicros: policy.maxDailyUsdMicros
    });

    const intent = {
      operationId: "operator-ui-approve-1",
      requestHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
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
    const parked = await gateway.coordinator.ensurePaymentAsset({ intent });
    expect(parked.status).toBe("approval_required");
    expect(await (await gateway.app.request("/health")).json()).toMatchObject({
      parkedCount: 1
    });
    const listed = await (
      await gateway.app.request("/v1/executions?state=approval_required")
    ).json();
    expect(listed.executions[0]).toMatchObject({
      operationId: intent.operationId,
      merchantOrigin: intent.merchantOrigin,
      amountUsdMicros: "1000",
      resource: intent.resource
    });

    const denied = await gateway.app.request(`/v1/approvals/${intent.operationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(denied.status).toBe(401);

    const allowed = await gateway.app.request(`/v1/approvals/${intent.operationId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret-admin"
      },
      body: "{}"
    });
    expect(allowed.status).toBe(200);
    expect((await gateway.store.get(intent.operationId))?.state).toBe("funded");
    expect(await (await gateway.app.request("/health")).json()).toMatchObject({
      parkedCount: 0
    });
    gateway.close();
  });

  it("denies a parked execution without funding and does not reuse it", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy,
      adminToken: "secret-admin",
      wallet: "OperatorDenyBuyer111111111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    const gatewayFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = String(input instanceof Request ? input.url : input);
      const path = raw.startsWith("http")
        ? `${new URL(raw).pathname}${new URL(raw).search}`
        : raw;
      return gateway.app.request(path, init);
    }) as typeof fetch;
    const client = createGatewayClient({
      baseUrl: "http://agenttab.local",
      fetchImpl: gatewayFetch,
      headers: { authorization: "Bearer secret-admin" }
    });

    const intent = {
      operationId: "operator-deny-1",
      requestHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
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
    expect((await gateway.coordinator.ensurePaymentAsset({ intent })).status).toBe(
      "approval_required"
    );

    const anonymous = await gateway.app.request(`/v1/denials/${intent.operationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(anonymous.status).toBe(401);

    const denied = await client.deny(intent.operationId, "operator_denied");
    expect(denied).toMatchObject({
      denied: true,
      funded: false,
      record: { state: "denied" }
    });
    expect((await gateway.store.get(intent.operationId))?.state).toBe("denied");
    expect(await client.findReusableOperationId(intent.requestHash)).toBeUndefined();

    const ui = await gateway.app.request("/ui");
    expect(await ui.text()).toContain("Deny");
    gateway.close();
  });
});

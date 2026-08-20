import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  createGatewayRuntime,
  loadPolicyFile,
  LOCAL_NETWORK,
  USDC_MINT
} from "../src/index.js";

describe("operator console", () => {
  it("serves a product console that drives the live control plane", async () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy,
      adminToken: "console-admin",
      wallet: "OperatorConsoleBuyer11111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });

    try {
      const htmlRes = await gateway.app.request("/ui");
      expect(htmlRes.status).toBe(200);
      expect(htmlRes.headers.get("content-type")).toMatch(/html/);
      expect(htmlRes.headers.get("cache-control")).toMatch(/no-store/);
      const html = await htmlRes.text();
      expect(html).toContain("AgentTab");
      expect(html).toContain("Now");
      expect(html).toContain("Ledger");
      expect(html).toContain("Policy");
      expect(html).toContain("Buy only the missing payment asset, then finish the original request");
      expect(html).toContain("local DFlow mock");
      expect(html).toContain("solscan.io/tx/");
      expect(html).toContain("/ui/app.css");
      expect(html).toContain("/ui/app.js");
      expect(html).toContain('"adminRequired":true');

      const css = await gateway.app.request("/ui/app.css");
      expect(css.status).toBe(200);
      expect(css.headers.get("content-type")).toMatch(/text\/css/);
      expect(await css.text()).toContain("--money:");

      const jsRes = await gateway.app.request("/ui/app.js");
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get("content-type")).toMatch(/javascript/);
      const js = await jsRes.text();
      expect(js).toContain("/v1/executions?reusable=1");
      expect(js).toContain("/v1/executions/");
      expect(js).toContain("/resume");
      expect(js).toContain("/v1/policy");
      expect(js).toContain("/v1/spend");
      expect(js).toContain("/v1/balances");
      expect(js).toContain("/v1/preview");
      expect(js).toContain("/v1/approvals/");
      expect(js).toContain("/v1/denials/");
      expect(js).toContain("Observe is not a dry-run");
      expect(js).toContain("Approve");
      expect(js).toContain("Reject");
      expect(js).toContain("Resume");
      expect(js).toContain("Waiting for you");
      expect(js).toContain("The agent is blocked");
      expect(js).toContain("Buy only the exact deficit");
      expect(js).toContain("original request");
      expect(js).toContain("No agent is blocked");
      expect(js).toContain("local DFlow mock");
      expect(js).toContain("solscan.io/tx/");
      expect(js).toContain("finishRequest");
      expect(js).toContain("Policy denied this after approval");
      expect(js).toContain("Funding failed");
      expect(js).toContain("policy.denied");
      expect(js).toContain("Alert delivered");
      expect(js).toContain("notifyDeliveries");
      expect(js).toContain("agentId");
      expect(js).toContain(">Agent ");
      expect(js).toContain("detailIsStale");
      expect(js).toContain("historicalDeficit");
      expect(js).toContain("funding.plan_receipt");
      expect(js).toContain("the exact deficit");
      expect(js).not.toContain('alreadyHeld || (!deficitKnown && !inflight) ? "none"');

      const intent = {
        operationId: "console-park-1",
        requestHash:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        protocol: "x402",
        network: LOCAL_NETWORK,
        merchantId: "127.0.0.1:8791",
        merchantOrigin: "http://127.0.0.1:8791",
        destination: "NeutralMerchant111111111111111111111111111",
        assetMint: USDC_MINT,
        amountAtomic: "2500000",
        amountUsdMicros: "2500000",
        resource: "http://127.0.0.1:8791/v1/market-snapshot"
      };
      expect((await gateway.coordinator.ensurePaymentAsset({ intent })).status).toBe(
        "approval_required"
      );

      const auth = { authorization: "Bearer console-admin" };
      const parked = await gateway.app.request(
        "/v1/executions?state=approval_required&limit=20",
        { headers: auth }
      );
      expect(parked.status).toBe(200);
      const parkedBody = (await parked.json()) as {
        executions: Array<{
          operationId: string;
          merchantOrigin: string;
          amountUsdMicros?: string;
          resource: string;
        }>;
      };
      expect(parkedBody.executions[0]).toMatchObject({
        operationId: "console-park-1",
        merchantOrigin: "http://127.0.0.1:8791",
        amountUsdMicros: "2500000",
        resource: "http://127.0.0.1:8791/v1/market-snapshot"
      });

      const preview = await gateway.app.request("/v1/preview", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({
          operationId: "preview-console",
          requestHash: "sha256:previewpreviewpreviewpreviewpreviewpreviewpreviewpreview",
          protocol: "x402",
          network: LOCAL_NETWORK,
          merchantId: "127.0.0.1:8791",
          merchantOrigin: "http://127.0.0.1:8791",
          destination: "PreviewDestination1111111111111111111111111",
          assetMint: USDC_MINT,
          amountAtomic: "1000",
          amountUsdMicros: "1000",
          resource: "http://127.0.0.1:8791/v1/market-snapshot"
        })
      });
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({
        preview: true,
        funded: false,
        decision: { kind: "approval_required" }
      });
      expect(await gateway.store.get("preview-console")).toBeUndefined();

      const approved = await gateway.app.request("/v1/approvals/console-park-1", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: "{}"
      });
      expect(approved.status).toBe(200);
      expect((await gateway.store.get("console-park-1"))?.state).toBe("funded");
      const funded = await gateway.store.get("console-park-1");
      expect(funded?.events.some((event) => event.kind === "funding.submitted")).toBe(true);
      expect(funded?.events.find((event) => event.kind === "funding.submitted")?.details).toMatchObject({
        deficitAtomic: "2500000"
      });
    } finally {
      gateway.close();
    }
  });

  it("keeps approve/deny, USD scale, and halt labels from being swapped", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: loadPolicyFile(
        resolve(process.cwd(), "../../examples/policies/approve.local.json")
      ),
      adminToken: "console-admin",
      wallet: "OperatorMoneyUiBuyer1111111111111111111",
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    try {
      const js = await (await gateway.app.request("/ui/app.js")).text();
      expect(js).toMatch(
        /async function approve\(id\)[\s\S]*?\/v1\/approvals\/\$\{encodeURIComponent\(id\)\}/
      );
      expect(js).toMatch(
        /async function deny\(id\)[\s\S]*?\/v1\/denials\/\$\{encodeURIComponent\(id\)\}/
      );
      expect(js).toContain('if (state.pending?.act === "approve") approve(id)');
      expect(js).toContain('if (state.pending?.act === "deny") deny(id)');
      expect(js).toContain(USDC_MINT);
      expect(js).toContain("n / 1_000_000");
      expect(js).toContain("Math.round(n * 1_000_000)");
      expect(js).toContain("parkedExpired");
      expect(js).toContain("Reject expired");
      expect(js).toContain("Parked approval expired");
      expect(js).toContain("policy_denied");
      expect(js).toContain("This check did not move money");

      const intent = {
        operationId: "console-deny-1",
        requestHash:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        protocol: "x402",
        network: LOCAL_NETWORK,
        merchantId: "127.0.0.1:8791",
        merchantOrigin: "http://127.0.0.1:8791",
        destination: "NeutralMerchant111111111111111111111111111",
        assetMint: USDC_MINT,
        amountAtomic: "2500000",
        amountUsdMicros: "2500000",
        resource: "http://127.0.0.1:8791/v1/market-snapshot"
      };
      expect((await gateway.coordinator.ensurePaymentAsset({ intent })).status).toBe(
        "approval_required"
      );
      const auth = { authorization: "Bearer console-admin" };
      const parked = await gateway.app.request(
        "/v1/executions?state=approval_required&limit=20",
        { headers: auth }
      );
      const parkedBody = (await parked.json()) as {
        executions: Array<{ operationId: string; amountUsdMicros?: string; amountAtomic: string }>;
      };
      expect(parkedBody.executions.find((row) => row.operationId === "console-deny-1")).toMatchObject({
        amountUsdMicros: "2500000",
        amountAtomic: "2500000"
      });

      const denied = await gateway.app.request("/v1/denials/console-deny-1", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ reason: "operator_denied" })
      });
      expect(denied.status).toBe(200);
      expect(await denied.json()).toMatchObject({ denied: true, funded: false });
      expect((await gateway.store.get("console-deny-1"))?.state).toBe("denied");
      expect(gateway.spend.getSpentUsdMicrosLast24h()).toBe("0");
    } finally {
      gateway.close();
    }
  });
});

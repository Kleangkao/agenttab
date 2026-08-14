import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  createGatewayRuntime,
  DEFAULT_AGENT_ID,
  loadPolicyFile,
  LOCAL_NETWORK,
  mergeAgentCredentials,
  parseAgentTokenMap,
  USDC_MINT
} from "../src/index.js";

const intentBase = {
  requestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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

describe("agent identity config", () => {
  it("parses AGENTTAB_AGENT_TOKENS and merges the single-token upgrade path", () => {
    expect(parseAgentTokenMap(undefined)).toEqual({});
    expect(parseAgentTokenMap('{"research":"r1","ops":"o1"}')).toEqual({
      research: "r1",
      ops: "o1"
    });
    expect(() => parseAgentTokenMap("{")).toThrow(/JSON object/);
    expect(() => parseAgentTokenMap('{"bad id":"x"}')).toThrow(/Invalid/);
    expect(() => parseAgentTokenMap('{"a":"same","b":"same"}')).toThrow(/unique/);

    const merged = mergeAgentCredentials({
      agentToken: "shared",
      agentId: "desk",
      agentTokens: { research: "r1" }
    });
    expect(merged.ids).toEqual(["desk", "research"]);
    expect(merged.tokens.desk).toBe("shared");
    expect(mergeAgentCredentials({ agentToken: "only" }).ids).toEqual([DEFAULT_AGENT_ID]);
  });
});

describe("per-agent attribution", () => {
  it("leaves demos unattributed when no agent token is set", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: loadPolicyFile(
        resolve(process.cwd(), "../../examples/policies/approve.local.json")
      ),
      initialUsdcAtomic: "0"
    });
    try {
      const fund = await gateway.app.request("/v1/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...intentBase, operationId: "attr-open-1" })
      });
      expect(fund.status).toBe(200);
      const body = (await (
        await gateway.app.request("/v1/executions/attr-open-1")
      ).json()) as { agentId?: string };
      expect(body.agentId).toBeUndefined();
      expect(await (await gateway.app.request("/health")).json()).toMatchObject({
        agentAuth: false,
        agentIds: []
      });
    } finally {
      gateway.close();
    }
  });

  it("stamps the single-token identity and named map identities", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791",
      policy: loadPolicyFile(
        resolve(process.cwd(), "../../examples/policies/autopay.local.json")
      ),
      adminToken: "adm",
      agentToken: "shared-agent",
      agentId: "desk",
      agentTokens: { research: "tok-research", ops: "tok-ops" },
      initialUsdcAtomic: "10000000",
      initialSolAtomic: "5000000000"
    });
    try {
      expect(await (await gateway.app.request("/health")).json()).toMatchObject({
        agentAuth: true,
        agentIds: ["desk", "ops", "research"]
      });

      const fundAs = async (operationId: string, token: string) => {
        const response = await gateway.app.request("/v1/fund", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            ...intentBase,
            operationId,
            requestHash: `sha256:${operationId.padEnd(64, "b")}`
          })
        });
        expect(response.status).toBe(200);
        return (await response.json()) as { record: { agentId?: string; state: string } };
      };

      expect((await fundAs("attr-research-1", "tok-research")).record.agentId).toBe("research");
      expect((await fundAs("attr-ops-1", "tok-ops")).record.agentId).toBe("ops");
      expect((await fundAs("attr-desk-1", "shared-agent")).record.agentId).toBe("desk");

      const asOps = await gateway.app.request("/v1/executions/attr-research-1", {
        headers: { authorization: "Bearer tok-ops" }
      });
      expect(asOps.status).toBe(404);

      const asResearch = await gateway.app.request("/v1/executions/attr-research-1", {
        headers: { authorization: "Bearer tok-research" }
      });
      expect(asResearch.status).toBe(200);
      expect(await asResearch.json()).toMatchObject({ agentId: "research" });

      const stolen = await gateway.app.request("/v1/fund", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tok-ops"
        },
        body: JSON.stringify({
          ...intentBase,
          operationId: "attr-research-1",
          requestHash: `sha256:${"attr-research-1".padEnd(64, "b")}`
        })
      });
      expect(stolen.status).toBe(409);
      expect(await stolen.json()).toMatchObject({ error: "agent_mismatch" });

      const listed = await gateway.app.request("/v1/executions?limit=20", {
        headers: { authorization: "Bearer adm" }
      });
      expect(listed.status).toBe(200);
      const listedBody = (await listed.json()) as {
        executions: Array<{ operationId: string; agentId?: string }>;
      };
      expect(listedBody.executions.find((row) => row.operationId === "attr-research-1")).toMatchObject(
        { agentId: "research" }
      );

      const spend = await gateway.app.request("/v1/spend", {
        headers: { authorization: "Bearer adm" }
      });
      expect(spend.status).toBe(200);
      expect(await spend.json()).toMatchObject({
        spentUsdMicrosLast24h: "3000",
        spentUsdMicrosLast24hByAgent: {
          research: "1000",
          ops: "1000",
          desk: "1000"
        }
      });
    } finally {
      gateway.close();
    }
  });
});

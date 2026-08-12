import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
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
});

import { describe, expect, it } from "vitest";
import { createNeutralMerchant } from "@agenttab/example-neutral-merchant";
import {
  createGatewayRuntime,
  createDemoPolicy
} from "@agenttab/gateway";
import { createRemoteAgent, purchasePaidResource } from "../src/agent.js";
import { listenApp } from "../src/listen.js";
import { createSmokePaymentScheme } from "../src/smoke-scheme.js";

const LOCAL_NETWORK = "solana:local" as const;

describe("remote agent adoption smoke", () => {
  it("buys from a neutral merchant via remote gateway HTTP only", async () => {
    const merchantApp = createNeutralMerchant({
      origin: "http://127.0.0.1",
      network: LOCAL_NETWORK,
      priceAtomic: "1000"
    });
    const merchantHttp = await listenApp(merchantApp);
    const merchantOrigin = merchantHttp.baseUrl;

    const gateway = createGatewayRuntime({
      merchantOrigin,
      policy: createDemoPolicy(merchantOrigin),
      wallet: "RemoteAgentBuyer1111111111111111111111111",
      // Force exact-deficit funding so the remote /v1/fund path is exercised.
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    const gatewayHttp = await listenApp(gateway.app);

    try {
      const agent = createRemoteAgent({
        gatewayBaseUrl: gatewayHttp.baseUrl,
        schemes: [
          {
            network: LOCAL_NETWORK,
            client: createSmokePaymentScheme()
          }
        ],
        createOperationId: () => "remote-smoke-op-1"
      });

      const result = await purchasePaidResource(
        agent,
        `${merchantOrigin}/v1/market-snapshot`,
        { method: "GET" }
      );

      expect(result.response.status).toBe(200);
      expect(result.body).toMatchObject({
        service: "neutral-market-snapshot",
        paid: true
      });
      expect(result.meta?.operationId).toBe("remote-smoke-op-1");
      expect(result.meta?.auditRecorded).toBe(true);
      expect(result.execution).toMatchObject({ state: "fulfilled" });

      const events =
        result.execution &&
        typeof result.execution === "object" &&
        "events" in result.execution
          ? (result.execution as { events: Array<{ kind: string }> }).events.map(
              (event) => event.kind
            )
          : [];
      expect(events).toContain("funding.confirmed");
      expect(events.some((kind) => kind.startsWith("payment."))).toBe(true);
      expect(events).toContain("resource.fulfilled");
    } finally {
      await gatewayHttp.close();
      await merchantHttp.close();
      gateway.close();
    }
  });
});

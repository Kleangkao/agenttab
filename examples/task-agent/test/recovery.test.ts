import { describe, expect, it } from "vitest";
import {
  WSOL_MINT,
  USDC_MINT,
  createDemoPolicy,
  createGatewayRuntime,
  type SignerBoundary,
  SimulatedSigner,
  LOCAL_NETWORK
} from "@agenttab/gateway";
import { createPriceOracle, DEFAULT_PRICE_USD_MICROS_FOR_SOL } from "../src/price-oracle.js";
import { runWalletValuationTask } from "../src/workflow.js";
import {
  createAgentTabClient,
  createGatewayAuditRecorder,
  createLocalSmokeScheme
} from "@agenttab/fetch";

const GATEWAY_ORIGIN = "http://gateway.local";
const ORACLE_ORIGIN = "http://oracle.local";
const PRICE_URL = `${ORACLE_ORIGIN}/v1/price?asset=SOL`;

function createDispatchFetch(
  gateway: ReturnType<typeof createGatewayRuntime>,
  oracle: ReturnType<typeof createPriceOracle>
) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = `${url.pathname}${url.search}`;
    const forwardedInit: RequestInit = {
      method: request.method,
      headers: request.headers,
    };
    if (!["GET", "HEAD"].includes(request.method.toUpperCase()) && request.body) {
      forwardedInit.body = await request.clone().text();
    }
    if (url.origin === GATEWAY_ORIGIN) {
      return gateway.app.request(path, forwardedInit);
    }
    if (url.origin === ORACLE_ORIGIN) {
      return oracle.request(path, forwardedInit);
    }
    throw new Error(`Unexpected URL origin: ${url.origin}`);
  };
}

describe("task-agent recovery", () => {
  it("completes when the wallet can already fund the oracle step (already_funded path)", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: ORACLE_ORIGIN,
      policy: createDemoPolicy(ORACLE_ORIGIN),
      initialUsdcAtomic: "2000000",
      initialSolAtomic: "5000000000"
    });
    const oracle = createPriceOracle({ origin: ORACLE_ORIGIN });
    try {
      const fetchImpl = createDispatchFetch(gateway, oracle);
      const taskId = "task-agent-already-funded-1";
      const taskContext = {
        purpose: "Estimate my wallet's USD value",
        stepLabel: "Paid price oracle step"
      };

      const result = await runWalletValuationTask({
        gatewayBaseUrl: GATEWAY_ORIGIN,
        priceOracleOrigin: ORACLE_ORIGIN,
        taskId,
        taskContext,
        autoApprove: true,
        fetchImpl,
        gatewayFetchImpl: fetchImpl
      });

      // Wallet balances are re-read after the paid oracle step.
      const usdcAfter = gateway.balances.get(USDC_MINT)?.balanceAtomic ?? "0";
      const solAfter = gateway.balances.get(WSOL_MINT)?.balanceAtomic ?? "0";
      const expectedUsdcMicros = BigInt(usdcAfter);
      const expectedSolUsdMicros =
        (BigInt(solAfter) * BigInt(DEFAULT_PRICE_USD_MICROS_FOR_SOL)) / 1_000_000_000n;
      const expectedTotal = expectedUsdcMicros + expectedSolUsdMicros;

      expect(result.taskId).toBe(taskId);
      expect(result.valuation.usdcUsdMicros).toBe(expectedUsdcMicros.toString());
      expect(result.valuation.solUsdMicros).toBe(expectedSolUsdMicros.toString());
      expect(result.valuation.totalUsdMicros).toBe(expectedTotal.toString());

      expect(result.paid).toHaveLength(1);
      expect(result.paid[0]?.resourceUrl).toBe(PRICE_URL);
      expect(BigInt(result.paid[0]?.priceUsdMicros)).toBe(BigInt(DEFAULT_PRICE_USD_MICROS_FOR_SOL));

      // No DFlow orders needed when USDC is sufficient.
      expect(gateway.dflow.orders).toHaveLength(0);
    } finally {
      gateway.close();
    }
  });

  it("uses DFlow exact-deficit funding when USDC is insufficient (funded path)", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: ORACLE_ORIGIN,
      policy: createDemoPolicy(ORACLE_ORIGIN),
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000"
    });
    const oracle = createPriceOracle({ origin: ORACLE_ORIGIN });
    try {
      const fetchImpl = createDispatchFetch(gateway, oracle);
      const taskId = "task-agent-deficit-1";
      const taskContext = {
        purpose: "Estimate my wallet's USD value",
        stepLabel: "Paid price oracle step"
      };

      const result = await runWalletValuationTask({
        gatewayBaseUrl: GATEWAY_ORIGIN,
        priceOracleOrigin: ORACLE_ORIGIN,
        taskId,
        taskContext,
        autoApprove: true,
        fetchImpl,
        gatewayFetchImpl: fetchImpl
      });

      // Wallet balances are re-read after the paid oracle step.
      const usdcAfter = gateway.balances.get(USDC_MINT)?.balanceAtomic ?? "0";
      const solAfter = gateway.balances.get(WSOL_MINT)?.balanceAtomic ?? "0";
      const expectedUsdcMicros = BigInt(usdcAfter);
      const expectedSolUsdMicros =
        (BigInt(solAfter) * BigInt(DEFAULT_PRICE_USD_MICROS_FOR_SOL)) / 1_000_000_000n;
      const expectedTotal = expectedUsdcMicros + expectedSolUsdMicros;

      expect(result.valuation.totalUsdMicros).toBe(expectedTotal.toString());
      expect(result.paid).toHaveLength(1);

      // Deficit funding should require at least one DFlow order.
      expect(gateway.dflow.orders.length).toBeGreaterThanOrEqual(1);
    } finally {
      gateway.close();
    }
  });

  it("parks for operator approval and continues after approval (approval_required recovery)", async () => {
    const policy = createDemoPolicy(ORACLE_ORIGIN);
    policy.mode = "approve";
    const gateway = createGatewayRuntime({
      merchantOrigin: ORACLE_ORIGIN,
      policy,
      initialUsdcAtomic: "5000000",
      initialSolAtomic: "5000000000"
    });
    const oracle = createPriceOracle({ origin: ORACLE_ORIGIN });
    try {
      const fetchImpl = createDispatchFetch(gateway, oracle);
      const taskId = "task-agent-approve-1";
      const taskContext = {
        purpose: "Estimate my wallet's USD value",
        stepLabel: "Paid price oracle step"
      };

      const resultPromise = runWalletValuationTask({
        gatewayBaseUrl: GATEWAY_ORIGIN,
        priceOracleOrigin: ORACLE_ORIGIN,
        taskId,
        taskContext,
        autoApprove: false,
        fetchImpl,
        gatewayFetchImpl: fetchImpl
      });

      // Wait for the parked approval record, then approve it.
      let operationId: string | undefined;
      for (let i = 0; i < 50; i++) {
        const parked = await gateway.store.listRecent({
          state: "approval_required",
          taskId,
          limit: 10
        });
        operationId = parked[0]?.operationId;
        if (operationId) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(operationId).toBeTruthy();

      const approval = await gateway.app.request(`/v1/approvals/${encodeURIComponent(operationId!)}`, {
        method: "POST",
        body: "{}"
      });
      expect(approval.status).toBe(200);

      const result = await resultPromise;
      expect(result.taskId).toBe(taskId);
      expect(gateway.dflow.orders).toHaveLength(0);
    } finally {
      gateway.close();
    }
  });

  it("terminates honestly when the operator denies the parked payment (deny recovery)", async () => {
    const policy = createDemoPolicy(ORACLE_ORIGIN);
    policy.mode = "approve";
    const gateway = createGatewayRuntime({
      merchantOrigin: ORACLE_ORIGIN,
      policy,
      initialUsdcAtomic: "5000000",
      initialSolAtomic: "5000000000"
    });
    const oracle = createPriceOracle({ origin: ORACLE_ORIGIN });
    try {
      const fetchImpl = createDispatchFetch(gateway, oracle);
      const taskId = "task-agent-deny-1";
      const taskContext = {
        purpose: "Estimate my wallet's USD value",
        stepLabel: "Paid price oracle step"
      };

      const resultPromise = runWalletValuationTask({
        gatewayBaseUrl: GATEWAY_ORIGIN,
        priceOracleOrigin: ORACLE_ORIGIN,
        taskId,
        taskContext,
        autoApprove: false,
        fetchImpl,
        gatewayFetchImpl: fetchImpl
      });

      let operationId: string | undefined;
      for (let i = 0; i < 50; i++) {
        const parked = await gateway.store.listRecent({
          state: "approval_required",
          taskId,
          limit: 10
        });
        operationId = parked[0]?.operationId;
        if (operationId) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(operationId).toBeTruthy();

      const denial = await gateway.app.request(`/v1/denials/${encodeURIComponent(operationId!)}`, {
        method: "POST"
      });
      expect(denial.status).toBe(200);

      await expect(resultPromise).rejects.toThrow(/denied/i);
      const record = await gateway.store.get(operationId!);
      expect(record?.state).toBe("denied");
      expect(gateway.dflow.orders).toHaveLength(0);
    } finally {
      gateway.close();
    }
  });

  it("recovers from a signer interruption (interrupted funding then retry)", async () => {
    const innerSigner = new SimulatedSigner();
    let signCalls = 0;
    const signer: SignerBoundary = {
      async signFundingTransaction(plan) {
        signCalls += 1;
        if (signCalls === 1) {
          throw new Error("simulated signer failure");
        }
        return innerSigner.signFundingTransaction(plan);
      }
    };

    const gateway = createGatewayRuntime({
      merchantOrigin: ORACLE_ORIGIN,
      policy: createDemoPolicy(ORACLE_ORIGIN),
      initialUsdcAtomic: "0",
      initialSolAtomic: "5000000000",
      signer
    });
    const oracle = createPriceOracle({ origin: ORACLE_ORIGIN });
    try {
      const fetchImpl = createDispatchFetch(gateway, oracle);
      const taskId = "task-agent-interrupt-1";
      const taskContext = {
        purpose: "Estimate my wallet's USD value",
        stepLabel: "Paid price oracle step"
      };

      const result = await runWalletValuationTask({
        gatewayBaseUrl: GATEWAY_ORIGIN,
        priceOracleOrigin: ORACLE_ORIGIN,
        taskId,
        taskContext,
        autoApprove: true,
        fetchImpl,
        gatewayFetchImpl: fetchImpl
      });

      expect(result.taskId).toBe(taskId);
      expect(signCalls).toBeGreaterThanOrEqual(2);
      expect(gateway.dflow.orders.length).toBeGreaterThanOrEqual(1);
    } finally {
      gateway.close();
    }
  });

  it("does not cross-reuse another task's payment when taskId differs (task-scoped isolation)", async () => {
    const policy = createDemoPolicy(ORACLE_ORIGIN);
    policy.mode = "approve";
    const gateway = createGatewayRuntime({
      merchantOrigin: ORACLE_ORIGIN,
      policy,
      initialUsdcAtomic: "5000000",
      initialSolAtomic: "5000000000"
    });
    const oracle = createPriceOracle({ origin: ORACLE_ORIGIN });
    try {
      const fetchImpl = createDispatchFetch(gateway, oracle);

      const taskId1 = "task-agent-isolation-1";
      const taskId2 = "task-agent-isolation-2";
      const taskContext = {
        purpose: "Estimate my wallet's USD value",
        stepLabel: "Paid price oracle step"
      };

      const p1 = runWalletValuationTask({
        gatewayBaseUrl: GATEWAY_ORIGIN,
        priceOracleOrigin: ORACLE_ORIGIN,
        taskId: taskId1,
        taskContext,
        autoApprove: false,
        fetchImpl,
        gatewayFetchImpl: fetchImpl
      });
      // Ensure task 1 is parked before starting task 2.
      let op1: string | undefined;
      for (let i = 0; i < 50; i++) {
        const parked = await gateway.store.listRecent({
          state: "approval_required",
          taskId: taskId1,
          limit: 10
        });
        op1 = parked[0]?.operationId;
        if (op1) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(op1).toBeTruthy();

      const p2 = runWalletValuationTask({
        gatewayBaseUrl: GATEWAY_ORIGIN,
        priceOracleOrigin: ORACLE_ORIGIN,
        taskId: taskId2,
        taskContext,
        autoApprove: false,
        fetchImpl,
        gatewayFetchImpl: fetchImpl
      });

      let op2: string | undefined;
      for (let i = 0; i < 50; i++) {
        const parked = await gateway.store.listRecent({
          state: "approval_required",
          taskId: taskId2,
          limit: 10
        });
        op2 = parked[0]?.operationId;
        if (op2) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(op2).toBeTruthy();
      expect(op2).not.toBe(op1);

      const a1 = await gateway.app.request(`/v1/approvals/${encodeURIComponent(op1!)}`, { method: "POST" });
      expect(a1.status).toBe(200);
      const a2 = await gateway.app.request(`/v1/approvals/${encodeURIComponent(op2!)}`, { method: "POST" });
      expect(a2.status).toBe(200);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.taskId).toBe(taskId1);
      expect(r2.taskId).toBe(taskId2);

      const rec1 = await gateway.store.get(op1!);
      const rec2 = await gateway.store.get(op2!);
      expect(rec1?.state).toBe("fulfilled");
      expect(rec2?.state).toBe("fulfilled");
    } finally {
      gateway.close();
    }
  });

  it("resumes on paid without forging sha256:local fulfillment", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: ORACLE_ORIGIN,
      policy: createDemoPolicy(ORACLE_ORIGIN),
      initialUsdcAtomic: "2000000",
      initialSolAtomic: "5000000000"
    });
    const oracle = createPriceOracle({ origin: ORACLE_ORIGIN });
    let previousFetch: typeof fetch | undefined;
    try {
      const fetchImpl = createDispatchFetch(gateway, oracle);
      previousFetch = (globalThis as any).fetch;
      // The gateway's /resume handler uses the global fetch, so in-process tests
      // must route those requests through our dispatch shim.
      (globalThis as any).fetch = fetchImpl;

      // Custom audit recorder: record the payment, but intentionally skip
      // recording fulfillment so the execution remains in `paid`.
      const baseAudit = createGatewayAuditRecorder({
        baseUrl: GATEWAY_ORIGIN,
        fetchImpl
      });

      const audit = {
        recordPayment: baseAudit.recordPayment,
        recordFulfillment: async () => {
          /* Simulate agent crash after payment_submitted. */
        },
        getExecution: baseAudit.getExecution
      };

      const agent = createAgentTabClient({
        gatewayBaseUrl: GATEWAY_ORIGIN,
        schemes: [{ network: LOCAL_NETWORK, client: createLocalSmokeScheme() }],
        recordAudit: true,
        audit,
        fetchImpl,
        gatewayFetchImpl: fetchImpl,
        getUsdValueMicros: ({ assetMint, amountAtomic }) =>
          assetMint === USDC_MINT ? amountAtomic : undefined
      });

      const response = await agent.fetch(PRICE_URL, { method: "GET" });
      expect(response.ok).toBe(true);
      const meta = agent.getMeta(response);
      expect(meta).toBeDefined();
      const operationId = meta!.operationId;

      const paidRecord = await gateway.store.get(operationId);
      expect(paidRecord?.state).toBe("paid");

      const resumed = await gateway.app.request(
        `/v1/executions/${encodeURIComponent(operationId)}/resume`,
        { method: "POST" }
      );
      expect(resumed.status).toBe(200);

      const fulfilledRecord = await gateway.store.get(operationId);
      const fulfilledEvent = fulfilledRecord?.events.find((e) => e.kind === "resource.fulfilled");
      const responseHash = fulfilledEvent?.details?.responseHash;

      expect(fulfilledRecord?.state).toBe("fulfilled");
      expect(typeof responseHash).toBe("string");
      expect(responseHash).not.toBe("sha256:local");
    } finally {
      // Restore global fetch for other test files.
      (globalThis as any).fetch = previousFetch;
      gateway.close();
    }
  });
});


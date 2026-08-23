import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import {
  createGatewayRuntime,
  loadPolicyFile,
  LOCAL_NETWORK,
  USDC_MINT,
  WSOL_MINT
} from "@agenttab/gateway";
import { MERCHANT_PAY_TO } from "@agenttab/example-neutral-merchant";
import {
  resetDemoWallet,
  seedNowIfEmpty,
  startAutoReseed
} from "../src/stack-seed.js";

const merchantOrigin = "http://127.0.0.1:8791";

function stackGateway() {
  const policy = {
    ...loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    ),
    allowedMerchantOrigins: [merchantOrigin]
  };
  return createGatewayRuntime({
    dbPath: ":memory:",
    merchantOrigin,
    policy,
    initialUsdcAtomic: "0",
    initialSolAtomic: "5000000000",
    wallet: "StackSeedBuyer111111111111111111111111111"
  });
}

describe("stack seed / reseed", () => {
  it("parks one Now card and no-ops while it remains approval_required", async () => {
    const gateway = stackGateway();
    try {
      const first = await seedNowIfEmpty({ gateway, merchantOrigin });
      expect(first?.created).toBe(true);
      expect(first?.operationId).toMatch(/^demo-now-/);

      const second = await seedNowIfEmpty({ gateway, merchantOrigin });
      expect(second?.created).toBe(false);
      expect(second?.operationId).toBe(first?.operationId);
    } finally {
      gateway.close();
    }
  });

  it("resets wallet + policy before parking a fresh card", async () => {
    const gateway = stackGateway();
    try {
      const seedPolicy = gateway.policies.get();
      await seedNowIfEmpty({ gateway, merchantOrigin });
      const parked = await gateway.store.listRecent({
        state: "approval_required",
        limit: 1
      });
      expect(parked[0]).toBeDefined();

      await gateway.app.request(`/v1/approvals/${parked[0]!.operationId}`, {
        method: "POST",
        body: "{}"
      });
      expect((await gateway.store.get(parked[0]!.operationId))?.state).toBe("funded");

      gateway.balances.applyDelta(USDC_MINT, 1_000_000n);
      gateway.policies.set({
        ...seedPolicy,
        mode: "autopay",
        allowedMerchantOrigins: ["http://evil.example"]
      });

      const again = await seedNowIfEmpty({
        gateway,
        merchantOrigin,
        resetDemoState: true,
        seedPolicy,
        initialUsdcAtomic: "0",
        initialSolAtomic: "5000000000"
      });
      expect(again?.created).toBe(true);
      expect(gateway.policies.get().mode).toBe(seedPolicy.mode);
      expect(gateway.policies.get().allowedMerchantOrigins).toEqual([merchantOrigin]);
      expect(gateway.balances.get(USDC_MINT)?.balanceAtomic).toBe("0");
      expect(gateway.balances.get(WSOL_MINT)?.balanceAtomic).toBe("5000000000");
    } finally {
      gateway.close();
    }
  });

  it("resetDemoWallet is a no-op without setBalance", () => {
    const gateway = stackGateway();
    try {
      const original = gateway.balances.get(USDC_MINT)?.balanceAtomic;
      resetDemoWallet(
        {
          ...gateway,
          balances: { list: () => [], get: () => undefined, applyDelta: () => undefined }
        } as never,
        { initialUsdcAtomic: "0", initialSolAtomic: "1" }
      );
      expect(gateway.balances.get(USDC_MINT)?.balanceAtomic).toBe(original);
    } finally {
      gateway.close();
    }
  });

  it("startAutoReseed only announces newly created cards", async () => {
    vi.useFakeTimers();
    const gateway = stackGateway();
    const seeded: string[] = [];
    try {
      const loop = startAutoReseed({
        enabled: true,
        intervalMs: 1000,
        seed: () =>
          seedNowIfEmpty({
            gateway,
            merchantOrigin,
            resetDemoState: true,
            seedPolicy: gateway.policies.get()
          }),
        onSeeded: (id) => seeded.push(id)
      });

      await vi.advanceTimersByTimeAsync(1000);
      expect(seeded).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(3000);
      expect(seeded).toHaveLength(1);

      const id = seeded[0]!;
      await gateway.app.request(`/v1/approvals/${id}`, { method: "POST", body: "{}" });
      await vi.advanceTimersByTimeAsync(1000);
      expect(seeded).toHaveLength(2);
      expect(seeded[1]).not.toBe(id);

      loop.stop();
    } finally {
      vi.useRealTimers();
      gateway.close();
    }
  });

  it("keeps merchant destination constant for seeded intents", async () => {
    const gateway = stackGateway();
    try {
      const seeded = await seedNowIfEmpty({ gateway, merchantOrigin });
      const record = await gateway.store.get(seeded!.operationId);
      expect(record?.intent.destination).toBe(MERCHANT_PAY_TO);
      expect(record?.intent.network).toBe(LOCAL_NETWORK);
    } finally {
      gateway.close();
    }
  });
});

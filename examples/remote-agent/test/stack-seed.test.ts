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
  applyDemoScenario,
  claimDemoCard,
  clearParkedApprovals,
  resetDemoWallet,
  seedNowIfEmpty,
  startAutoReseed,
  topupDemoUsdc
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

  it("applyDemoScenario switches wallet amounts and parks a new card", async () => {
    const gateway = stackGateway();
    try {
      await seedNowIfEmpty({ gateway, merchantOrigin, resetDemoState: true });
      const empty = await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "empty",
        seedPolicy: gateway.policies.get()
      });
      expect(empty.created).toBe(true);
      expect(gateway.balances.get(USDC_MINT)?.balanceAtomic).toBe("0");

      const partial = await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "partial",
        seedPolicy: gateway.policies.get()
      });
      expect(partial.created).toBe(true);
      expect(gateway.balances.get(USDC_MINT)?.balanceAtomic).toBe("2600000");
      expect(partial.operationId).not.toBe(empty.operationId);
    } finally {
      gateway.close();
    }
  });

  it("derives the DFlow deficit from the selected request and wallet preset", async () => {
    const gateway = stackGateway();
    try {
      const seeded = await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "partial",
        request: "price-check",
        seedPolicy: gateway.policies.get()
      });
      const before = await gateway.store.get(seeded.operationId);
      expect(before?.intent.amountAtomic).toBe("1250000");
      expect(before?.intent.taskId).toMatch(/^price-check-/);
      expect(gateway.balances.get(USDC_MINT)?.balanceAtomic).toBe("750000");

      await gateway.app.request(`/v1/approvals/${seeded.operationId}`, {
        method: "POST",
        body: "{}"
      });
      const funded = await gateway.store.get(seeded.operationId);
      expect(
        funded?.events.find((event) => event.kind === "funding.submitted")?.details
          ?.deficitAtomic
      ).toBe("500000");
    } finally {
      gateway.close();
    }
  });

  it("skips DFlow when the selected wallet already covers the request", async () => {
    const gateway = stackGateway();
    try {
      const seeded = await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "funded",
        request: "portfolio-refresh",
        seedPolicy: gateway.policies.get()
      });
      expect(gateway.balances.get(USDC_MINT)?.balanceAtomic).toBe("5000000");

      await gateway.app.request(`/v1/approvals/${seeded.operationId}`, {
        method: "POST",
        body: "{}"
      });
      const funded = await gateway.store.get(seeded.operationId);
      expect(funded?.events.some((event) => event.kind === "funding.not_required")).toBe(
        true
      );
      expect(funded?.events.some((event) => event.kind === "funding.submitted")).toBe(
        false
      );
    } finally {
      gateway.close();
    }
  });

  it("one visitor's scenario reset leaves another visitor's card alone", async () => {
    const gateway = stackGateway();
    try {
      const first = await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "partial",
        sessionId: "session-aaaaaaaa",
        seedPolicy: gateway.policies.get()
      });
      const second = await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "empty",
        sessionId: "session-bbbbbbbb",
        seedPolicy: gateway.policies.get()
      });

      expect(second.operationId).not.toBe(first.operationId);
      expect((await gateway.store.get(first.operationId))?.state).toBe(
        "approval_required"
      );
      expect((await gateway.store.get(second.operationId))?.state).toBe(
        "approval_required"
      );

      // The first visitor can still finish their own loop.
      await gateway.app.request(`/v1/approvals/${first.operationId}`, {
        method: "POST",
        body: "{}"
      });
      expect((await gateway.store.get(first.operationId))?.state).toBe("funded");
    } finally {
      gateway.close();
    }
  });

  it("claiming a card restores the wallet its own scenario asked for", async () => {
    const gateway = stackGateway();
    try {
      const mine = await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "partial",
        sessionId: "session-aaaaaaaa",
        seedPolicy: gateway.policies.get()
      });
      // Another visitor rewrites the shared mock wallet.
      await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "funded",
        sessionId: "session-bbbbbbbb",
        seedPolicy: gateway.policies.get()
      });
      expect(gateway.balances.get(USDC_MINT)?.balanceAtomic).toBe("4000000");

      expect(
        claimDemoCard(gateway, {
          operationId: mine.operationId,
          sessionId: "session-bbbbbbbb"
        })
      ).toBe(false);
      expect(
        claimDemoCard(gateway, {
          operationId: mine.operationId,
          sessionId: "session-aaaaaaaa"
        })
      ).toBe(true);
      expect(gateway.balances.get(USDC_MINT)?.balanceAtomic).toBe("2600000");

      await gateway.app.request(`/v1/approvals/${mine.operationId}`, {
        method: "POST",
        body: "{}"
      });
      const funded = await gateway.store.get(mine.operationId);
      expect(
        funded?.events.find((event) => event.kind === "funding.submitted")?.details
          ?.deficitAtomic
      ).toBe("1400000");
    } finally {
      gateway.close();
    }
  });

  it("clears an abandoned card once it is past the grace window", async () => {
    const gateway = stackGateway();
    try {
      const stale = await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "partial",
        sessionId: "session-aaaaaaaa",
        seedPolicy: gateway.policies.get()
      });
      const cleared = await clearParkedApprovals(gateway, {
        sessionId: "session-bbbbbbbb",
        graceMs: 0
      });
      expect(cleared).toBe(1);
      expect((await gateway.store.get(stale.operationId))?.state).toBe("denied");
    } finally {
      gateway.close();
    }
  });

  it("clears every parked card when no session is given", async () => {
    const gateway = stackGateway();
    try {
      const held = await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "partial",
        sessionId: "session-aaaaaaaa",
        seedPolicy: gateway.policies.get()
      });
      expect(await clearParkedApprovals(gateway)).toBe(1);
      expect((await gateway.store.get(held.operationId))?.state).toBe("denied");
    } finally {
      gateway.close();
    }
  });

  it("topupDemoUsdc adds USDC and re-parks", async () => {
    const gateway = stackGateway();
    try {
      await applyDemoScenario({
        gateway,
        merchantOrigin,
        scenario: "empty",
        seedPolicy: gateway.policies.get()
      });
      const topped = await topupDemoUsdc({
        gateway,
        merchantOrigin,
        usdcAtomic: "1000000",
        seedPolicy: gateway.policies.get()
      });
      expect(topped.balanceAtomic).toBe("1000000");
      expect(gateway.balances.get(USDC_MINT)?.balanceAtomic).toBe("1000000");
      expect(topped.created).toBe(true);
    } finally {
      gateway.close();
    }
  });
});

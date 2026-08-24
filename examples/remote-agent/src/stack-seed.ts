import { createHash, randomUUID } from "node:crypto";
import type { createGatewayRuntime } from "@agenttab/gateway";
import { LOCAL_NETWORK, USDC_MINT, WSOL_MINT } from "@agenttab/gateway";
import { MERCHANT_PAY_TO } from "@agenttab/example-neutral-merchant";

export type StackGateway = ReturnType<typeof createGatewayRuntime>;

/**
 * The demo wallet starts holding part of the ask so the Now card shows a real
 * deficit (holds $2.60, merchant asks $4.00, DFlow buys $1.40). Starting at 0
 * makes the deficit equal the ask, which hides the exact-deficit claim.
 */
export const DEMO_SEED_USDC_ATOMIC = "2600000";
export const DEMO_ASK_USDC_ATOMIC = "4000000";

export type DemoScenarioId = "partial" | "empty" | "funded";

export const DEMO_SCENARIOS: Record<
  DemoScenarioId,
  {
    label: string;
    initialUsdcAtomic: string;
    amountAtomic: string;
    amountUsdMicros: string;
  }
> = {
  partial: {
    label: "Partial USDC",
    initialUsdcAtomic: DEMO_SEED_USDC_ATOMIC,
    amountAtomic: DEMO_ASK_USDC_ATOMIC,
    amountUsdMicros: DEMO_ASK_USDC_ATOMIC
  },
  empty: {
    label: "Empty USDC",
    initialUsdcAtomic: "0",
    amountAtomic: DEMO_ASK_USDC_ATOMIC,
    amountUsdMicros: DEMO_ASK_USDC_ATOMIC
  },
  funded: {
    label: "Already funded",
    initialUsdcAtomic: "5000000",
    amountAtomic: DEMO_ASK_USDC_ATOMIC,
    amountUsdMicros: DEMO_ASK_USDC_ATOMIC
  }
};

export type SeedNowResult = {
  operationId: string;
  created: boolean;
  scenario?: DemoScenarioId;
};

export type SeedNowInput = {
  gateway: StackGateway;
  merchantOrigin: string;
  amountAtomic?: string;
  amountUsdMicros?: string;
  initialUsdcAtomic?: string;
  initialSolAtomic?: string;
  /** When true, restore seed policy + demo wallet before parking a new card. */
  resetDemoState?: boolean;
  seedPolicy?: ReturnType<StackGateway["policies"]["get"]>;
};

/**
 * Park one approval_required Now card when none is live.
 * Used by local `demo:stack` and the public demo host.
 */
export async function seedNowIfEmpty(
  input: SeedNowInput
): Promise<SeedNowResult | undefined> {
  const parked = await input.gateway.store.listRecent({
    state: "approval_required",
    limit: 1
  });
  if (parked[0]) {
    return { operationId: parked[0].operationId, created: false };
  }

  if (input.resetDemoState) {
    resetDemoWallet(input.gateway, {
      initialUsdcAtomic: input.initialUsdcAtomic ?? DEMO_SEED_USDC_ATOMIC,
      initialSolAtomic: input.initialSolAtomic ?? "5000000000"
    });
    if (input.seedPolicy) {
      input.gateway.policies.set(input.seedPolicy);
    }
  }

  return parkDemoCard(input);
}

async function parkDemoCard(input: SeedNowInput): Promise<SeedNowResult> {
  const operationId = `demo-now-${randomUUID()}`;
  const taskId = `wallet-valuation-${randomUUID()}`;
  const requestHash = `sha256:${createHash("sha256").update(operationId).digest("hex")}`;
  const resource = `${input.merchantOrigin}/v1/market-snapshot`;
  const amountAtomic = input.amountAtomic ?? DEMO_ASK_USDC_ATOMIC;
  const amountUsdMicros = input.amountUsdMicros ?? amountAtomic;
  const result = await input.gateway.coordinator.ensurePaymentAsset({
    intent: {
      operationId,
      requestHash,
      protocol: "x402",
      network: LOCAL_NETWORK,
      merchantId: new URL(input.merchantOrigin).host,
      merchantOrigin: input.merchantOrigin,
      destination: MERCHANT_PAY_TO,
      assetMint: USDC_MINT,
      amountAtomic,
      amountUsdMicros,
      resource,
      taskId,
      taskContext: {
        purpose: "Estimate my wallet's USD value",
        stepLabel: "Paid market snapshot step"
      },
      resourceMethod: "GET"
    }
  });
  if (result.status !== "approval_required") {
    throw new Error(`stack seed expected approval_required, got ${result.status}`);
  }
  return { operationId, created: true };
}

/** Clear live parked cards so a new scenario can take the Now slot. */
export async function clearParkedApprovals(gateway: StackGateway): Promise<number> {
  const parked = await gateway.store.listRecent({
    state: "approval_required",
    limit: 50
  });
  let cleared = 0;
  for (const row of parked) {
    const res = await gateway.app.request(
      `/v1/denials/${encodeURIComponent(row.operationId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "demo_scenario_reset" })
      }
    );
    if (res.ok) cleared += 1;
  }
  return cleared;
}

export async function applyDemoScenario(input: {
  gateway: StackGateway;
  merchantOrigin: string;
  scenario: DemoScenarioId;
  seedPolicy?: ReturnType<StackGateway["policies"]["get"]>;
  initialSolAtomic?: string;
}): Promise<SeedNowResult> {
  const spec = DEMO_SCENARIOS[input.scenario];
  if (!spec) {
    throw new Error(`unknown_scenario:${input.scenario}`);
  }
  await clearParkedApprovals(input.gateway);
  resetDemoWallet(input.gateway, {
    initialUsdcAtomic: spec.initialUsdcAtomic,
    initialSolAtomic: input.initialSolAtomic ?? "5000000000"
  });
  if (input.seedPolicy) {
    input.gateway.policies.set(input.seedPolicy);
  }
  const seeded = await parkDemoCard({
    gateway: input.gateway,
    merchantOrigin: input.merchantOrigin,
    amountAtomic: spec.amountAtomic,
    amountUsdMicros: spec.amountUsdMicros,
    initialUsdcAtomic: spec.initialUsdcAtomic,
    initialSolAtomic: input.initialSolAtomic ?? "5000000000"
  });
  return { ...seeded, scenario: input.scenario };
}

/** Add USDC to the mock wallet and re-park a Now card with the same ask. */
export async function topupDemoUsdc(input: {
  gateway: StackGateway;
  merchantOrigin: string;
  usdcAtomic: string;
  seedPolicy?: ReturnType<StackGateway["policies"]["get"]>;
  amountAtomic?: string;
  initialSolAtomic?: string;
}): Promise<SeedNowResult & { balanceAtomic: string }> {
  const current = input.gateway.balances.get(USDC_MINT)?.balanceAtomic ?? "0";
  const next = (BigInt(current) + BigInt(input.usdcAtomic)).toString();
  await clearParkedApprovals(input.gateway);
  resetDemoWallet(input.gateway, {
    initialUsdcAtomic: next,
    initialSolAtomic: input.initialSolAtomic ?? "5000000000"
  });
  if (input.seedPolicy) {
    input.gateway.policies.set(input.seedPolicy);
  }
  const seeded = await parkDemoCard({
    gateway: input.gateway,
    merchantOrigin: input.merchantOrigin,
    amountAtomic: input.amountAtomic ?? DEMO_ASK_USDC_ATOMIC,
    amountUsdMicros: input.amountAtomic ?? DEMO_ASK_USDC_ATOMIC,
    initialUsdcAtomic: next
  });
  return {
    ...seeded,
    balanceAtomic: next
  };
}

export function resetDemoWallet(
  gateway: StackGateway,
  amounts: { initialUsdcAtomic: string; initialSolAtomic: string }
): void {
  const balances = gateway.balances as {
    setBalance?: (mint: string, balanceAtomic: string) => void;
  };
  if (typeof balances.setBalance !== "function") return;
  balances.setBalance(USDC_MINT, amounts.initialUsdcAtomic);
  balances.setBalance(WSOL_MINT, amounts.initialSolAtomic);
}

/** Start a quiet interval that re-parks a Now card after visitors finish. */
export function startAutoReseed(input: {
  enabled: boolean;
  intervalMs: number;
  seed: () => Promise<SeedNowResult | undefined>;
  onSeeded?: (operationId: string) => void;
  onError?: (error: unknown) => void;
}): { stop: () => void } {
  if (!input.enabled || input.intervalMs <= 0) {
    return { stop: () => undefined };
  }
  const timer = setInterval(() => {
    void input
      .seed()
      .then((result) => {
        if (result?.created) input.onSeeded?.(result.operationId);
      })
      .catch((error) => input.onError?.(error));
  }, input.intervalMs);
  return { stop: () => clearInterval(timer) };
}

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

export type SeedNowResult = {
  operationId: string;
  created: boolean;
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

  const operationId = `demo-now-${randomUUID()}`;
  const taskId = `wallet-valuation-${randomUUID()}`;
  const requestHash = `sha256:${createHash("sha256").update(operationId).digest("hex")}`;
  const resource = `${input.merchantOrigin}/v1/market-snapshot`;
  const amountAtomic = input.amountAtomic ?? "4000000";
  const amountUsdMicros = input.amountUsdMicros ?? amountAtomic;
  const taskContext = {
    purpose: "Estimate my wallet's USD value",
    stepLabel: "Paid market snapshot step"
  };
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
      taskContext,
      resourceMethod: "GET"
    }
  });
  if (result.status !== "approval_required") {
    throw new Error(`stack seed expected approval_required, got ${result.status}`);
  }
  return { operationId, created: true };
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
  timer.unref?.();
  return {
    stop: () => clearInterval(timer)
  };
}

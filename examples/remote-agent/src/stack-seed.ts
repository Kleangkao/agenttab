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
export type DemoRequestId = "valuation" | "price-check" | "portfolio-refresh";

export const DEMO_REQUESTS: Record<
  DemoRequestId,
  {
    label: string;
    purpose: string;
    stepLabel: string;
    amountAtomic: string;
    amountUsdMicros: string;
    partialUsdcAtomic: string;
  }
> = {
  valuation: {
    label: "Value my wallet",
    purpose: "Estimate my wallet's USD value",
    stepLabel: "Paid market snapshot",
    amountAtomic: DEMO_ASK_USDC_ATOMIC,
    amountUsdMicros: DEMO_ASK_USDC_ATOMIC,
    partialUsdcAtomic: DEMO_SEED_USDC_ATOMIC
  },
  "price-check": {
    label: "Check SOL's live mark",
    purpose: "Check SOL's live market price",
    stepLabel: "Paid market snapshot",
    amountAtomic: "1250000",
    amountUsdMicros: "1250000",
    partialUsdcAtomic: "750000"
  },
  "portfolio-refresh": {
    label: "Refresh my portfolio",
    purpose: "Refresh my portfolio with current market data",
    stepLabel: "Paid market snapshot",
    amountAtomic: "5000000",
    amountUsdMicros: "5000000",
    partialUsdcAtomic: "4000000"
  }
};

export const DEMO_SCENARIOS: Record<
  DemoScenarioId,
  {
    label: string;
  }
> = {
  partial: {
    label: "Wallet is short"
  },
  empty: {
    label: "Wallet has no USDC"
  },
  funded: {
    label: "Wallet already covers it"
  }
};

/**
 * How long one visitor's parked card is protected from another visitor's
 * scenario reset. Long enough to read the card and click through, short enough
 * that an abandoned card does not block the next person.
 */
export const DEMO_SESSION_GRACE_MS = 90_000;

/**
 * operationId -> the browser session that seeded it. In-process only: a restart
 * reseeds anyway, and nothing downstream depends on it.
 */
const demoCardOwners = new Map<
  string,
  { sessionId: string; at: number; usdcAtomic: string }
>();

function rememberOwner(
  operationId: string,
  sessionId: string | undefined,
  usdcAtomic: string | undefined
): void {
  if (!sessionId) return;
  demoCardOwners.set(operationId, {
    sessionId,
    at: Date.now(),
    usdcAtomic: usdcAtomic ?? DEMO_SEED_USDC_ATOMIC
  });
}

/** Drop owners well past the grace window so the map cannot grow forever. */
function pruneOwners(now: number): void {
  for (const [operationId, owner] of demoCardOwners) {
    if (now - owner.at > DEMO_SESSION_GRACE_MS * 10) demoCardOwners.delete(operationId);
  }
}

export type SeedNowResult = {
  operationId: string;
  created: boolean;
  scenario?: DemoScenarioId;
  request?: DemoRequestId;
};

export type SeedNowInput = {
  gateway: StackGateway;
  merchantOrigin: string;
  amountAtomic?: string;
  amountUsdMicros?: string;
  initialUsdcAtomic?: string;
  initialSolAtomic?: string;
  request?: DemoRequestId;
  /** Browser session that asked for this card, when it came from /demo. */
  sessionId?: string;
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
  const requestId = input.request ?? "valuation";
  const request = DEMO_REQUESTS[requestId];
  const operationId = `demo-now-${randomUUID()}`;
  const taskId = `${requestId}-${randomUUID()}`;
  const requestHash = `sha256:${createHash("sha256").update(operationId).digest("hex")}`;
  const resource = `${input.merchantOrigin}/v1/market-snapshot`;
  const amountAtomic = input.amountAtomic ?? request.amountAtomic;
  const amountUsdMicros = input.amountUsdMicros ?? request.amountUsdMicros;
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
        purpose: request.purpose,
        stepLabel: request.stepLabel
      },
      resourceMethod: "GET"
    }
  });
  if (result.status !== "approval_required") {
    throw new Error(`stack seed expected approval_required, got ${result.status}`);
  }
  rememberOwner(operationId, input.sessionId, input.initialUsdcAtomic);
  return { operationId, created: true, request: requestId };
}

/**
 * Clear live parked cards so a new scenario can take the Now slot.
 *
 * Without `sessionId` this clears every parked card (operator controls, local
 * single-user runs). With one, it spares cards another visitor is still working
 * through: on the public host two people clicking at once used to deny each
 * other mid-loop. Cards with no known owner, and cards past the grace window,
 * are still cleared so an abandoned card never wedges the demo.
 */
export async function clearParkedApprovals(
  gateway: StackGateway,
  options?: { sessionId?: string; graceMs?: number }
): Promise<number> {
  const parked = await gateway.store.listRecent({
    state: "approval_required",
    limit: 50
  });
  const now = Date.now();
  const graceMs = options?.graceMs ?? DEMO_SESSION_GRACE_MS;
  let cleared = 0;
  for (const row of parked) {
    if (options?.sessionId) {
      const owner = demoCardOwners.get(row.operationId);
      const heldByOther =
        owner !== undefined &&
        owner.sessionId !== options.sessionId &&
        now - owner.at < graceMs;
      if (heldByOther) continue;
    }
    const res = await gateway.app.request(
      `/v1/denials/${encodeURIComponent(row.operationId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "demo_scenario_reset" })
      }
    );
    if (res.ok) {
      cleared += 1;
      demoCardOwners.delete(row.operationId);
    }
  }
  pruneOwners(now);
  return cleared;
}

/**
 * Restore the wallet this card was seeded with, immediately before its owner
 * approves it. The mock wallet is one shared balance, so without this a second
 * visitor picking a different scenario rewrites the first visitor's numbers and
 * their "covers only the missing $1.40" story collapses to "nothing to cover".
 *
 * Returns false when the card is not this session's to claim.
 */
export function claimDemoCard(
  gateway: StackGateway,
  input: { operationId: string; sessionId: string; initialSolAtomic?: string }
): boolean {
  const owner = demoCardOwners.get(input.operationId);
  if (!owner || owner.sessionId !== input.sessionId) return false;
  resetDemoWallet(gateway, {
    initialUsdcAtomic: owner.usdcAtomic,
    initialSolAtomic: input.initialSolAtomic ?? "5000000000"
  });
  return true;
}

export async function applyDemoScenario(input: {
  gateway: StackGateway;
  merchantOrigin: string;
  scenario: DemoScenarioId;
  request?: DemoRequestId;
  sessionId?: string;
  seedPolicy?: ReturnType<StackGateway["policies"]["get"]>;
  initialSolAtomic?: string;
}): Promise<SeedNowResult> {
  const scenario = DEMO_SCENARIOS[input.scenario];
  const requestId = input.request ?? "valuation";
  const request = DEMO_REQUESTS[requestId];
  if (!scenario) {
    throw new Error(`unknown_scenario:${input.scenario}`);
  }
  if (!request) {
    throw new Error(`unknown_request:${requestId}`);
  }
  const initialUsdcAtomic =
    input.scenario === "empty"
      ? "0"
      : input.scenario === "funded"
        ? request.amountAtomic
        : request.partialUsdcAtomic;
  await clearParkedApprovals(
    input.gateway,
    input.sessionId ? { sessionId: input.sessionId } : undefined
  );
  /**
   * The mock wallet is still one shared balance, so a second visitor switching
   * scenarios mid-loop changes the numbers the first one sees. The funding
   * event carries the real deficit, so the audit trail stays correct.
   */
  resetDemoWallet(input.gateway, {
    initialUsdcAtomic,
    initialSolAtomic: input.initialSolAtomic ?? "5000000000"
  });
  if (input.seedPolicy) {
    input.gateway.policies.set(input.seedPolicy);
  }
  const seeded = await parkDemoCard({
    gateway: input.gateway,
    merchantOrigin: input.merchantOrigin,
    request: requestId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    amountAtomic: request.amountAtomic,
    amountUsdMicros: request.amountUsdMicros,
    initialUsdcAtomic,
    initialSolAtomic: input.initialSolAtomic ?? "5000000000"
  });
  return { ...seeded, scenario: input.scenario, request: requestId };
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

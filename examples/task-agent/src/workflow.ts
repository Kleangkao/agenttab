import { createAgentTabClient, requestPaidResource } from "@agenttab/fetch";
import type { AgentTabApprovalRequiredError } from "@agenttab/fetch";
import { createLocalSmokeScheme } from "@agenttab/fetch";
import { LOCAL_NETWORK, USDC_MINT, WSOL_MINT } from "@agenttab/gateway";

export interface WalletValuationResult {
  taskId: string;
  taskContext: {
    purpose: string;
    stepLabel?: string;
  };
  wallet: unknown;
  balances: Array<{
    mint: string;
    symbol: string;
    balanceAtomic: string;
    verified: boolean;
  }>;
  paid: Array<{
    resourceUrl: string;
    priceUsdMicros: string;
  }>;
  valuation: {
    totalUsdMicros: string;
    usdcUsdMicros: string;
    solUsdMicros: string;
    solPriceUsdMicros?: string;
  };
  fidelity: {
    payment: "local-mock";
  };
}

function asBigInt(n: string): bigint {
  if (!/^\d+$/.test(n)) return 0n;
  return BigInt(n);
}

async function readGatewayBalances(gatewayBaseUrl: string): Promise<{
  wallet: unknown;
  balances: Array<{
    mint: string;
    symbol: string;
    balanceAtomic: string;
    verified: boolean;
  }>;
}> {
  const res = await fetch(`${gatewayBaseUrl}/v1/balances`);
  if (!res.ok) {
    throw new Error(`Failed to read balances (${res.status})`);
  }
  return (await res.json()) as {
    wallet: unknown;
    balances: Array<{
      mint: string;
      symbol: string;
      balanceAtomic: string;
      verified: boolean;
    }>;
  };
}

async function pollExecutionState(
  agent: ReturnType<typeof createAgentTabClient>,
  operationId: string,
  predicate: (state: string) => boolean,
  timeoutMs: number
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  // Polling is only for the demo/operator loop; production agents should wire
  // a real signal (notify webhook, queue, etc.) if available.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for operation ${operationId}`);
    }
    const exec = await agent.getExecution(operationId);
    const state = (exec as { state?: string }).state ?? "";
    if (predicate(state)) return exec;
    await new Promise((r) => setTimeout(r, 300));
  }
}

export interface WalletValuationTaskInput {
  gatewayBaseUrl: string;
  priceOracleOrigin: string;
  taskId: string;
  taskContext: {
    purpose: string;
    stepLabel?: string;
  };
  /**
   * Optional automation for CI and local smoke. When true, the agent will ask
   * AgentTab to approve automatically instead of waiting for a human.
   */
  autoApprove?: boolean;
}

export async function runWalletValuationTask(
  input: WalletValuationTaskInput
): Promise<WalletValuationResult> {
  const agent = createAgentTabClient({
    gatewayBaseUrl: input.gatewayBaseUrl,
    schemes: [{ network: LOCAL_NETWORK, client: createLocalSmokeScheme() }],
    // Ensure policy evaluation always knows the USD micros for USDC.
    getUsdValueMicros: async ({ assetMint, amountAtomic }) =>
      assetMint === USDC_MINT ? amountAtomic : undefined,
    // In local demo we want audit records for operator UI.
    recordAudit: true
  });

  const balancesPayload = await readGatewayBalances(input.gatewayBaseUrl);
  const balances = balancesPayload.balances;

  const usdc = balances.find((b) => b.mint === USDC_MINT);
  const sol = balances.find((b) => b.mint === WSOL_MINT);

  const usdcAtomic = usdc?.balanceAtomic ?? "0";
  const solAtomic = sol?.balanceAtomic ?? "0";

  const usdcUsdMicros = asBigInt(usdcAtomic); // 1 USDC atomic == 1 USD micros here.
  const paid: WalletValuationResult["paid"] = [];

  let solPriceUsdMicros: string | undefined;
  let solUsdMicros: bigint = 0n;

  const needsSolPricing = asBigInt(solAtomic) > 0n;

  const priceResourceUrl = `${input.priceOracleOrigin}/v1/price?asset=SOL`;

  if (needsSolPricing) {
    try {
      const onApprovalRequired =
        input.autoApprove
          ? (async (_error: AgentTabApprovalRequiredError) => "approve" as const)
          : (async (_error: AgentTabApprovalRequiredError) => "abort" as const);

      const paidResult = await requestPaidResource(
        agent,
        priceResourceUrl,
        { method: "GET" },
        {
          taskId: input.taskId,
          taskContext: input.taskContext,
          onApprovalRequired
        }
      );
      solPriceUsdMicros = String((paidResult.body as { priceUsdMicros?: string }).priceUsdMicros ?? "0");
      const priceUsdMicros = asBigInt(solPriceUsdMicros);
      // SOL has 9 decimals (lamports). USD micros are per 1 SOL.
      solUsdMicros = (asBigInt(solAtomic) * priceUsdMicros) / 1_000_000_000n;
      paid.push({ resourceUrl: priceResourceUrl, priceUsdMicros: solPriceUsdMicros });
    } catch (e) {
      // Wait for human approval, then retry with the same operationId.
      const maybe = e as { operationId?: string; requestHash?: string };
      const operationId = typeof maybe.operationId === "string" ? maybe.operationId : undefined;
      if (!operationId) throw e;

      await pollExecutionState(
        agent,
        operationId,
        (state) =>
          state === "funded" ||
          state === "payment_submitted" ||
          state === "paid" ||
          state === "fulfilled",
        60_000
      );

      const paidResult = await requestPaidResource(
        agent,
        priceResourceUrl,
        { method: "GET" },
        {
          taskId: input.taskId,
          taskContext: input.taskContext,
          onApprovalRequired: (async (_error: AgentTabApprovalRequiredError) => "abort" as const)
        }
      );

      solPriceUsdMicros = String((paidResult.body as { priceUsdMicros?: string }).priceUsdMicros ?? "0");
      const priceUsdMicros = asBigInt(solPriceUsdMicros);
      solUsdMicros = (asBigInt(solAtomic) * priceUsdMicros) / 1_000_000_000n;
      paid.push({ resourceUrl: priceResourceUrl, priceUsdMicros: solPriceUsdMicros });
    }
  }

  const totalUsdMicros = usdcUsdMicros + solUsdMicros;
  return {
    taskId: input.taskId,
    taskContext: input.taskContext,
    wallet: balancesPayload.wallet,
    balances,
    paid,
    valuation: {
      totalUsdMicros: totalUsdMicros.toString(),
      usdcUsdMicros: usdcUsdMicros.toString(),
      solUsdMicros: solUsdMicros.toString(),
      ...(solPriceUsdMicros === undefined ? {} : { solPriceUsdMicros })
    },
    fidelity: { payment: "local-mock" }
  };
}


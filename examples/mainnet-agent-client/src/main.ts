/**
 * Mainnet agent dry-run: policy load + RPC balances + DFlow live-sim + LocalKeypairSigner
 * with broadcast forced off. Never sends.
 *
 * Also exercises createGatewayRuntime with RpcBalanceProvider (still broadcast-off).
 *
 *   pnpm mainnet:setup
 *   pnpm mainnet:agent
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { DFlowClient } from "@agenttab/dflow";
import {
  createGatewayRuntime,
  DEXTER_FACILITATOR_URL,
  LiveSimDFlowAdapter,
  LocalKeypairSigner,
  MAINNET_MIN_TEST_PAYMENT_ATOMIC,
  PAYAI_FACILITATOR_URL,
  RpcBalanceProvider,
  resolveMainnetDflowBaseUrl,
  SOLANA_MAINNET,
  USDC_MINT,
  WSOL_MINT,
  type PaymentPolicy
} from "@agenttab/gateway";

const DATA_DIR = resolve(process.cwd(), "../../.data/mainnet");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

function requireFile(name: string): string {
  const path = resolve(DATA_DIR, name);
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run pnpm mainnet:setup`);
  return path;
}

function loadPolicy(): PaymentPolicy {
  const raw = JSON.parse(
    readFileSync(requireFile("policy.mainnet.json"), "utf8")
  ) as PaymentPolicy & { notes?: string };
  delete (raw as { notes?: string }).notes;
  return raw;
}

async function main(): Promise<void> {
  if (process.env.AGENTTAB_BROADCAST === "1") {
    console.error(
      JSON.stringify({
        error: "broadcast_blocked",
        message:
          "Refusing AGENTTAB_BROADCAST=1 until the explicit real-money execution plan is approved in chat."
      })
    );
    process.exit(2);
  }

  const buyerPath = requireFile("buyer.json");
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(buyerPath, "utf8")) as number[])
  );
  const buyerAddress = buyer.publicKey.toBase58();
  const addressFile = readFileSync(requireFile("buyer.address.txt"), "utf8").trim();
  if (addressFile !== buyerAddress) {
    throw new Error(
      `buyer.json pubkey ${buyerAddress} does not match buyer.address.txt ${addressFile}`
    );
  }
  const envLocalPath = resolve(process.cwd(), "../../.env.local");
  if (existsSync(envLocalPath)) {
    const expectedLine = readFileSync(envLocalPath, "utf8")
      .split(/\r?\n/)
      .find((line) => line.startsWith("PHANTOM_EXPECTED_ADDRESS="));
    const expected = expectedLine?.slice("PHANTOM_EXPECTED_ADDRESS=".length).trim();
    if (expected && expected !== buyerAddress) {
      throw new Error(
        `Imported buyer ${buyerAddress} does not match PHANTOM_EXPECTED_ADDRESS ${expected}`
      );
    }
  }
  const connection = new Connection(RPC, "confirmed");
  const policy = loadPolicy();
  const dflowEndpoint = resolveMainnetDflowBaseUrl();
  const balances = new RpcBalanceProvider({
    connection,
    owner: new PublicKey(buyerAddress),
    splMints: [{ mint: USDC_MINT, symbol: "USDC" }]
  });
  await balances.refresh();

  const solAtomic = balances.get(WSOL_MINT)?.balanceAtomic ?? "0";
  const usdcAtomic = balances.get(USDC_MINT)?.balanceAtomic ?? "0";
  const signer = LocalKeypairSigner.fromSecretKeyFile(buyerPath, connection, false);

  const dflowClient = new DFlowClient({
    baseUrl: dflowEndpoint.baseUrl,
    ...(process.env.DFLOW_API_KEY ? { apiKey: process.env.DFLOW_API_KEY } : {})
  });

  const adapter = new LiveSimDFlowAdapter({
    client: dflowClient,
    connection,
    failClosedOnSimulationError: false,
    allowBroadcastInPlan: false,
    maxQuoteRequests: 16
  });

  const maxIn = BigInt(solAtomic) > 0n ? solAtomic : "50000000";
  let order;
  try {
    order = await adapter.planExactDeficit({
      inputMint: WSOL_MINT,
      outputMint: USDC_MINT,
      targetOutputAtomic: MAINNET_MIN_TEST_PAYMENT_ATOMIC,
      maxInputAtomic: maxIn,
      userPublicKey: buyerAddress,
      slippageBps: policy.maxSlippageBps
    });
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          phase: "mainnet-agent-dry-run",
          network: SOLANA_MAINNET,
          buyer: buyerAddress,
          rpc: RPC,
          dflow: dflowEndpoint,
          balances: { solAtomic, usdcAtomic },
          error: error instanceof Error ? error.message : String(error),
          hint:
            dflowEndpoint.source === "dev-fallback"
              ? "Open DFlow dev endpoint may be rate-limited. For funded Mainnet use DFLOW_API_KEY + quote-api.dflow.net."
              : "Inspect DFlow/RPC error before funding or broadcast approval."
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const signed = await signer.signFundingTransaction({
    wallet: buyerAddress,
    inputMint: order.inputMint,
    outputMint: order.outputMint,
    inputAmountAtomic: order.inputAmountAtomic,
    minimumOutputAtomic: order.minimumOutputAtomic,
    network: SOLANA_MAINNET,
    operationId: `mainnet-dry-${randomUUID()}`,
    transaction: order.transaction
  });

  const plan = JSON.parse(order.transaction) as {
    broadcast: boolean;
    simulationOk: boolean;
    simulationError?: string;
    type: string;
  };

  // Separate fail-closed adapter so an unfunded wallet cannot be marked "funded".
  const failClosedAdapter = new LiveSimDFlowAdapter({
    client: dflowClient,
    connection,
    failClosedOnSimulationError: true,
    allowBroadcastInPlan: false,
    maxQuoteRequests: 16
  });

  // Gateway coordinator path (still no broadcast): proves RpcBalanceProvider wiring.
  // Use autopay for this dry probe so we reach the fail-closed funding path;
  // production policy.mainnet.json remains mode=approve until the funded run.
  const gateway = createGatewayRuntime({
    dbPath: resolve(DATA_DIR, "gateway-dry.sqlite"),
    merchantOrigin: "http://127.0.0.1:4022",
    policy: {
      ...policy,
      mode: "autopay",
      requireApprovalAboveUsdMicros: "100000000"
    },
    wallet: buyerAddress,
    balances,
    dflowAdapter: failClosedAdapter,
    signer,
    broadcastEnabled: false,
    liveSimFailClosed: true
  });

  let gatewayOutcome: unknown;
  try {
    gatewayOutcome = await gateway.coordinator.ensurePaymentAsset({
      intent: {
        operationId: `mainnet-gw-dry-${randomUUID()}`,
        requestHash: `sha256:mainnet-dry-${Date.now()}`,
        protocol: "x402",
        network: SOLANA_MAINNET,
        merchantId: "mainnet-local-merchant",
        merchantOrigin: "http://127.0.0.1:4022",
        destination: readFileSync(requireFile("merchant.address.txt"), "utf8").trim(),
        assetMint: USDC_MINT,
        amountAtomic: MAINNET_MIN_TEST_PAYMENT_ATOMIC,
        amountUsdMicros: MAINNET_MIN_TEST_PAYMENT_ATOMIC,
        resource: "http://127.0.0.1:4022/v1/research"
      }
    });
  } finally {
    gateway.close();
  }

  console.log(
    JSON.stringify(
      {
        phase: "mainnet-agent-dry-run",
        network: SOLANA_MAINNET,
        buyer: buyerAddress,
        rpc: RPC,
        dflow: dflowEndpoint,
        balances: { solAtomic, usdcAtomic },
        policy: {
          mode: policy.mode,
          maxPaymentUsdMicros: policy.maxPaymentUsdMicros,
          maxDailyUsdMicros: policy.maxDailyUsdMicros,
          maxSlippageBps: policy.maxSlippageBps,
          maxPriceImpactPct: policy.maxPriceImpactPct
        },
        facilitatorCandidates: [
          `${DEXTER_FACILITATOR_URL} (preferred)`,
          PAYAI_FACILITATOR_URL
        ],
        order: {
          source: order.source,
          inputAmountAtomic: order.inputAmountAtomic,
          outputAmountAtomic: order.outputAmountAtomic,
          priceImpactPct: order.priceImpactPct
        },
        planType: plan.type,
        broadcast: plan.broadcast,
        simulationOk: plan.simulationOk,
        simulationError: plan.simulationError ?? null,
        localSignature: signed.signature,
        signerBroadcastEnabled: signer.broadcastEnabled,
        gatewayEnsurePaymentAsset: gatewayOutcome,
        readyForFunding:
          BigInt(solAtomic) === 0n
            ? "Deposit SOL to buyer, then re-run dry-run until simulationOk=true before approving broadcast"
            : plan.simulationOk
              ? "Simulation ok with current SOL — still waiting for explicit broadcast approval"
              : "Inspect simulationError before any broadcast approval"
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

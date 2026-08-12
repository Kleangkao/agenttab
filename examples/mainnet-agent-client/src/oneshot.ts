/**
 * Mainnet one-shot x402 runner.
 *
 * Default: dry-run only, never broadcasts.
 * Broadcast path exists but only arms when all explicit safety gates are set.
 *
 * Usage:
 *   pnpm mainnet:paid-api
 *   pnpm mainnet:oneshot
 *
 * Future funded run only after explicit approval:
 *   set MAINNET_ONE_SHOT_MODE=broadcast
 *   set AGENTTAB_BROADCAST=1
 *   set AGENTTAB_MAINNET_EXECUTION_APPROVED=I_UNDERSTAND_THIS_WILL_SPEND_REAL_FUNDS
 *   set DFLOW_API_KEY=...
 *   pnpm mainnet:oneshot
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { DFlowClient } from "@agenttab/dflow";
import {
  createAgentTabFetch,
  createGatewayAuditRecorder,
  getAgentTabMeta
} from "@agenttab/fetch";
import {
  createGatewayRuntime,
  DEXTER_FACILITATOR_URL,
  fetchFacilitatorMinimum,
  LiveSimDFlowAdapter,
  LocalKeypairSigner,
  MAINNET_MIN_TEST_PAYMENT_ATOMIC,
  resolveMainnetDflowBaseUrl,
  resolvePaymentAtomicFloor,
  RpcBalanceProvider,
  SOLANA_MAINNET,
  USDC_MINT,
  WSOL_MINT,
  type PaymentPolicy
} from "@agenttab/gateway";
import {
  createExecutablePolicy,
  resolveOneShotExecutionMode
} from "./runner.js";

const DATA_DIR = resolve(process.cwd(), "../../.data/mainnet");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const RESOURCE_URL =
  process.env.RESOURCE_URL ?? "http://127.0.0.1:4022/v1/research";

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
  const mode = resolveOneShotExecutionMode(process.env);
  const buyerPath = requireFile("buyer.json");
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(buyerPath, "utf8")) as number[])
  );
  const buyerBase58 = base58.encode(buyer.secretKey);
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
  const merchantAddress = readFileSync(requireFile("merchant.address.txt"), "utf8").trim();
  const connection = new Connection(RPC, "confirmed");
  const storedPolicy = loadPolicy();
  const policy = createExecutablePolicy(storedPolicy);
  const dflowEndpoint = resolveMainnetDflowBaseUrl();
  const facilitatorUrl = process.env.FACILITATOR_URL ?? DEXTER_FACILITATOR_URL;

  const liveMinimum = await fetchFacilitatorMinimum({
    facilitatorUrl
  }).catch((error: unknown) => ({
    facilitatorUrl,
    network: SOLANA_MAINNET,
    scheme: "exact",
    minPaymentAmountAtomic: MAINNET_MIN_TEST_PAYMENT_ATOMIC,
    minPaymentAmountUsd: null,
    error: error instanceof Error ? error.message : String(error)
  }));

  const requestedPaymentAtomic = resolvePaymentAtomicFloor(
    process.env.MAINNET_PAYMENT_ATOMIC ?? MAINNET_MIN_TEST_PAYMENT_ATOMIC,
    liveMinimum.minPaymentAmountAtomic
  );

  const balances = new RpcBalanceProvider({
    connection,
    owner: new PublicKey(buyerAddress),
    splMints: [{ mint: USDC_MINT, symbol: "USDC" }]
  });
  await balances.refresh();
  const solAtomic = balances.get(WSOL_MINT)?.balanceAtomic ?? "0";
  const usdcAtomic = balances.get(USDC_MINT)?.balanceAtomic ?? "0";

  const dflowClient = new DFlowClient({
    baseUrl: dflowEndpoint.baseUrl,
    ...(process.env.DFLOW_API_KEY ? { apiKey: process.env.DFLOW_API_KEY } : {})
  });
  const signer = LocalKeypairSigner.fromSecretKeyFile(
    buyerPath,
    connection,
    mode.broadcastEnabled
  );
  const adapter = new LiveSimDFlowAdapter({
    client: dflowClient,
    connection,
    failClosedOnSimulationError: true,
    allowBroadcastInPlan: mode.allowBroadcastInPlan,
    maxQuoteRequests: 16
  });
  const gateway = createGatewayRuntime({
    dbPath: resolve(DATA_DIR, "gateway-mainnet.sqlite"),
    merchantOrigin: new URL(RESOURCE_URL).origin,
    policy,
    wallet: buyerAddress,
    balances,
    dflowAdapter: adapter,
    signer,
    broadcastEnabled: mode.broadcastEnabled,
    liveSimFailClosed: true
  });

  const operationId = process.env.OPERATION_ID ?? `mainnet-one-shot-${randomUUID()}`;
  const svmSigner = await createKeyPairSignerFromBytes(base58.decode(buyerBase58));

  const gatewayFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input instanceof Request ? input.url : input);
    const path = raw.startsWith("http")
      ? `${new URL(raw).pathname}${new URL(raw).search}`
      : raw;
    return gateway.app.request(path, init);
  }) as typeof fetch;

  const fetchPaid = createAgentTabFetch({
    coordinator: gateway.coordinator,
    audit: createGatewayAuditRecorder({
      baseUrl: "http://agenttab.local",
      fetchImpl: gatewayFetch
    }),
    schemes: [{ network: SOLANA_MAINNET, client: new ExactSvmScheme(svmSigner) }],
    createOperationId: () => operationId,
    getUsdValueMicros: async ({ amountAtomic }) => amountAtomic,
    onPaymentCreationFailure: async (ctx) => {
      const message = ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
      console.log(
        JSON.stringify(
          {
            phase: "mainnet-one-shot-payment-creation-failure",
            error: message,
            facilitator: facilitatorUrl
          },
          null,
          2
        )
      );
      const execution = await gateway.store.get(operationId);
      if (execution) {
        await gateway.store.appendEvent({
          operationId,
          expectedVersion: execution.version,
          kind: "payment.settle_failed",
          details: {
            message: message.slice(0, 500),
            facilitatorUrl,
            statusHint: "payment_creation_failed"
          }
        });
      }
    },
    onAuditError: (error, meta) => {
      console.log(
        JSON.stringify(
          {
            phase: "mainnet-one-shot-audit-error",
            error: error instanceof Error ? error.message : String(error),
            meta
          },
          null,
          2
        )
      );
    }
  });

  console.log(
    JSON.stringify(
      {
        phase: "mainnet-one-shot-start",
        mode: mode.label,
        resourceUrl: RESOURCE_URL,
        buyer: buyerAddress,
        merchant: merchantAddress,
        rpc: RPC,
        dflow: dflowEndpoint,
        facilitator: facilitatorUrl,
        liveMinimum,
        requestedPaymentAtomic,
        balances: { solAtomic, usdcAtomic },
        broadcastEnabled: mode.broadcastEnabled,
        signerBroadcastEnabled: signer.broadcastEnabled,
        integration: "@agenttab/fetch"
      },
      null,
      2
    )
  );

  try {
    const response = await fetchPaid(RESOURCE_URL, { method: "GET" });
    const meta = getAgentTabMeta(response);
    const paymentResponse =
      response.headers.get("PAYMENT-RESPONSE") ??
      response.headers.get("X-PAYMENT-RESPONSE");
    const bodyText = await response.text();
    let body: unknown = bodyText;
    try {
      body = JSON.parse(bodyText);
    } catch {
      // leave text
    }

    if (!response.ok) {
      const execution = await gateway.store.get(operationId);
      if (execution && execution.state !== "failed") {
        try {
          await gateway.store.appendEvent({
            operationId,
            expectedVersion: execution.version,
            kind: "payment.settle_failed",
            details: {
              httpStatus: response.status,
              facilitatorUrl,
              bodyPreview:
                typeof body === "string"
                  ? body.slice(0, 300)
                  : JSON.stringify(body).slice(0, 300)
            }
          });
        } catch {
          // Best-effort diagnostics only.
        }
      }
      const refreshed = await gateway.store.get(operationId);
      console.log(
        JSON.stringify(
          {
            phase: "mainnet-one-shot-nonok",
            status: response.status,
            body,
            paymentResponse: paymentResponse?.slice(0, 200) ?? null,
            facilitator: facilitatorUrl,
            meta,
            executionState: refreshed?.state,
            events: refreshed?.events.map((event) => event.kind) ?? []
          },
          null,
          2
        )
      );
      process.exit(1);
    }

    const finalExecution = await gateway.store.get(operationId);
    console.log(
      JSON.stringify(
        {
          phase: "mainnet-one-shot-result",
          status: response.status,
          paymentResponse: paymentResponse?.slice(0, 200) ?? null,
          body,
          meta,
          executionState: finalExecution?.state,
          events:
            finalExecution?.events.map((event) => ({
              kind: event.kind,
              to: event.to
            })) ?? []
        },
        null,
        2
      )
    );
  } catch (error) {
    const execution = await gateway.store.get(operationId);
    console.log(
      JSON.stringify(
        {
          phase: "mainnet-one-shot-aborted",
          mode: mode.label,
          error: error instanceof Error ? error.message : String(error),
          executionState: execution?.state,
          events: execution?.events.map((event) => event.kind) ?? [],
          hint:
            BigInt(solAtomic) === 0n
              ? "Buyer has no SOL, so exact-deficit funding cannot proceed yet."
              : "Inspect DFlow/facilitator output before any broadcast approval."
        },
        null,
        2
      )
    );
    process.exit(1);
  } finally {
    gateway.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

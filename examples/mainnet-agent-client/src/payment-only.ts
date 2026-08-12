/**
 * Payment-only Mainnet probe after funding already succeeded.
 * Does not enable funding broadcast.
 *
 * Uses `@agenttab/fetch` as the developer integration surface.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import {
  createAgentTabFetch,
  createGatewayAuditRecorder,
  getAgentTabMeta
} from "@agenttab/fetch";
import {
  createGatewayRuntime,
  LocalKeypairSigner,
  RpcBalanceProvider,
  SOLANA_MAINNET,
  USDC_MINT,
  WSOL_MINT,
  type PaymentPolicy
} from "@agenttab/gateway";
import { createExecutablePolicy } from "./runner.js";

const DATA_DIR = resolve(process.cwd(), "../../.data/mainnet");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const RESOURCE_URL = process.env.RESOURCE_URL ?? "http://127.0.0.1:4022/v1/research";

function requireFile(name: string): string {
  const path = resolve(DATA_DIR, name);
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  return path;
}

const buyerPath = requireFile("buyer.json");
const buyer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(buyerPath, "utf8")) as number[])
);
const buyerAddress = buyer.publicKey.toBase58();
const connection = new Connection(RPC, "confirmed");
const rawPolicy = JSON.parse(
  readFileSync(requireFile("policy.mainnet.json"), "utf8")
) as PaymentPolicy & { notes?: string };
delete (rawPolicy as { notes?: string }).notes;
const policy = createExecutablePolicy(rawPolicy);
const balances = new RpcBalanceProvider({
  connection,
  owner: new PublicKey(buyerAddress),
  splMints: [{ mint: USDC_MINT, symbol: "USDC" }]
});
await balances.refresh();
const solAtomic = balances.get(WSOL_MINT)?.balanceAtomic ?? "0";
const usdcAtomic = balances.get(USDC_MINT)?.balanceAtomic ?? "0";
if (BigInt(usdcAtomic) < 1000n) {
  throw new Error(`Expected funded USDC >= 1000, got ${usdcAtomic}`);
}

const gateway = createGatewayRuntime({
  dbPath: resolve(DATA_DIR, "gateway-mainnet.sqlite"),
  merchantOrigin: new URL(RESOURCE_URL).origin,
  policy,
  wallet: buyerAddress,
  balances,
  signer: LocalKeypairSigner.fromSecretKeyFile(buyerPath, connection, false),
  broadcastEnabled: false,
  liveSimFailClosed: true
});

const operationId = `mainnet-pay-only-${randomUUID()}`;
const svmSigner = await createKeyPairSignerFromBytes(buyer.secretKey);

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
    console.log(
      JSON.stringify(
        {
          phase: "payment-creation-failure",
          error: ctx.error instanceof Error ? ctx.error.message : String(ctx.error)
        },
        null,
        2
      )
    );
  },
  onAuditError: (error, meta) => {
    console.log(
      JSON.stringify(
        {
          phase: "payment-only-audit-error",
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
      phase: "payment-only-start",
      buyer: buyerAddress,
      balances: { solAtomic, usdcAtomic },
      broadcastEnabled: false,
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
    response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  const bodyText = await response.text();
  let body: unknown = bodyText;
  try {
    body = JSON.parse(bodyText);
  } catch {
    // keep text
  }
  const execution = await gateway.store.get(meta?.operationId ?? operationId);
  console.log(
    JSON.stringify(
      {
        phase: "payment-only-result",
        status: response.status,
        paymentResponse: paymentResponse?.slice(0, 300) ?? null,
        body,
        meta,
        executionState: execution?.state,
        events: execution?.events.map((e) => e.kind) ?? []
      },
      null,
      2
    )
  );

  process.exit(response.ok ? 0 : 1);
} catch (error) {
  const execution = await gateway.store.get(operationId);
  console.log(
    JSON.stringify(
      {
        phase: "payment-only-error",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split("\n").slice(0, 12) : undefined,
        executionState: execution?.state,
        events: execution?.events.map((e) => e.kind) ?? []
      },
      null,
      2
    )
  );
  process.exit(1);
} finally {
  gateway.close();
}

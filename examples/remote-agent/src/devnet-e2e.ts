/**
 * One-command Devnet remote topology proof:
 * Devnet gateway runtime (same factory as standalone) + facilitator merchant +
 * `@agenttab/fetch` agent with ExactSvmScheme.
 *
 * Uses disposable `.data/devnet` wallets. No Mainnet spend.
 * Forces a payment-asset deficit so exact-deficit mint funding is exercised.
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount
} from "@solana/spl-token";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createFacilitatorNeutralMerchant } from "@agenttab/example-neutral-merchant";
import {
  createDevnetGatewayRuntime,
  loadDevnetGatewayPaths,
  MockBalanceProvider,
  readSplBalance,
  SOLANA_DEVNET,
  WSOL_MINT
} from "@agenttab/gateway";
import { createRemoteAgent, purchasePaidResource } from "./agent.js";

const PAYMENT_AMOUNT_ATOMIC = 1000n;
const FORCE_DEFICIT_REMAINING = 100n;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

async function listenFetch(
  fetchHandler: (request: Request) => Response | Promise<Response>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = serve({
    fetch: fetchHandler,
    port: 0,
    hostname: "127.0.0.1"
  });
  if (!server.listening) {
    await new Promise<void>((resolveListen, reject) => {
      server.once("listening", () => resolveListen());
      server.once("error", reject);
    });
  }
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    }
  };
}

async function forcePaymentDeficit(options: {
  connection: Connection;
  buyer: Keypair;
  merchant: PublicKey;
  mint: PublicKey;
}): Promise<{ before: bigint; after: bigint; drained: bigint }> {
  const before = await readSplBalance(
    options.connection,
    options.buyer.publicKey,
    options.mint
  );
  if (before <= FORCE_DEFICIT_REMAINING) {
    return { before, after: before, drained: 0n };
  }

  const drainAmount = before - FORCE_DEFICIT_REMAINING;
  const merchantAta = await getOrCreateAssociatedTokenAccount(
    options.connection,
    options.buyer,
    options.mint,
    options.merchant
  );
  const buyerAta = getAssociatedTokenAddressSync(options.mint, options.buyer.publicKey);
  const tx = new Transaction().add(
    createTransferInstruction(
      buyerAta,
      merchantAta.address,
      options.buyer.publicKey,
      drainAmount
    )
  );
  const { blockhash, lastValidBlockHeight } = await options.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = options.buyer.publicKey;
  tx.sign(options.buyer);
  const signature = await options.connection.sendRawTransaction(tx.serialize());
  await options.connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight
  });
  const after = await readSplBalance(
    options.connection,
    options.buyer.publicKey,
    options.mint
  );
  return { before, after, drained: drainAmount };
}

async function main(): Promise<void> {
  const forceDeficit = process.env.FORCE_DEFICIT !== "0";
  const loaded = loadDevnetGatewayPaths();
  const merchantAddress = readFileSync(
    resolve(loaded.dataDir, "merchant.address.txt"),
    "utf8"
  ).trim();
  const connection = new Connection(RPC, "confirmed");

  let tokenBalance = await readSplBalance(
    connection,
    loaded.buyerKeypair.publicKey,
    loaded.mint
  );
  let drainInfo: { before: bigint; after: bigint; drained: bigint } | null = null;

  if (forceDeficit) {
    if (tokenBalance < PAYMENT_AMOUNT_ATOMIC) {
      const bootstrap = await createDevnetGatewayRuntime({
        merchantOrigin: "http://127.0.0.1:9",
        paymentBalanceAtomic: tokenBalance.toString(),
        dbPath: ":memory:"
      });
      await bootstrap.dflow.planExactDeficit({
        inputMint: WSOL_MINT,
        outputMint: loaded.mint.toBase58(),
        targetOutputAtomic: (PAYMENT_AMOUNT_ATOMIC + FORCE_DEFICIT_REMAINING).toString(),
        maxInputAtomic: "5000000000",
        userPublicKey: loaded.buyerAddress
      });
      bootstrap.close();
      tokenBalance = await readSplBalance(
        connection,
        loaded.buyerKeypair.publicKey,
        loaded.mint
      );
    }

    drainInfo = await forcePaymentDeficit({
      connection,
      buyer: loaded.buyerKeypair,
      merchant: new PublicKey(merchantAddress),
      mint: loaded.mint
    });
    tokenBalance = drainInfo.after;
  }

  if (forceDeficit && tokenBalance >= PAYMENT_AMOUNT_ATOMIC) {
    throw new Error(
      `FORCE_DEFICIT failed: buyer still holds ${tokenBalance} (>= ${PAYMENT_AMOUNT_ATOMIC})`
    );
  }

  const merchantApp = createFacilitatorNeutralMerchant({
    origin: "http://127.0.0.1",
    facilitatorUrl: FACILITATOR_URL,
    network: SOLANA_DEVNET,
    assetMint: loaded.mint.toBase58(),
    payTo: merchantAddress,
    priceAtomic: PAYMENT_AMOUNT_ATOMIC.toString()
  });
  const merchantHttp = await listenFetch((request) => merchantApp.fetch(request));
  const merchantOrigin = merchantHttp.baseUrl;

  const gateway = await createDevnetGatewayRuntime({
    merchantOrigin,
    paymentBalanceAtomic: tokenBalance.toString(),
    dbPath: resolve(loaded.dataDir, "gateway-devnet-remote-e2e.sqlite")
  });
  if (!(gateway.balances instanceof MockBalanceProvider)) {
    throw new Error("Expected MockBalanceProvider for Devnet remote gateway");
  }
  const gatewayHttp = await listenFetch((request) => gateway.app.fetch(request));

  const buyerBase58 = readFileSync(resolve(loaded.dataDir, "buyer.base58"), "utf8").trim();
  const svmSigner = await createKeyPairSignerFromBytes(base58.decode(buyerBase58));
  const operationId = `devnet-remote-e2e-${Date.now()}`;
  const agent = createRemoteAgent({
    gatewayBaseUrl: gatewayHttp.baseUrl,
    schemes: [{ network: SOLANA_DEVNET, client: new ExactSvmScheme(svmSigner) }],
    createOperationId: () => operationId,
    onPaymentCreationFailure: async (ctx) => {
      console.error(
        JSON.stringify({
          phase: "payment-creation-failure",
          error: ctx.error instanceof Error ? ctx.error.message : String(ctx.error)
        })
      );
    }
  });

  console.log(
    JSON.stringify(
      {
        phase: "devnet-remote-e2e-start",
        forceDeficit,
        drain: drainInfo
          ? {
              before: drainInfo.before.toString(),
              after: drainInfo.after.toString(),
              drained: drainInfo.drained.toString()
            }
          : null,
        tokenBalance: tokenBalance.toString(),
        gateway: gatewayHttp.baseUrl,
        merchant: merchantOrigin,
        facilitator: FACILITATOR_URL,
        operationId,
        integration: "@agenttab/fetch",
        embedsGateway: false
      },
      null,
      2
    )
  );

  try {
    const result = await purchasePaidResource(
      agent,
      `${merchantOrigin}/v1/market-snapshot`,
      { method: "GET" }
    );

    const events =
      result.execution &&
      typeof result.execution === "object" &&
      "events" in result.execution
        ? (result.execution as { events: Array<{ kind: string }> }).events.map(
            (event) => event.kind
          )
        : [];

    console.log(
      JSON.stringify(
        {
          phase: "devnet-remote-e2e-result",
          status: result.response.status,
          body: result.body,
          meta: result.meta,
          executionState:
            result.execution &&
            typeof result.execution === "object" &&
            "state" in result.execution
              ? (result.execution as { state: string }).state
              : null,
          events
        },
        null,
        2
      )
    );

    if (!result.response.ok) process.exit(1);
    if (result.meta?.auditRecorded !== true) process.exit(1);
    if (
      !(
        result.execution &&
        typeof result.execution === "object" &&
        "state" in result.execution &&
        (result.execution as { state: string }).state === "fulfilled"
      )
    ) {
      process.exit(1);
    }
    if (forceDeficit && !events.includes("funding.confirmed")) {
      console.error("Expected funding.confirmed on FORCE_DEFICIT Devnet remote path");
      process.exit(1);
    }
    if (!events.includes("resource.fulfilled")) {
      console.error("Expected resource.fulfilled");
      process.exit(1);
    }
  } finally {
    await gatewayHttp.close();
    await merchantHttp.close();
    gateway.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

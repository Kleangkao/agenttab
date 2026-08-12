import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  getOrCreateAssociatedTokenAccount
} from "@solana/spl-token";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import {
  createGatewayRuntime,
  createDemoPolicy,
  DevnetMintFundingAdapter,
  MockBalanceProvider,
  WSOL_MINT
} from "@agenttab/gateway";
import { createAgentTabFundingHook } from "@agenttab/x402";

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const RESOURCE_URL =
  process.env.RESOURCE_URL ?? "http://127.0.0.1:4021/v1/research";
/** Price charged by examples/devnet-paid-api (atomic). */
const PAYMENT_AMOUNT_ATOMIC = 1000n;
/** Leave this much tUSDC so policy sees a real deficit. */
const FORCE_DEFICIT_REMAINING = 100n;
const DATA_DIR = resolve(process.cwd(), "../../.data/devnet");

function readText(name: string): string {
  const path = resolve(DATA_DIR, name);
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  return readFileSync(path, "utf8").trim();
}

function loadKeypair(name: string): Keypair {
  const secret = Uint8Array.from(
    JSON.parse(readFileSync(resolve(DATA_DIR, name), "utf8")) as number[]
  );
  return Keypair.fromSecretKey(secret);
}

async function readTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch {
    return 0n;
  }
}

/**
 * Drain buyer tUSDC down to FORCE_DEFICIT_REMAINING so AgentTab must fund.
 * Excess goes to the merchant ATA (same disposable merchant wallet).
 */
async function forcePaymentDeficit(options: {
  connection: Connection;
  buyer: Keypair;
  merchant: PublicKey;
  mint: PublicKey;
}): Promise<{ before: bigint; after: bigint; drained: bigint }> {
  const before = await readTokenBalance(
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

  const after = await readTokenBalance(
    options.connection,
    options.buyer.publicKey,
    options.mint
  );
  return { before, after, drained: drainAmount };
}

function hashRequest(method: string, url: string): string {
  return `sha256:${createHash("sha256").update(`${method}\n${url}\n`).digest("hex")}`;
}

async function main(): Promise<void> {
  const forceDeficit = process.env.FORCE_DEFICIT !== "0";
  const mint = new PublicKey(process.env.DEVNET_TEST_USDC_MINT ?? readText("test-usdc-mint.txt"));
  const buyer = loadKeypair("buyer.json");
  const merchant = loadKeypair("merchant.json");
  const connection = new Connection(DEVNET_RPC_URL, "confirmed");

  let tokenBalance = await readTokenBalance(connection, buyer.publicKey, mint);
  let drainInfo: { before: bigint; after: bigint; drained: bigint } | null = null;

  if (forceDeficit) {
    if (tokenBalance < PAYMENT_AMOUNT_ATOMIC) {
      // Ensure we can leave remaining dust and still have a deficit path after mint-fund.
      // If underfunded for the drain scenario, mint enough to pay once after funding.
      const adapter = new DevnetMintFundingAdapter({
        connection,
        mintAuthority: buyer,
        paymentMint: mint,
        recipient: buyer.publicKey
      });
      await adapter.planExactDeficit({
        inputMint: WSOL_MINT,
        outputMint: mint.toBase58(),
        targetOutputAtomic: (PAYMENT_AMOUNT_ATOMIC + FORCE_DEFICIT_REMAINING).toString(),
        maxInputAtomic: "5000000000",
        userPublicKey: buyer.publicKey.toBase58()
      });
      tokenBalance = await readTokenBalance(connection, buyer.publicKey, mint);
    }
    drainInfo = await forcePaymentDeficit({
      connection,
      buyer,
      merchant: merchant.publicKey,
      mint
    });
    tokenBalance = drainInfo.after;
  }

  if (tokenBalance >= PAYMENT_AMOUNT_ATOMIC && forceDeficit) {
    throw new Error(
      `FORCE_DEFICIT failed: buyer still holds ${tokenBalance} (>= ${PAYMENT_AMOUNT_ATOMIC})`
    );
  }

  const merchantOrigin = new URL(RESOURCE_URL).origin;
  const policy = createDemoPolicy(merchantOrigin);
  policy.allowedNetworks = [SOLANA_DEVNET];
  policy.allowedPaymentAssets = [mint.toBase58()];
  policy.allowedFundingAssets = [WSOL_MINT, mint.toBase58()];

  const fundingAdapter = new DevnetMintFundingAdapter({
    connection,
    mintAuthority: buyer,
    paymentMint: mint,
    recipient: buyer.publicKey
  });

  const gateway = createGatewayRuntime({
    merchantOrigin,
    policy,
    wallet: buyer.publicKey.toBase58(),
    initialUsdcAtomic: "0",
    initialSolAtomic: "5000000000",
    fundingMode: "devnet-mint",
    dflowAdapter: fundingAdapter
  });
  if (!(gateway.balances instanceof MockBalanceProvider)) {
    throw new Error("Devnet agent expects MockBalanceProvider for mint seeding");
  }
  gateway.balances.upsert({
    mint: mint.toBase58(),
    symbol: "tUSDC",
    balanceAtomic: tokenBalance.toString(),
    verified: true
  });

  const operationId = process.env.OPERATION_ID ?? `devnet-research-${randomUUID()}`;
  const requestHash = hashRequest("GET", RESOURCE_URL);
  const merchantId = new URL(RESOURCE_URL).host;

  const svmSigner = await createKeyPairSignerFromBytes(base58.decode(readText("buyer.base58")));
  const client = new x402Client();
  client.register(SOLANA_DEVNET, new ExactSvmScheme(svmSigner));
  client.onBeforePaymentCreation(
    createAgentTabFundingHook({
      coordinator: gateway.coordinator,
      getRequestBinding: async () => ({ operationId, requestHash, merchantId }),
      getUsdValueMicros: async ({ amountAtomic }) => amountAtomic
    })
  );

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  console.log(
    JSON.stringify(
      {
        phase: "request",
        forceDeficit,
        buyer: buyer.publicKey.toBase58(),
        mint: mint.toBase58(),
        tokenBalance: tokenBalance.toString(),
        drain: drainInfo
          ? {
              before: drainInfo.before.toString(),
              after: drainInfo.after.toString(),
              drained: drainInfo.drained.toString()
            }
          : null,
        operationId,
        resourceUrl: RESOURCE_URL,
        fundingMode: "devnet-mint"
      },
      null,
      2
    )
  );

  const response = await fetchWithPayment(RESOURCE_URL, { method: "GET" });
  const paymentResponse =
    response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  const bodyText = await response.text();
  let body: unknown = bodyText;
  try {
    body = JSON.parse(bodyText);
  } catch {
    /* keep text */
  }

  const balanceAfterPay = await readTokenBalance(connection, buyer.publicKey, mint);

  console.log(
    JSON.stringify(
      {
        phase: "x402-result",
        status: response.status,
        paymentResponse: paymentResponse?.slice(0, 200) ?? null,
        body,
        balanceAfterPay: balanceAfterPay.toString(),
        fundingOrders: fundingAdapter.orders.map((order) => ({
          source: order.source,
          outputAmountAtomic: order.outputAmountAtomic,
          mintSignature: (JSON.parse(order.transaction) as { mintSignature?: string })
            .mintSignature
        }))
      },
      null,
      2
    )
  );

  if (!response.ok) {
    const execution = await gateway.store.get(operationId);
    console.error(
      JSON.stringify(
        {
          phase: "failed",
          executionState: execution?.state,
          events: execution?.events.map((event) => event.kind)
        },
        null,
        2
      )
    );
    gateway.close();
    process.exit(1);
  }

  const funded = await gateway.store.get(operationId);
  if (funded && (funded.state === "funded" || funded.state === "paid")) {
    if (funded.state === "funded") {
      await gateway.app.request(`/v1/executions/${operationId}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settlementId: paymentResponse ?? `devnet-${operationId}`,
          transaction: paymentResponse ?? undefined
        })
      });
    }
    await gateway.app.request(`/v1/executions/${operationId}/fulfill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ responseHash: hashRequest("RESPONSE", RESOURCE_URL) })
    });
  }

  const finalExecution = await gateway.store.get(operationId);
  const eventKinds = finalExecution?.events.map((event) => event.kind) ?? [];
  const fundedViaMint = eventKinds.includes("funding.confirmed");
  const skippedFunding = eventKinds.includes("funding.not_required");

  console.log(
    JSON.stringify(
      {
        phase: "audit",
        state: finalExecution?.state,
        events: finalExecution?.events.map((event) => ({ kind: event.kind, to: event.to })),
        assertions: {
          forceDeficit,
          fundedViaMint,
          skippedFunding,
          expectedPath: forceDeficit
            ? "insufficient → funding.confirmed → payment → fulfill"
            : "already_funded → payment → fulfill"
        }
      },
      null,
      2
    )
  );

  if (forceDeficit && !fundedViaMint) {
    console.error("Expected funding.confirmed on FORCE_DEFICIT path");
    gateway.close();
    process.exit(1);
  }

  gateway.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Mainnet no-broadcast preflight against the isolated buyer wallet.
 * Proves: DFlow exact-deficit order construction + simulateTransaction.
 * Never sends a transaction.
 *
 *   pnpm mainnet:setup
 *   pnpm mainnet:import-phantom   # if using Phantom via .env.local
 *   pnpm mainnet:preflight
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { DFlowClient } from "@agenttab/dflow";
import {
  fetchFacilitatorMinimum,
  LiveSimDFlowAdapter,
  MAINNET_MIN_TEST_PAYMENT_ATOMIC,
  resolveMainnetDflowBaseUrl,
  resolvePaymentAtomicFloor,
  SOLANA_MAINNET,
  USDC_MINT,
  WSOL_MINT,
  DEXTER_FACILITATOR_URL
} from "@agenttab/gateway";
import { parseEnvLocal } from "./phantom-import-lib.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA_DIR = resolve(ROOT, ".data/mainnet");
const ENV_LOCAL = resolve(ROOT, ".env.local");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const addressPath = resolve(DATA_DIR, "buyer.address.txt");
const buyerJsonPath = resolve(DATA_DIR, "buyer.json");

if (!existsSync(addressPath) || !existsSync(buyerJsonPath)) {
  console.error(
    "Missing .data/mainnet/buyer files — run pnpm mainnet:setup or pnpm mainnet:import-phantom"
  );
  process.exit(2);
}

const buyerFromFile = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(buyerJsonPath, "utf8")) as number[])
);
const buyerAddress = readFileSync(addressPath, "utf8").trim();
if (buyerFromFile.publicKey.toBase58() !== buyerAddress) {
  console.error(
    JSON.stringify({
      error: "buyer_address_mismatch",
      buyerJson: buyerFromFile.publicKey.toBase58(),
      buyerAddressFile: buyerAddress
    })
  );
  process.exit(2);
}

if (existsSync(ENV_LOCAL)) {
  const expected = parseEnvLocal(readFileSync(ENV_LOCAL, "utf8")).PHANTOM_EXPECTED_ADDRESS?.trim();
  if (expected && expected !== buyerAddress) {
    console.error(
      JSON.stringify({
        error: "env_expected_address_mismatch",
        buyerAddress,
        phantomExpectedAddress: expected
      })
    );
    process.exit(2);
  }
}

const buyer = new PublicKey(buyerAddress);
const connection = new Connection(RPC, "confirmed");
const solLamports = await connection.getBalance(buyer, "confirmed");
let usdcAtomic = "0";
try {
  const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), buyer);
  usdcAtomic = (await getAccount(connection, ata, "confirmed")).amount.toString();
} catch {
  usdcAtomic = "0";
}

const facilitatorUrl = process.env.FACILITATOR_URL ?? DEXTER_FACILITATOR_URL;
const liveMinimum = await fetchFacilitatorMinimum({ facilitatorUrl }).catch(
  (error: unknown) => ({
    facilitatorUrl,
    network: SOLANA_MAINNET,
    scheme: "exact",
    minPaymentAmountAtomic: MAINNET_MIN_TEST_PAYMENT_ATOMIC,
    minPaymentAmountUsd: null,
    error: error instanceof Error ? error.message : String(error)
  })
);
const targetOut = resolvePaymentAtomicFloor(
  process.env.MAINNET_PREFLIGHT_USDC_ATOMIC ?? MAINNET_MIN_TEST_PAYMENT_ATOMIC,
  liveMinimum.minPaymentAmountAtomic
);
const maxIn =
  solLamports > 0
    ? BigInt(solLamports).toString()
    : // Unfunded wallet: still request a tiny synthetic max so DFlow can build a tx for simulation.
      "50000000";

const dflowEndpoint = resolveMainnetDflowBaseUrl();
const adapter = new LiveSimDFlowAdapter({
  client: new DFlowClient({
    baseUrl: dflowEndpoint.baseUrl,
    ...(process.env.DFLOW_API_KEY ? { apiKey: process.env.DFLOW_API_KEY } : {})
  }),
  connection,
  failClosedOnSimulationError: false,
  maxQuoteRequests: 16
});

const order = await adapter
  .planExactDeficit({
    inputMint: WSOL_MINT,
    outputMint: USDC_MINT,
    targetOutputAtomic: targetOut,
    maxInputAtomic: maxIn,
    userPublicKey: buyer.toBase58(),
    slippageBps: 50
  })
  .catch((error: unknown) => {
    console.log(
      JSON.stringify(
        {
          phase: "mainnet-preflight",
          network: SOLANA_MAINNET,
          broadcastEnabled: false,
          buyer: buyer.toBase58(),
          dflow: dflowEndpoint,
          liveMinimum,
          balances: { solLamports, usdcAtomic },
          error: error instanceof Error ? error.message : String(error),
          interpretation:
            "DFlow quote/simulate failed. Retry later or set DFLOW_API_KEY for production quotes."
        },
        null,
        2
      )
    );
    process.exit(0);
  });

const plan = JSON.parse(order.transaction) as {
  broadcast: boolean;
  simulated: boolean;
  simulationOk: boolean;
  simulationError?: string;
  transactionByteLength: number;
};

console.log(
  JSON.stringify(
    {
      phase: "mainnet-preflight",
      network: SOLANA_MAINNET,
      broadcastEnabled: false,
      buyer: buyer.toBase58(),
      dflow: dflowEndpoint,
      liveMinimum,
      balances: {
        solLamports,
        usdcAtomic
      },
      targetUsdcAtomic: targetOut,
      order: {
        source: order.source,
        inputAmountAtomic: order.inputAmountAtomic,
        outputAmountAtomic: order.outputAmountAtomic,
        minimumOutputAtomic: order.minimumOutputAtomic,
        priceImpactPct: order.priceImpactPct
      },
      simulation: {
        broadcast: plan.broadcast,
        simulated: plan.simulated,
        simulationOk: plan.simulationOk,
        simulationError: plan.simulationError ?? null,
        transactionByteLength: plan.transactionByteLength
      },
      interpretation:
        solLamports === 0
          ? "Wallet unfunded: order+simulate proven; AccountNotFound/insufficient funds is expected until SOL is deposited."
          : plan.simulationOk
            ? "Simulation succeeded against funded wallet (still no broadcast)."
            : "Order built; simulation failed — inspect simulationError before any broadcast approval."
    },
    null,
    2
  )
);

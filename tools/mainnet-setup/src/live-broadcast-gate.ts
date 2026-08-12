/**
 * Immediate pre-broadcast live gate. Exits 0 only if the plan still matches
 * the validated Mainnet test envelope. Never broadcasts.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DFlowClient } from "@agenttab/dflow";
import {
  DEXTER_FACILITATOR_URL,
  LiveSimDFlowAdapter,
  MAINNET_MIN_TEST_PAYMENT_ATOMIC,
  USDC_MINT,
  WSOL_MINT,
  evaluateBroadcastGate,
  fetchFacilitatorMinimum,
  resolveMainnetDflowBaseUrl,
  resolvePaymentAtomicFloor
} from "@agenttab/gateway";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA = resolve(ROOT, ".data/mainnet");

const buyer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(resolve(DATA, "buyer.json"), "utf8")) as number[])
);
const addrFile = readFileSync(resolve(DATA, "buyer.address.txt"), "utf8").trim();
const merchant = readFileSync(resolve(DATA, "merchant.address.txt"), "utf8").trim();
const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const expected = (env.match(/^PHANTOM_EXPECTED_ADDRESS=(.*)$/m) ?? [])[1]?.trim();
if (env.includes("PHANTOM_SOLANA_PRIVATE_KEY=")) {
  throw new Error("PHANTOM_SOLANA_PRIVATE_KEY still present in .env.local");
}
if (buyer.publicKey.toBase58() !== addrFile || addrFile !== expected) {
  throw new Error("buyer identity mismatch across json/address/.env.local");
}

const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  "confirmed"
);
const sol = await connection.getBalance(buyer.publicKey, "confirmed");
let usdc = "0";
try {
  usdc = (
    await getAccount(
      connection,
      getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), buyer.publicKey),
      "confirmed"
    )
  ).amount.toString();
} catch {
  usdc = "0";
}

const facilitatorUrl =
  process.env.FACILITATOR_URL ?? DEXTER_FACILITATOR_URL;
let liveMin;
try {
  liveMin = await fetchFacilitatorMinimum({ facilitatorUrl });
} catch {
  // PayAI currently omits an explicit Mainnet exact floor; use Dexter's advertised floor.
  liveMin = await fetchFacilitatorMinimum({ facilitatorUrl: DEXTER_FACILITATOR_URL });
  liveMin = { ...liveMin, facilitatorUrl };
}
const payment = resolvePaymentAtomicFloor(
  MAINNET_MIN_TEST_PAYMENT_ATOMIC,
  liveMin.minPaymentAmountAtomic
);
const paid = (await fetch("http://127.0.0.1:4022/health").then((r) => r.json())) as {
  priceAtomic: string;
  facilitatorUrl: string;
  merchant: string;
};
const dflow = resolveMainnetDflowBaseUrl();
const adapter = new LiveSimDFlowAdapter({
  client: new DFlowClient({
    baseUrl: dflow.baseUrl,
    ...(process.env.DFLOW_API_KEY ? { apiKey: process.env.DFLOW_API_KEY } : {})
  }),
  connection,
  failClosedOnSimulationError: true,
  allowBroadcastInPlan: true,
  maxQuoteRequests: 16
});
const order = await adapter.planExactDeficit({
  inputMint: WSOL_MINT,
  outputMint: USDC_MINT,
  targetOutputAtomic: payment,
  maxInputAtomic: BigInt(sol).toString(),
  userPublicKey: buyer.publicKey.toBase58(),
  slippageBps: 50
});
const plan = JSON.parse(order.transaction) as {
  type: string;
  broadcast: boolean;
  simulationOk: boolean;
  simulationError?: string;
};
const { ok, abortReasons } = evaluateBroadcastGate({
  solLamports: sol,
  usdcAtomic: usdc,
  paymentAtomic: payment,
  facilitatorMinAtomic: liveMin.minPaymentAmountAtomic,
  priceImpactPct: Number(order.priceImpactPct),
  fundingInputAtomic: order.inputAmountAtomic,
  simulationOk: plan.simulationOk === true,
  planBroadcast: plan.broadcast === true,
  planType: plan.type,
  merchantPriceAtomic: paid.priceAtomic,
  merchantFacilitatorUrl: paid.facilitatorUrl,
  expectedFacilitatorUrl: facilitatorUrl,
  merchantAddress: paid.merchant,
  expectedMerchantAddress: merchant
});

const gate = {
  ok,
  abortReasons,
  buyer: buyer.publicKey.toBase58(),
  balances: { solLamports: sol, usdcAtomic: usdc },
  liveMinimum: liveMin,
  paymentAtomic: payment,
  dflow,
  order: {
    inputAmountAtomic: order.inputAmountAtomic,
    outputAmountAtomic: order.outputAmountAtomic,
    priceImpactPct: order.priceImpactPct,
    source: order.source
  },
  plan: {
    type: plan.type,
    broadcast: plan.broadcast,
    simulationOk: plan.simulationOk,
    simulationError: plan.simulationError ?? null
  },
  paidApi: paid
};

console.log(JSON.stringify(gate, null, 2));
process.exit(gate.ok ? 0 : 2);

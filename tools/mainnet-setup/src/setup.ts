/**
 * Creates an isolated Solana Mainnet buyer (and optional merchant) wallet.
 * Secrets stay under gitignored `.data/mainnet/`. Never prints private keys.
 *
 * Usage:
 *   pnpm mainnet:setup
 *   pnpm mainnet:setup -- --show-address
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA_DIR = resolve(ROOT, ".data/mainnet");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const showAddress = process.argv.includes("--show-address");

mkdirSync(DATA_DIR, { recursive: true });

function loadOrCreate(name: string): Keypair {
  const jsonPath = resolve(DATA_DIR, `${name}.json`);
  if (existsSync(jsonPath)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(jsonPath, "utf8"))));
  }
  const kp = Keypair.generate();
  writeFileSync(jsonPath, JSON.stringify([...kp.secretKey]));
  writeFileSync(resolve(DATA_DIR, `${name}.address.txt`), kp.publicKey.toBase58());
  rmSync(resolve(DATA_DIR, `${name}.base58`), { force: true });
  return kp;
}

async function tokenBalance(connection: Connection, owner: PublicKey): Promise<string> {
  try {
    const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner);
    const account = await getAccount(connection, ata, "confirmed");
    return account.amount.toString();
  } catch {
    return "0";
  }
}

const buyer = loadOrCreate("buyer");
const merchant = loadOrCreate("merchant");
const connection = new Connection(RPC, "confirmed");

const [buyerSol, merchantSol, buyerUsdc, merchantUsdc] = await Promise.all([
  connection.getBalance(buyer.publicKey, "confirmed"),
  connection.getBalance(merchant.publicKey, "confirmed"),
  tokenBalance(connection, buyer.publicKey),
  tokenBalance(connection, merchant.publicKey)
]);

const policyPath = resolve(DATA_DIR, "policy.mainnet.json");
if (!existsSync(policyPath)) {
  const policy = {
    mode: "autopay",
    allowedMerchantOrigins: ["http://127.0.0.1:4022"],
    allowedNetworks: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
    allowedPaymentAssets: [USDC_MINT],
    allowedFundingAssets: ["So11111111111111111111111111111111111111112"],
    requireVerifiedFundingAssets: true,
    maxPaymentUsdMicros: "10000",
    maxDailyUsdMicros: "50000",
    requireApprovalAboveUsdMicros: "100000000",
    maxSlippageBps: 50,
    maxPriceImpactPct: 1,
    notes:
      "Mainnet oneshot default: autopay within $0.01/$0.05 caps. Set mode=approve to require POST /v1/approvals."
  };
  writeFileSync(policyPath, JSON.stringify(policy, null, 2));
}

const summary = {
  ok: true,
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  rpc: RPC,
  dataDir: ".data/mainnet/ (gitignored)",
  secretsWritten: !showAddress
    ? "local only — not printed"
    : "local only — addresses shown below",
  buyer: {
    address: buyer.publicKey.toBase58(),
    solLamports: buyerSol,
    sol: buyerSol / LAMPORTS_PER_SOL,
    usdcAtomic: buyerUsdc
  },
  merchant: {
    address: merchant.publicKey.toBase58(),
    solLamports: merchantSol,
    sol: merchantSol / LAMPORTS_PER_SOL,
    usdcAtomic: merchantUsdc
  },
  policyPath: ".data/mainnet/policy.mainnet.json",
  preferredFacilitator: "https://x402.dexter.cash",
  backupFacilitator: "https://facilitator.payai.network",
  rpcDefault: RPC,
  broadcastEnabled: false,
  nextSteps: [
    "Do not fund until the agent stops and requests funding with a final checklist.",
    "Preferred first proof: SOL-only buyer balance → DFlow exact-deficit USDC → tiny Mainnet x402 pay.",
    "Production facilitators (not x402.org): https://x402.dexter.cash (preferred) or https://facilitator.payai.network"
  ]
};

if (!showAddress) {
  // Keep address available in files; omit from default stdout until funding is requested.
  summary.buyer = {
    ...summary.buyer,
    address: "(see .data/mainnet/buyer.address.txt — pass --show-address to print)"
  } as typeof summary.buyer;
  summary.merchant = {
    ...summary.merchant,
    address: "(see .data/mainnet/merchant.address.txt — pass --show-address to print)"
  } as typeof summary.merchant;
}

console.log(JSON.stringify(summary, null, 2));

/**
 * Creates disposable Devnet buyer/merchant wallets and a test SPL mint.
 * Secrets stay under gitignored `.data/devnet/`.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount
} from "@solana/spl-token";
import bs58 from "bs58";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA_DIR = resolve(ROOT, ".data/devnet");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

mkdirSync(DATA_DIR, { recursive: true });

function loadOrCreate(name: string): Keypair {
  const jsonPath = resolve(DATA_DIR, `${name}.json`);
  if (existsSync(jsonPath)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(jsonPath, "utf8"))));
  }
  const kp = Keypair.generate();
  writeFileSync(jsonPath, JSON.stringify([...kp.secretKey]));
  writeFileSync(resolve(DATA_DIR, `${name}.address.txt`), kp.publicKey.toBase58());
  writeFileSync(resolve(DATA_DIR, `${name}.base58`), bs58.encode(kp.secretKey));
  return kp;
}

const buyer = loadOrCreate("buyer");
const merchant = loadOrCreate("merchant");
const connection = new Connection(RPC, "confirmed");

const buyerSol = await connection.getBalance(buyer.publicKey);
const merchantSol = await connection.getBalance(merchant.publicKey);
console.log(
  JSON.stringify(
    {
      rpc: RPC,
      buyer: buyer.publicKey.toBase58(),
      merchant: merchant.publicKey.toBase58(),
      buyerSol,
      merchantSol
    },
    null,
    2
  )
);

if (buyerSol < 0.05 * LAMPORTS_PER_SOL) {
  console.error(
    "Buyer needs Devnet SOL for mint/ATA rent. Fund .data/devnet/buyer.address.txt then re-run."
  );
  process.exit(2);
}

const mintPath = resolve(DATA_DIR, "test-usdc-mint.txt");
let mintPubkey: PublicKey;
if (existsSync(mintPath)) {
  mintPubkey = new PublicKey(readFileSync(mintPath, "utf8").trim());
  console.log("reusing mint", mintPubkey.toBase58());
} else {
  mintPubkey = await createMint(connection, buyer, buyer.publicKey, null, 6);
  writeFileSync(mintPath, mintPubkey.toBase58());
  console.log("created mint", mintPubkey.toBase58());
}

const buyerAta = await getOrCreateAssociatedTokenAccount(
  connection,
  buyer,
  mintPubkey,
  buyer.publicKey
);
await getOrCreateAssociatedTokenAccount(connection, buyer, mintPubkey, merchant.publicKey);

if (buyerAta.amount < 1_000_000n) {
  const sig = await mintTo(connection, buyer, mintPubkey, buyerAta.address, buyer, 10_000_000n);
  console.log("minted tUSDC", sig);
}

const refreshed = await getAccount(connection, buyerAta.address);
console.log(
  JSON.stringify(
    {
      ok: true,
      mint: mintPubkey.toBase58(),
      buyerTokenBalance: refreshed.amount.toString()
    },
    null,
    2
  )
);

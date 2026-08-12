/**
 * Local-only Phantom buyer import for AgentTab Mainnet.
 *
 * Preferred source: gitignored `.env.local` with:
 *   PHANTOM_EXPECTED_ADDRESS=...
 *   PHANTOM_SOLANA_PRIVATE_KEY=...
 *
 * Fallback: interactive prompts (public address visible, private key hidden).
 *
 * Verifies derived public address exactly matches before writing the standard
 * Solana JSON keypair file expected by the current signer.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  archiveGeneratedBuyerIfDifferent,
  keypairFromPhantomPrivateKey,
  loadPhantomCredentialsFromEnv,
  parseEnvLocal,
  writeMainnetBuyerKeypair
} from "./phantom-import-lib.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA_DIR = resolve(ROOT, ".data/mainnet");
const ENV_LOCAL = resolve(ROOT, ".env.local");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function askVisible(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolveAnswer) =>
    rl.question(prompt, (answer) => {
      rl.close();
      resolveAnswer(answer.trim());
    })
  );
}

async function askHidden(prompt: string): Promise<string> {
  return new Promise((resolveAnswer) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(prompt);
    stdin.resume();
    stdin.setEncoding("utf8");
    if (stdin.isTTY) stdin.setRawMode(true);
    let buffer = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdout.write("\n");
          stdin.removeListener("data", onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          resolveAnswer(buffer.trim());
          return;
        }
        if (char === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function loadCredentials(): Promise<{
  expectedAddress: string;
  privateKeyBase58: string;
  source: string;
}> {
  if (existsSync(ENV_LOCAL)) {
    const parsed = parseEnvLocal(readFileSync(ENV_LOCAL, "utf8"));
    const creds = loadPhantomCredentialsFromEnv(parsed, ".env.local");
    return {
      expectedAddress: creds.expectedAddress,
      privateKeyBase58: creds.privateKeyBase58,
      source: creds.sourcePath
    };
  }
  if (process.env.PHANTOM_EXPECTED_ADDRESS && process.env.PHANTOM_SOLANA_PRIVATE_KEY) {
    const creds = loadPhantomCredentialsFromEnv(process.env, "process.env");
    return {
      expectedAddress: creds.expectedAddress,
      privateKeyBase58: creds.privateKeyBase58,
      source: creds.sourcePath
    };
  }
  const expectedAddress = await askVisible("Phantom public address to import: ");
  const privateKeyBase58 = await askHidden(
    "Phantom exported Solana private key (hidden): "
  );
  return { expectedAddress, privateKeyBase58, source: "interactive-prompt" };
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

async function main(): Promise<void> {
  const creds = await loadCredentials();
  const buyer = keypairFromPhantomPrivateKey(
    creds.privateKeyBase58,
    creds.expectedAddress
  );
  const archived = archiveGeneratedBuyerIfDifferent(
    DATA_DIR,
    buyer.publicKey.toBase58()
  );
  const written = writeMainnetBuyerKeypair(DATA_DIR, buyer);
  const connection = new Connection(RPC, "confirmed");
  const [solLamports, usdcAtomic] = await Promise.all([
    connection.getBalance(buyer.publicKey, "confirmed"),
    tokenBalance(connection, buyer.publicKey)
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        imported: "buyer",
        credentialSource: creds.source,
        buyerAddress: buyer.publicKey.toBase58(),
        addressVerified: true,
        buyerJsonPath: written.jsonPath,
        buyerAddressPath: written.addressPath,
        archivedPreviousBuyer: archived,
        removedLegacyBase58File: !existsSync(written.removedBase58Path),
        rpc: RPC,
        solLamports,
        sol: solLamports / LAMPORTS_PER_SOL,
        usdcAtomic,
        deficitPathLikely: BigInt(usdcAtomic) < 1000n,
        note:
          "Imported locally after address verification. Secrets were not printed."
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

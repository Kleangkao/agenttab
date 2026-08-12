import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

export interface PhantomEnvCredentials {
  expectedAddress: string;
  privateKeyBase58: string;
  sourcePath: string;
}

export function parseEnvLocal(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadPhantomCredentialsFromEnv(
  env: Record<string, string | undefined>,
  sourcePath = "process.env"
): PhantomEnvCredentials {
  const expectedAddress = (env.PHANTOM_EXPECTED_ADDRESS ?? "").trim();
  const privateKeyBase58 = (env.PHANTOM_SOLANA_PRIVATE_KEY ?? "").trim();
  if (!expectedAddress) {
    throw new Error(`Missing PHANTOM_EXPECTED_ADDRESS in ${sourcePath}`);
  }
  if (!privateKeyBase58) {
    throw new Error(`Missing PHANTOM_SOLANA_PRIVATE_KEY in ${sourcePath}`);
  }
  return { expectedAddress, privateKeyBase58, sourcePath };
}

export function decodePhantomPrivateKeyBase58(input: string): Uint8Array {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Phantom private key is empty");
  }
  const decoded = bs58.decode(trimmed);
  if (decoded.length !== 64) {
    throw new Error(
      `Phantom Solana private key must decode to 64 bytes, got ${decoded.length}`
    );
  }
  return decoded;
}

export function keypairFromPhantomPrivateKey(
  privateKeyBase58: string,
  expectedAddress: string
): Keypair {
  const secretKey = decodePhantomPrivateKeyBase58(privateKeyBase58);
  const keypair = Keypair.fromSecretKey(secretKey);
  const derivedAddress = keypair.publicKey.toBase58();
  if (derivedAddress !== expectedAddress.trim()) {
    throw new Error(
      `Derived public address ${derivedAddress} does not match expected Phantom address ${expectedAddress.trim()}`
    );
  }
  return keypair;
}

export function archiveGeneratedBuyerIfDifferent(
  dataDir: string,
  nextAddress: string
): string | null {
  const jsonPath = resolve(dataDir, "buyer.json");
  const addressPath = resolve(dataDir, "buyer.address.txt");
  if (!existsSync(jsonPath) || !existsSync(addressPath)) return null;
  const previous = readFileSync(addressPath, "utf8").trim();
  if (previous === nextAddress) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = resolve(dataDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  const archivedJson = resolve(archiveDir, `buyer.generated.${stamp}.json`);
  const archivedAddress = resolve(archiveDir, `buyer.generated.${stamp}.address.txt`);
  renameSync(jsonPath, archivedJson);
  renameSync(addressPath, archivedAddress);
  rmSync(resolve(dataDir, "buyer.base58"), { force: true });
  return archivedJson;
}

export function writeMainnetBuyerKeypair(
  dataDir: string,
  keypair: Keypair
): { jsonPath: string; addressPath: string; removedBase58Path: string } {
  mkdirSync(dataDir, { recursive: true });
  const jsonPath = resolve(dataDir, "buyer.json");
  const addressPath = resolve(dataDir, "buyer.address.txt");
  const removedBase58Path = resolve(dataDir, "buyer.base58");
  writeFileSync(jsonPath, JSON.stringify([...keypair.secretKey]), {
    mode: 0o600
  });
  writeFileSync(addressPath, keypair.publicKey.toBase58(), {
    mode: 0o600
  });
  rmSync(removedBase58Path, { force: true });
  return { jsonPath, addressPath, removedBase58Path };
}

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Solana Devnet CAIP-2 (official x402 / CDP docs). */
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export const FACILITATOR_URL = "https://x402.org/facilitator";
export const DEVNET_RPC_URL = "https://api.devnet.solana.com";

export const DEVNET_DATA_DIR = resolve(process.cwd(), "../../.data/devnet");

export function readDevnetFile(name: string): string {
  const path = resolve(DEVNET_DATA_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Missing Devnet artifact: ${path}. Run tools/devnet-setup first.`);
  }
  return readFileSync(path, "utf8").trim();
}

export function readMerchantAddress(): string {
  return readDevnetFile("merchant.address.txt");
}

export function readTestUsdcMint(): string {
  return readDevnetFile("test-usdc-mint.txt");
}

/** 0.001 test-USDC (6 decimals). */
export const DEVNET_PRICE = {
  amount: "1000",
  asset: "" // filled at runtime from mint file
} as const;

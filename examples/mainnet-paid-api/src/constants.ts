import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Dexter live /supported Mainnet exact floor is 800 atomic; charge 1000 ($0.001). */
export const MAINNET_PRICE_ATOMIC = "1000";

/**
 * Prefer Dexter for Solana Mainnet: public, gas-sponsored, documented min amount,
 * high settlement volume. Override with FACILITATOR_URL if needed (e.g. PayAI).
 */
export const DEFAULT_FACILITATOR_URL = "https://x402.dexter.cash";

const DATA_DIR = resolve(process.cwd(), "../../.data/mainnet");

export function readMerchantAddress(): string {
  if (process.env.SVM_ADDRESS) return process.env.SVM_ADDRESS;
  const path = resolve(DATA_DIR, "merchant.address.txt");
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run pnpm mainnet:setup first.`);
  }
  return readFileSync(path, "utf8").trim();
}

/** Mainnet USDC. 6 decimals, so atomic units map 1:1 to USD micros. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function isSixDecimalUsdStablecoin(mint: string): boolean {
  return mint === USDC_MINT;
}

/**
 * Many Solana USDC-class assets use 6 decimals, so atomic units map 1:1 to USD micros.
 * Use only when the payment asset is a 6-decimal USD stablecoin; otherwise supply a
 * real price oracle via `getUsdValueMicros`.
 */
export function stablecoinAtomicAsUsdMicros(amountAtomic: string): string {
  if (!/^\d+$/.test(amountAtomic)) {
    throw new Error(`stablecoinAtomicAsUsdMicros: invalid atomic amount ${amountAtomic}`);
  }
  return amountAtomic;
}

/** Default USD micros for known 6-decimal USDC. Other mints stay unknown (fail-closed). */
export function defaultUsdMicrosForPayment(input: {
  assetMint: string;
  amountAtomic: string;
}): string | undefined {
  if (!isSixDecimalUsdStablecoin(input.assetMint)) return undefined;
  return stablecoinAtomicAsUsdMicros(input.amountAtomic);
}

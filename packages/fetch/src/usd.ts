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

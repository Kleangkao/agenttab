export interface TokenBalance {
  mint: string;
  symbol: string;
  balanceAtomic: string;
  verified: boolean;
}

/** Sync balance view used by the funding coordinator. */
export interface BalanceProvider {
  list(): TokenBalance[];
  get(mint: string): TokenBalance | undefined;
  applyDelta(mint: string, deltaAtomic: bigint): void;
}

export class MockBalanceProvider implements BalanceProvider {
  readonly #balances: Map<string, TokenBalance>;

  constructor(initial: TokenBalance[]) {
    this.#balances = new Map(initial.map((balance) => [balance.mint, { ...balance }]));
  }

  list(): TokenBalance[] {
    return [...this.#balances.values()].map((balance) => ({ ...balance }));
  }

  get(mint: string): TokenBalance | undefined {
    const balance = this.#balances.get(mint);
    return balance === undefined ? undefined : { ...balance };
  }

  upsert(balance: TokenBalance): void {
    this.#balances.set(balance.mint, { ...balance });
  }

  setBalance(mint: string, balanceAtomic: string): void {
    const current = this.#balances.get(mint);
    if (current === undefined) {
      throw new Error(`Unknown mint: ${mint}`);
    }
    this.#balances.set(mint, { ...current, balanceAtomic });
  }

  applyDelta(mint: string, deltaAtomic: bigint): void {
    const current = this.get(mint);
    if (current === undefined) throw new Error(`Unknown mint: ${mint}`);
    const next = BigInt(current.balanceAtomic) + deltaAtomic;
    if (next < 0n) throw new Error(`Insufficient balance for ${mint}`);
    this.setBalance(mint, next.toString());
  }
}

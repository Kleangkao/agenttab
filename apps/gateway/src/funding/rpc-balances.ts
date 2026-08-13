import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount
} from "@solana/spl-token";
import type { BalanceProvider, TokenBalance } from "./mock-balances.js";
import { WSOL_MINT } from "../constants.js";

export interface RpcBalanceProviderOptions {
  connection: Connection;
  owner: PublicKey;
  /** Extra SPL mints to track besides native SOL (represented as WSOL mint). */
  splMints?: Array<{ mint: string; symbol: string }>;
}

/**
 * Reads live Solana balances into a sync cache for policy/funding decisions.
 * Native SOL is exposed under the WSOL mint id used by the coordinator funding path.
 * Call `refresh()` before each funding decision when using live RPC.
 */
export class RpcBalanceProvider implements BalanceProvider {
  readonly #connection: Connection;
  readonly #owner: PublicKey;
  readonly #splMints: Array<{ mint: string; symbol: string }>;
  readonly #cache = new Map<string, TokenBalance>();

  constructor(options: RpcBalanceProviderOptions) {
    this.#connection = options.connection;
    this.#owner = options.owner;
    this.#splMints = options.splMints ?? [];
  }

  async refresh(): Promise<TokenBalance[]> {
    const solLamports = await this.#connection.getBalance(this.#owner, "confirmed");
    this.#cache.set(WSOL_MINT, {
      mint: WSOL_MINT,
      symbol: "SOL",
      balanceAtomic: BigInt(solLamports).toString(),
      verified: true
    });

    for (const { mint, symbol } of this.#splMints) {
      let amount = 0n;
      try {
        const ata = getAssociatedTokenAddressSync(new PublicKey(mint), this.#owner);
        amount = (await getAccount(this.#connection, ata, "confirmed")).amount;
      } catch {
        amount = 0n;
      }
      this.#cache.set(mint, {
        mint,
        symbol,
        balanceAtomic: amount.toString(),
        verified: true
      });
    }

    try {
      const parsed = await this.#connection.getParsedTokenAccountsByOwner(this.#owner, {
        programId: TOKEN_PROGRAM_ID
      });
      for (const { account } of parsed.value) {
        const info = (
          account.data as {
            parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } };
          }
        ).parsed?.info;
        const mint = info?.mint;
        const raw = info?.tokenAmount?.amount;
        if (typeof mint !== "string" || mint.length < 16 || typeof raw !== "string") continue;
        if (this.#cache.has(mint)) continue;
        if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) continue;
        this.#cache.set(mint, {
          mint,
          symbol: mint.slice(0, 4),
          balanceAtomic: raw,
          verified: true
        });
      }
    } catch {
      // Configured mints still stand; discovery is best-effort.
    }
    return this.list();
  }

  list(): TokenBalance[] {
    return [...this.#cache.values()].map((balance) => ({ ...balance }));
  }

  get(mint: string): TokenBalance | undefined {
    const balance = this.#cache.get(mint);
    return balance === undefined ? undefined : { ...balance };
  }

  applyDelta(mint: string, deltaAtomic: bigint): void {
    // RPC balances are refreshed from chain. Optimistic cache mutation would create
    // false "funded" certainty before confirm; keep applyDelta as a no-op.
    void mint;
    void deltaAtomic;
  }

  get owner(): string {
    return this.#owner.toBase58();
  }
}

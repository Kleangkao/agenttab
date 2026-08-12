import type { MinimumInputPlan } from "@agenttab/dflow";
import {
  Connection,
  Keypair,
  PublicKey
} from "@solana/web3.js";
import {
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo
} from "@solana/spl-token";
import type { DeficitFundingAdapter, FundingOrder, PlanExactDeficitInput } from "./types.js";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DevnetMintFundingAdapterOptions {
  connection: Connection;
  /** Mint authority / fee payer for the test SPL mint. */
  mintAuthority: Keypair;
  /** Token mint to top up (Devnet test USDC). */
  paymentMint: PublicKey;
  /** Wallet that receives the minted deficit (buyer). */
  recipient: PublicKey;
}

/**
 * Devnet-only funding stand-in for DFlow.
 *
 * DFlow has no Devnet market for custom test mints, so this adapter mints the
 * exact payment deficit to the buyer ATA. That lets AgentTab prove
 * insufficient → fund → real x402 settlement on Devnet without mainnet funds.
 */
export class DevnetMintFundingAdapter implements DeficitFundingAdapter {
  readonly #connection: Connection;
  readonly #mintAuthority: Keypair;
  readonly #paymentMint: PublicKey;
  readonly #recipient: PublicKey;
  readonly orders: FundingOrder[] = [];

  constructor(options: DevnetMintFundingAdapterOptions) {
    this.#connection = options.connection;
    this.#mintAuthority = options.mintAuthority;
    this.#paymentMint = options.paymentMint;
    this.#recipient = options.recipient;
  }

  async planExactDeficit(input: PlanExactDeficitInput): Promise<FundingOrder> {
    if (input.outputMint !== this.#paymentMint.toBase58()) {
      throw new Error(
        `Devnet mint adapter only funds ${this.#paymentMint.toBase58()}, got ${input.outputMint}`
      );
    }
    if (input.userPublicKey !== this.#recipient.toBase58()) {
      throw new Error("Devnet mint adapter recipient mismatch");
    }

    const deficit = BigInt(input.targetOutputAtomic);
    if (deficit <= 0n) {
      throw new Error("targetOutputAtomic must be positive");
    }

    const ata = await getOrCreateAssociatedTokenAccount(
      this.#connection,
      this.#mintAuthority,
      this.#paymentMint,
      this.#recipient
    );

    let balanceBefore = 0n;
    try {
      balanceBefore = (await getAccount(this.#connection, ata.address)).amount;
    } catch {
      balanceBefore = 0n;
    }

    const signature = await mintTo(
      this.#connection,
      this.#mintAuthority,
      this.#paymentMint,
      ata.address,
      this.#mintAuthority,
      deficit,
      undefined,
      { commitment: "confirmed" }
    );

    await this.#connection.confirmTransaction(signature, "confirmed");

    // Ensure the payment signer sees the funded balance before x402 builds the tx.
    const target = balanceBefore + deficit;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = (await getAccount(this.#connection, ata.address, "confirmed")).amount;
      if (current >= target) break;
      if (attempt === 19) {
        throw new Error(
          `Devnet mint not visible after confirm: have ${current}, need ${target}`
        );
      }
      await sleep(250);
    }

    const plan: MinimumInputPlan = {
      inputAmountAtomic: "0",
      expectedOutputAtomic: deficit.toString(),
      minimumOutputAtomic: deficit.toString(),
      priceImpactPct: "0",
      quoteRequests: 0,
      minimized: true
    };

    const order: FundingOrder = {
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      inputAmountAtomic: "0",
      outputAmountAtomic: deficit.toString(),
      minimumOutputAtomic: deficit.toString(),
      priceImpactPct: "0",
      transaction: JSON.stringify({
        type: "devnet-mint-plan",
        network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        userPublicKey: input.userPublicKey,
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        inAmount: "0",
        outAmount: deficit.toString(),
        minOutAmount: deficit.toString(),
        mintSignature: signature,
        recipientAta: ata.address.toBase58()
      }),
      plan,
      source: "devnet-mint"
    };
    this.orders.push(order);
    return order;
  }
}

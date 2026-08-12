import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  VersionedTransaction
} from "@solana/web3.js";
import type { SignableFundingPlan, SignerBoundary } from "./simulated.js";
import { assertFundingPlanTransactionIntegrity } from "../funding/plan-integrity.js";

export interface LocalKeypairSignerOptions {
  keypair: Keypair;
  connection: Connection;
  /**
   * Must be explicitly true to call sendRawTransaction.
   * Default false: sign locally only, never broadcast.
   */
  broadcastEnabled?: boolean;
}

/**
 * Local keypair signer for Mainnet/Devnet funding transactions.
 *
 * Safety defaults:
 * - broadcastEnabled=false → deserialize + sign only, never send
 * - refuses plans that request broadcast=true unless broadcastEnabled
 * - never logs or returns the private key
 */
export class LocalKeypairSigner implements SignerBoundary {
  readonly #keypair: Keypair;
  readonly #connection: Connection;
  readonly #broadcastEnabled: boolean;

  constructor(options: LocalKeypairSignerOptions) {
    this.#keypair = options.keypair;
    this.#connection = options.connection;
    this.#broadcastEnabled = options.broadcastEnabled ?? false;
  }

  get publicKey(): string {
    return this.#keypair.publicKey.toBase58();
  }

  get broadcastEnabled(): boolean {
    return this.#broadcastEnabled;
  }

  static fromSecretKeyFile(
    path: string,
    connection: Connection,
    broadcastEnabled = false
  ): LocalKeypairSigner {
    const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
    return new LocalKeypairSigner({
      keypair: Keypair.fromSecretKey(secret),
      connection,
      broadcastEnabled
    });
  }

  async signFundingTransaction(plan: SignableFundingPlan): Promise<{ signature: string }> {
    const parsed = JSON.parse(plan.transaction) as {
      type?: string;
      broadcast?: boolean;
      userPublicKey?: string;
      inputMint?: string;
      outputMint?: string;
      inAmount?: string;
      minOutAmount?: string;
      serializedTransaction?: string;
      simulated?: boolean;
      simulationOk?: boolean;
      transactionSha256?: string;
    };

    if (parsed.type !== "live-sim-plan" && parsed.type !== "live-funding-plan") {
      throw new Error(`LocalKeypairSigner does not support plan type: ${parsed.type}`);
    }
    assertFundingPlanTransactionIntegrity(parsed);
    if (parsed.userPublicKey !== plan.wallet) {
      throw new Error("Funding transaction wallet mismatch");
    }
    if (parsed.userPublicKey !== this.#keypair.publicKey.toBase58()) {
      throw new Error("Funding transaction is not for this local keypair");
    }
    if (parsed.inputMint !== plan.inputMint || parsed.outputMint !== plan.outputMint) {
      throw new Error("Funding transaction mint mismatch");
    }
    if (parsed.inAmount !== plan.inputAmountAtomic) {
      throw new Error("Funding transaction input amount mismatch");
    }
    if (parsed.minOutAmount !== plan.minimumOutputAtomic) {
      throw new Error("Funding transaction min-out mismatch");
    }
    if (!parsed.serializedTransaction) {
      throw new Error("Funding plan missing serializedTransaction");
    }
    if (parsed.type === "live-funding-plan") {
      if (parsed.broadcast !== true) {
        throw new Error("live-funding-plan must set broadcast=true");
      }
      if (!this.#broadcastEnabled) {
        throw new Error(
          "live-funding-plan requires LocalKeypairSigner.broadcastEnabled=true (AGENTTAB_BROADCAST=1 only after explicit approval)"
        );
      }
      if (parsed.simulationOk !== true) {
        throw new Error("Refusing to broadcast a plan that did not simulate successfully");
      }
    }
    if (parsed.type === "live-sim-plan" && parsed.broadcast !== false) {
      throw new Error("live-sim-plan must set broadcast=false");
    }

    const tx = VersionedTransaction.deserialize(
      Buffer.from(parsed.serializedTransaction, "base64")
    );
    tx.sign([this.#keypair]);

    if (parsed.type === "live-sim-plan" || !this.#broadcastEnabled || parsed.broadcast !== true) {
      const sigBytes = tx.signatures[0];
      const sig =
        sigBytes !== undefined
          ? Buffer.from(sigBytes).toString("base64url")
          : `signed-${plan.operationId}`;
      return { signature: `local-signed-nobroadcast-${sig.slice(0, 32)}` };
    }

    const signature = await this.#connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed"
    });
    const latest = await this.#connection.getLatestBlockhash("confirmed");
    await this.#connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight
      },
      "confirmed"
    );
    return { signature };
  }
}

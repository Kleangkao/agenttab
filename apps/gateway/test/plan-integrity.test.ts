import { describe, expect, it } from "vitest";
import {
  assertFundingPlanTransactionIntegrity,
  hashSerializedTransaction
} from "../src/funding/plan-integrity.js";
import { LocalKeypairSigner } from "../src/signer/local-keypair.js";
import { Connection, Keypair } from "@solana/web3.js";
import { USDC_MINT, WSOL_MINT } from "../src/constants.js";

describe("funding plan integrity", () => {
  it("hashes serialized transaction bytes", () => {
    const payload = Buffer.from("demo-wire-bytes").toString("base64");
    expect(hashSerializedTransaction(payload)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects mismatched transactionSha256", () => {
    const payload = Buffer.from("demo-wire-bytes").toString("base64");
    expect(() =>
      assertFundingPlanTransactionIntegrity({
        serializedTransaction: payload,
        transactionSha256: "0".repeat(64)
      })
    ).toThrow(/quote substitution/);
  });

  it("LocalKeypairSigner refuses mutated serializedTransaction when hash is bound", async () => {
    const kp = Keypair.generate();
    const signer = new LocalKeypairSigner({
      keypair: kp,
      connection: new Connection("https://api.mainnet-beta.solana.com", "confirmed"),
      broadcastEnabled: false
    });
    const original = Buffer.alloc(64, 1).toString("base64");
    const hash = hashSerializedTransaction(original);
    const mutated = Buffer.alloc(64, 2).toString("base64");

    await expect(
      signer.signFundingTransaction({
        wallet: kp.publicKey.toBase58(),
        inputMint: WSOL_MINT,
        outputMint: USDC_MINT,
        inputAmountAtomic: "1000",
        minimumOutputAtomic: "1000",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        operationId: "integrity-1",
        transaction: JSON.stringify({
          type: "live-sim-plan",
          broadcast: false,
          simulated: true,
          simulationOk: true,
          userPublicKey: kp.publicKey.toBase58(),
          inputMint: WSOL_MINT,
          outputMint: USDC_MINT,
          inAmount: "1000",
          minOutAmount: "1000",
          serializedTransaction: mutated,
          transactionSha256: hash
        })
      })
    ).rejects.toThrow(/quote substitution/);
  });
});

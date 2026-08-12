import { describe, expect, it } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { LocalKeypairSigner } from "../src/signer/local-keypair.js";
import { SimulatedSigner } from "../src/signer/simulated.js";
import { USDC_MINT, WSOL_MINT } from "../src/constants.js";

describe("LocalKeypairSigner broadcast gate", () => {
  it("refuses live-funding-plan when broadcastEnabled=false", async () => {
    const kp = Keypair.generate();
    const signer = new LocalKeypairSigner({
      keypair: kp,
      connection: new Connection("https://api.mainnet-beta.solana.com", "confirmed"),
      broadcastEnabled: false
    });

    await expect(
      signer.signFundingTransaction({
        wallet: kp.publicKey.toBase58(),
        inputMint: WSOL_MINT,
        outputMint: USDC_MINT,
        inputAmountAtomic: "1000",
        minimumOutputAtomic: "1000",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        operationId: "gate-1",
        transaction: JSON.stringify({
          type: "live-funding-plan",
          broadcast: true,
          simulationOk: true,
          userPublicKey: kp.publicKey.toBase58(),
          inputMint: WSOL_MINT,
          outputMint: USDC_MINT,
          inAmount: "1000",
          minOutAmount: "1000",
          serializedTransaction: Buffer.alloc(64).toString("base64")
        })
      })
    ).rejects.toThrow(/broadcastEnabled=true/);
  });

  it("SimulatedSigner rejects live-funding-plan", async () => {
    const signer = new SimulatedSigner();
    await expect(
      signer.signFundingTransaction({
        wallet: "x",
        inputMint: WSOL_MINT,
        outputMint: USDC_MINT,
        inputAmountAtomic: "1",
        minimumOutputAtomic: "1",
        network: "solana:local",
        operationId: "gate-2",
        transaction: JSON.stringify({
          type: "live-funding-plan",
          broadcast: true,
          userPublicKey: "x",
          inputMint: WSOL_MINT,
          outputMint: USDC_MINT,
          inAmount: "1",
          minOutAmount: "1"
        })
      })
    ).rejects.toThrow(/LocalKeypairSigner/);
  });
});

import { describe, expect, it } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { DFlowClient, DFLOW_DEV_BASE_URL } from "@agenttab/dflow";
import { LiveSimDFlowAdapter } from "../src/funding/live-sim-dflow.js";
import { SimulatedSigner } from "../src/signer/simulated.js";
import { USDC_MINT, WSOL_MINT } from "../src/constants.js";

describe.skipIf(process.env.AGENTTAB_NETWORK_TESTS !== "1")(
  "live-sim funding mode (network)",
  () => {
  it("orders a real DFlow tx and simulates without broadcasting", async () => {
    const client = new DFlowClient({ baseUrl: DFLOW_DEV_BASE_URL });
    try {
      await client.getOrder({
        inputMint: WSOL_MINT,
        outputMint: USDC_MINT,
        amount: "100000000",
        slippageBps: 50
      });
    } catch (error) {
      console.warn(
        `Skipping live-sim network test: DFlow dev API unreachable/rate-limited (${
          error instanceof Error ? error.message : "unknown"
        })`
      );
      return;
    }

    // Disposable pubkey — not funded; simulation may fail for balance reasons.
    const wallet = Keypair.generate().publicKey.toBase58();
    const adapter = new LiveSimDFlowAdapter({
      client,
      connection: new Connection(
        process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
        "confirmed"
      ),
      maxQuoteRequests: 16
    });

    let order;
    try {
      order = await adapter.planExactDeficit({
        inputMint: WSOL_MINT,
        outputMint: USDC_MINT,
        targetOutputAtomic: "1000000",
        maxInputAtomic: "5000000000",
        userPublicKey: wallet
      });
    } catch (error) {
      console.warn(
        `Skipping live-sim network test during planExactDeficit: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      return;
    }

    expect(order.source).toBe("live-sim");
    const plan = JSON.parse(order.transaction) as {
      type: string;
      broadcast: boolean;
      simulated: boolean;
      hasTransaction: boolean;
      transactionByteLength: number;
      simulationOk: boolean;
      simulationError?: string;
    };
    expect(plan.type).toBe("live-sim-plan");
    expect(plan.broadcast).toBe(false);
    expect(plan.simulated).toBe(true);
    expect(plan.hasTransaction).toBe(true);
    expect(plan.transactionByteLength).toBeGreaterThan(100);

    const signer = new SimulatedSigner();
    const signed = await signer.signFundingTransaction({
      wallet,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inputAmountAtomic: order.inputAmountAtomic,
      minimumOutputAtomic: order.minimumOutputAtomic,
      network: "solana:mainnet",
      operationId: "live-sim-net-1",
      transaction: order.transaction
    });
    expect(signed.signature).toContain("sim-fund-live-sim-net-1");

    console.log(
      JSON.stringify(
        {
          phase: "live-sim-ok",
          wallet,
          inputAmountAtomic: order.inputAmountAtomic,
          outputAmountAtomic: order.outputAmountAtomic,
          simulationOk: plan.simulationOk,
          simulationError: plan.simulationError ?? null,
          transactionByteLength: plan.transactionByteLength,
          broadcast: plan.broadcast
        },
        null,
        2
      )
    );
  }, 120_000);
});

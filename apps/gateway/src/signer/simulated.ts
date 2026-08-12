import { assertFundingPlanTransactionIntegrity } from "../funding/plan-integrity.js";

export interface SignableFundingPlan {
  wallet: string;
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: string;
  minimumOutputAtomic: string;
  network: string;
  operationId: string;
  transaction: string;
}

export interface SignerBoundary {
  signFundingTransaction(plan: SignableFundingPlan): Promise<{ signature: string }>;
}

const ALLOWED_PLAN_TYPES = new Set([
  "mock-dflow-order",
  "live-quote-plan",
  "devnet-mint-plan",
  "live-sim-plan",
  "live-funding-plan"
]);

/**
 * Simulated signer: verifies plan fields against the prepared transaction JSON.
 * Never accepts raw private keys. Live-quote/live-sim plans must not request broadcast.
 * Devnet-mint plans return the already-submitted mint signature.
 * live-funding-plan is rejected here — use LocalKeypairSigner for real sends.
 */
export class SimulatedSigner implements SignerBoundary {
  async signFundingTransaction(plan: SignableFundingPlan): Promise<{ signature: string }> {
    const parsed = JSON.parse(plan.transaction) as {
      type?: string;
      broadcast?: boolean;
      userPublicKey?: string;
      inputMint?: string;
      outputMint?: string;
      inAmount?: string;
      minOutAmount?: string;
      mintSignature?: string;
      simulated?: boolean;
      simulationOk?: boolean;
      serializedTransaction?: string;
      transactionSha256?: string;
    };

    if (parsed.type === undefined || !ALLOWED_PLAN_TYPES.has(parsed.type)) {
      throw new Error("Unsupported funding transaction type");
    }
    assertFundingPlanTransactionIntegrity(parsed);
    if (parsed.type === "live-funding-plan") {
      throw new Error("SimulatedSigner cannot sign live-funding-plan; use LocalKeypairSigner");
    }
    if (
      (parsed.type === "live-quote-plan" || parsed.type === "live-sim-plan") &&
      parsed.broadcast !== false
    ) {
      throw new Error("Non-broadcast funding plans must set broadcast=false");
    }
    if (parsed.type === "live-sim-plan" && parsed.simulated !== true) {
      throw new Error("Live-sim plan must record a completed simulateTransaction call");
    }
    if (parsed.userPublicKey !== plan.wallet) {
      throw new Error("Funding transaction wallet mismatch");
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
    if (!plan.operationId || !plan.network) {
      throw new Error("Funding plan missing binding fields");
    }

    if (parsed.type === "devnet-mint-plan") {
      if (!parsed.mintSignature) {
        throw new Error("Devnet mint plan missing mintSignature");
      }
      return { signature: parsed.mintSignature };
    }

    return {
      signature: `sim-fund-${plan.operationId}-${plan.inputAmountAtomic}`
    };
  }
}

import {
  findMinimumInputForOutput,
  InsufficientFundingLiquidityError,
  type DFlowClient,
  type DFlowOutputQuote,
  type MinimumInputPlan
} from "@agenttab/dflow";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import type { DeficitFundingAdapter, FundingOrder, PlanExactDeficitInput } from "./types.js";
import { hashSerializedTransaction } from "./plan-integrity.js";

export interface LiveSimDFlowAdapterOptions {
  client: DFlowClient;
  /** Mainnet-compatible RPC used only for simulateTransaction (never send). */
  connection: Connection;
  maxQuoteRequests?: number;
  defaultSlippageBps?: number;
  /**
   * When true, reject plans whose simulation returns an error.
   * Default false so unfunded dry-run wallets can still prove order construction.
   */
  failClosedOnSimulationError?: boolean;
  /**
   * When true AND simulation succeeds, mark plan.broadcast=true so a
   * LocalKeypairSigner with broadcastEnabled may send. Default false.
   */
  allowBroadcastInPlan?: boolean;
}

/**
 * Live DFlow plan + simulate adapter.
 *
 * 1. Exact-deficit quotes without userPublicKey (same as live-quote).
 * 2. Final order WITH userPublicKey to obtain a real base64 transaction.
 * 3. simulateTransaction only — never sendTransaction / broadcast.
 */
export class LiveSimDFlowAdapter implements DeficitFundingAdapter {
  readonly #client: DFlowClient;
  readonly #connection: Connection;
  readonly #maxQuoteRequests: number;
  readonly #defaultSlippageBps: number;
  readonly #failClosedOnSimulationError: boolean;
  readonly #allowBroadcastInPlan: boolean;
  readonly orders: FundingOrder[] = [];

  constructor(options: LiveSimDFlowAdapterOptions) {
    this.#client = options.client;
    this.#connection = options.connection;
    this.#maxQuoteRequests = options.maxQuoteRequests ?? 24;
    this.#defaultSlippageBps = options.defaultSlippageBps ?? 50;
    this.#failClosedOnSimulationError = options.failClosedOnSimulationError ?? false;
    this.#allowBroadcastInPlan = options.allowBroadcastInPlan ?? false;
  }

  async planExactDeficit(input: PlanExactDeficitInput): Promise<FundingOrder> {
    const slippageBps = input.slippageBps ?? this.#defaultSlippageBps;

    const quote = async (inputAmountAtomic: string): Promise<DFlowOutputQuote> => {
      const response = await this.#client.getOrder({
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        amount: inputAmountAtomic,
        slippageBps
        // Quote-only during search: no userPublicKey.
      });
      return {
        inAmount: response.inAmount,
        outAmount: response.outAmount,
        minOutAmount: response.minOutAmount,
        priceImpactPct: response.priceImpactPct
      };
    };

    const probeAmount =
      BigInt(input.maxInputAtomic) < 100_000_000n
        ? BigInt(input.maxInputAtomic)
        : 100_000_000n;
    const probe = await quote(probeAmount.toString());
    const probeOut = BigInt(probe.minOutAmount);
    const estimatedInput =
      probeOut <= 0n
        ? probeAmount
        : (BigInt(input.targetOutputAtomic) * probeAmount * 100n) / (probeOut * 99n) + 1n;
    const cappedEstimate =
      estimatedInput > BigInt(input.maxInputAtomic) ? BigInt(input.maxInputAtomic) : estimatedInput;

    let plan: MinimumInputPlan;
    try {
      plan = await findMinimumInputForOutput({
        targetOutputAtomic: input.targetOutputAtomic,
        maxInputAtomic: input.maxInputAtomic,
        initialInputAtomic: cappedEstimate.toString(),
        maxQuoteRequests: this.#maxQuoteRequests,
        quote
      });
    } catch (error) {
      if (error instanceof InsufficientFundingLiquidityError) throw error;
      throw error;
    }

    const withTx = await this.#client.getOrder({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: plan.inputAmountAtomic,
      slippageBps,
      userPublicKey: input.userPublicKey
    });

    if (!withTx.transaction) {
      throw new Error("DFlow order with userPublicKey did not return a transaction");
    }

    const txBytes = Buffer.from(withTx.transaction, "base64");
    const versioned = VersionedTransaction.deserialize(txBytes);
    const simulation = await this.#connection.simulateTransaction(versioned, {
      sigVerify: false,
      replaceRecentBlockhash: true
    });

    const simulationError =
      simulation.value.err === null
        ? undefined
        : typeof simulation.value.err === "string"
          ? simulation.value.err
          : JSON.stringify(simulation.value.err);

    if (this.#failClosedOnSimulationError && simulation.value.err !== null) {
      throw new Error(
        `DFlow live-sim failed closed: ${simulationError ?? "simulation error"}`
      );
    }

    const broadcast =
      this.#allowBroadcastInPlan && simulation.value.err === null ? true : false;

    const transactionSha256 = hashSerializedTransaction(withTx.transaction);

    const order: FundingOrder = {
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      inputAmountAtomic: plan.inputAmountAtomic,
      outputAmountAtomic: plan.expectedOutputAtomic,
      minimumOutputAtomic: plan.minimumOutputAtomic,
      priceImpactPct: plan.priceImpactPct,
      transaction: JSON.stringify({
        type: broadcast ? "live-funding-plan" : "live-sim-plan",
        broadcast,
        simulated: true,
        simulationOk: simulation.value.err === null,
        ...(simulationError === undefined ? {} : { simulationError }),
        unitsConsumed: simulation.value.unitsConsumed ?? null,
        userPublicKey: input.userPublicKey,
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        inAmount: plan.inputAmountAtomic,
        outAmount: plan.expectedOutputAtomic,
        minOutAmount: plan.minimumOutputAtomic,
        dflowBaseUrl: this.#client.baseUrl,
        quoteRequests: plan.quoteRequests,
        hasTransaction: true,
        transactionByteLength: txBytes.length,
        serializedTransaction: withTx.transaction,
        transactionSha256
      }),
      plan,
      source: "live-sim"
    };
    this.orders.push(order);
    return order;
  }
}

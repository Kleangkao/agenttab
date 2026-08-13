import {
  evaluatePaymentPolicy,
  type ExecutionRecord,
  type ExecutionStore,
  type FundingOutcome,
  type PaymentFundingCoordinator,
  type PaymentIntent,
  type PaymentPolicy,
  type SpendSnapshot
} from "@agenttab/core";
import { DEMO_WALLET, USDC_MINT, WSOL_MINT } from "../constants.js";
import type { BalanceProvider } from "../funding/mock-balances.js";
import type { DeficitFundingAdapter, FundingOrder } from "../funding/types.js";
import type { SignerBoundary } from "../signer/simulated.js";

type EventDetails = Record<string, string | number | boolean | null>;

function detailString(
  details: EventDetails | undefined,
  key: string,
  fallback: string
): string {
  const value = details?.[key];
  return typeof value === "string" ? value : fallback;
}

/** True when the adapter itself already mutated chain state (mint / prior broadcast). */
function adapterSideEffectSignature(transactionJson: string): string | undefined {
  try {
    const parsed = JSON.parse(transactionJson) as {
      mintSignature?: string;
      broadcastSignature?: string;
    };
    if (typeof parsed.mintSignature === "string" && parsed.mintSignature.length > 0) {
      return parsed.mintSignature;
    }
    if (typeof parsed.broadcastSignature === "string" && parsed.broadcastSignature.length > 0) {
      return parsed.broadcastSignature;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Local/sim signatures are not on-chain side effects. */
function isOnChainFundingSignature(signature: string): boolean {
  return !(
    signature.startsWith("pending-") ||
    signature.startsWith("sim-fund-") ||
    signature.startsWith("local-signed-nobroadcast-") ||
    signature.startsWith("resumed-")
  );
}

async function maybeRefreshBalances(balances: BalanceProvider): Promise<void> {
  const refreshable = balances as BalanceProvider & { refresh?: () => Promise<unknown> };
  if (typeof refreshable.refresh === "function") {
    await refreshable.refresh();
  }
}

async function assertPaymentAssetHeld(
  balances: BalanceProvider,
  intent: PaymentIntent
): Promise<void> {
  await maybeRefreshBalances(balances);
  const mint = intent.assetMint || USDC_MINT;
  const held = BigInt(balances.get(mint)?.balanceAtomic ?? "0");
  const needed = BigInt(intent.amountAtomic);
  if (held < needed) {
    throw new Error(
      `Post-funding balance gate failed: held ${held} < required ${needed} for ${mint}`
    );
  }
}

export interface SpendLedger {
  getSpentUsdMicrosLast24h(): string;
  recordSpend(usdMicros: string): void;
  /** Idempotent spend keyed by operationId. Returns true when a new row was written. */
  ensureOperationSpend(operationId: string, usdMicros: string): boolean;
}

export class InMemorySpendLedger implements SpendLedger {
  #spentUsdMicros = 0n;
  readonly #operations = new Set<string>();

  getSpentUsdMicrosLast24h(): string {
    return this.#spentUsdMicros.toString();
  }

  recordSpend(usdMicros: string): void {
    this.#spentUsdMicros += BigInt(usdMicros);
  }

  ensureOperationSpend(operationId: string, usdMicros: string): boolean {
    if (this.#operations.has(operationId)) return false;
    this.#operations.add(operationId);
    this.#spentUsdMicros += BigInt(usdMicros);
    return true;
  }

  reset(spentUsdMicros = "0"): void {
    this.#spentUsdMicros = BigInt(spentUsdMicros);
    this.#operations.clear();
  }
}

export interface CoordinatorDeps {
  store: ExecutionStore;
  getPolicy: () => PaymentPolicy;
  balances: BalanceProvider;
  dflow: DeficitFundingAdapter;
  signer: SignerBoundary;
  spend: SpendLedger;
  wallet?: string;
  /** Fire-and-forget; must not throw into the funding path. */
  notifyParked?: (record: ExecutionRecord) => Promise<void>;
}

async function transition(
  store: ExecutionStore,
  record: ExecutionRecord,
  to: ExecutionRecord["state"],
  kind: string,
  details?: Record<string, string | number | boolean | null>
): Promise<ExecutionRecord> {
  return store.transition({
    operationId: record.operationId,
    expectedVersion: record.version,
    to,
    kind,
    ...(details === undefined ? {} : { details })
  });
}

export class GatewayFundingCoordinator implements PaymentFundingCoordinator {
  readonly #store: ExecutionStore;
  readonly #getPolicy: () => PaymentPolicy;
  readonly #balances: BalanceProvider;
  readonly #dflow: DeficitFundingAdapter;
  readonly #signer: SignerBoundary;
  readonly #spend: SpendLedger;
  readonly #wallet: string;
  readonly #notifyParked?: (record: ExecutionRecord) => Promise<void>;

  constructor(deps: CoordinatorDeps) {
    this.#store = deps.store;
    this.#getPolicy = deps.getPolicy;
    this.#balances = deps.balances;
    this.#dflow = deps.dflow;
    this.#signer = deps.signer;
    this.#spend = deps.spend;
    this.#wallet = deps.wallet ?? DEMO_WALLET;
    if (deps.notifyParked !== undefined) {
      this.#notifyParked = deps.notifyParked;
    }
  }

  async ensurePaymentAsset(input: {
    intent: PaymentIntent;
    signal?: AbortSignal;
  }): Promise<FundingOutcome> {
    void input.signal;
    await maybeRefreshBalances(this.#balances);
    const { record: existing } = await this.#store.createOrGet(input.intent);
    let record = existing;

    if (record.state === "funded") {
      return {
        status: "already_funded",
        reason: `Execution already at ${record.state}`
      };
    }

    if (
      record.state === "payment_submitted" ||
      record.state === "paid" ||
      record.state === "fulfilled" ||
      record.state === "fulfillment_failed"
    ) {
      return {
        status: "already_paid",
        reason: `Execution already at ${record.state}`
      };
    }

    if (record.state === "denied" || record.state === "failed") {
      return {
        status: "denied",
        reason: `Execution is terminal: ${record.state}`
      };
    }

    if (record.state === "approval_required") {
      return {
        status: "approval_required",
        reason: "Waiting for human approval"
      };
    }

    const paymentAtomic = BigInt(input.intent.amountAtomic);
    const readHeld = (): bigint => BigInt(this.#balances.get(input.intent.assetMint)?.balanceAtomic ?? "0");
    let heldAtomic = readHeld();

    const fundingCandidate =
      heldAtomic >= paymentAtomic
        ? undefined
        : (() => {
            const sol = this.#balances.get(WSOL_MINT);
            if (sol === undefined) return undefined;
            return {
              mint: sol.mint,
              symbol: sol.symbol,
              balanceAtomic: sol.balanceAtomic,
              verified: sol.verified
            };
          })();

    const spend: SpendSnapshot = {
      spentUsdMicrosLast24h: this.#spend.getSpentUsdMicrosLast24h()
    };

    const policy = this.#getPolicy();
    const decision = evaluatePaymentPolicy({
      intent: input.intent,
      policy,
      spend,
      ...(fundingCandidate === undefined ? {} : { fundingCandidate })
    });

    const humanApproved = record.state === "approved" || record.state === "funding_submitted";

    if (decision.kind === "deny" && !humanApproved) {
      if (record.state === "discovered") {
        record = await transition(this.#store, record, "denied", "policy.denied", {
          reason: decision.reason
        });
      }
      return { status: "denied", reason: decision.message };
    }

    if (decision.kind === "approval_required" && !humanApproved) {
      if (record.state === "discovered") {
        record = await transition(this.#store, record, "approval_required", "policy.approval_required", {
          reason: decision.reason
        });
        if (this.#notifyParked !== undefined) {
          try {
            await this.#notifyParked(record);
          } catch {
            // Notify is fail-open: parking still wins.
          }
        }
      }
      return { status: "approval_required", reason: decision.message };
    }

    if (record.state === "discovered") {
      record = await transition(this.#store, record, "approved", "policy.allowed", {
        reason: decision.reason
      });
    }

    heldAtomic = readHeld();

    const priorFunding = record.events.find((event) => event.kind === "funding.confirmed");
    if (priorFunding !== undefined) {
      if (record.state === "funding_submitted") {
        await transition(this.#store, record, "funded", "funding.confirmed", priorFunding.details);
      }
      return {
        status: "already_funded",
        reason: "Funding already confirmed for this operation"
      };
    }

    // Resume incomplete funding before treating a now-sufficient balance as "not required".
    const sideEffect = record.events.find((event) => event.kind === "funding.side_effect_receipt");
    if (sideEffect !== undefined) {
      return this.#confirmFromReceipt(record, input.intent, sideEffect.details, true);
    }

    const planReceipt = record.events.find((event) => event.kind === "funding.plan_receipt");
    if (planReceipt !== undefined) {
      return this.#completeFromPlanReceipt(record, input.intent, planReceipt.details);
    }

    const attemptLock = record.events.find((event) => event.kind === "funding.attempt_locked");
    if (attemptLock !== undefined) {
      if (record.state === "funding_submitted") {
        await transition(this.#store, record, "failed", "funding.failed", {
          message: "incomplete_funding_attempt",
          hint: "A prior funding attempt was locked without a plan receipt; refusing to re-plan"
        });
      }
      return {
        status: "denied",
        reason:
          "Incomplete funding attempt detected; refusing to re-plan to avoid double-send. Create a new operationId after manual review."
      };
    }

    if (heldAtomic >= paymentAtomic) {
      if (record.state === "approved" || record.state === "funding_submitted") {
        await transition(this.#store, record, "funded", "funding.not_required", {
          paymentBalanceAtomic: heldAtomic.toString()
        });
      }
      return {
        status: "already_funded",
        reason: "Wallet already holds the requested payment asset"
      };
    }

    if (fundingCandidate === undefined) {
      if (record.state === "approved") {
        await transition(this.#store, record, "failed", "funding.no_candidate");
      }
      return { status: "denied", reason: "No verified funding asset available" };
    }

    if (BigInt(fundingCandidate.balanceAtomic) <= 0n) {
      if (record.state === "approved") {
        await transition(this.#store, record, "failed", "funding.insufficient_candidate", {
          mint: fundingCandidate.mint
        });
      }
      return {
        status: "denied",
        reason: "Funding asset balance is zero; deposit SOL before exact-deficit funding"
      };
    }

    const deficit = paymentAtomic - heldAtomic;
    if (record.state === "approved") {
      record = await transition(this.#store, record, "funding_submitted", "funding.submitted", {
        deficitAtomic: deficit.toString(),
        inputMint: WSOL_MINT,
        outputMint: input.intent.assetMint
      });
    }

    try {
      record = await this.#store.appendEvent({
        operationId: record.operationId,
        expectedVersion: record.version,
        kind: "funding.attempt_locked",
        details: {
          deficitAtomic: deficit.toString(),
          inputMint: WSOL_MINT,
          outputMint: input.intent.assetMint || USDC_MINT
        }
      });

      const order = await this.#dflow.planExactDeficit({
        inputMint: WSOL_MINT,
        outputMint: input.intent.assetMint || USDC_MINT,
        targetOutputAtomic: deficit.toString(),
        maxInputAtomic: fundingCandidate.balanceAtomic,
        userPublicKey: this.#wallet,
        slippageBps: policy.maxSlippageBps
      });

      const impactPct = Number(order.priceImpactPct);
      if (Number.isFinite(impactPct) && impactPct > policy.maxPriceImpactPct) {
        if (record.state === "funding_submitted") {
          await transition(this.#store, record, "failed", "funding.failed", {
            message: "price_impact_exceeded",
            priceImpactPct: order.priceImpactPct,
            maxPriceImpactPct: policy.maxPriceImpactPct
          });
        }
        return {
          status: "denied",
          reason: `Price impact ${order.priceImpactPct}% exceeds policy max ${policy.maxPriceImpactPct}%`
        };
      }

      return await this.#persistPlanAndComplete(record, input.intent, order);
    } catch (error) {
      return this.#handleFundingError(record, error);
    }
  }

  async #confirmFromReceipt(
    record: ExecutionRecord,
    intent: PaymentIntent,
    details: EventDetails | undefined,
    resumed: boolean
  ): Promise<FundingOutcome> {
    const signature = detailString(details, "signature", `resumed-${intent.operationId}`);
    const inputMint = detailString(details, "inputMint", WSOL_MINT);
    const outputMint = detailString(details, "outputMint", intent.assetMint || USDC_MINT);
    const inputAmountAtomic = detailString(details, "inputAmountAtomic", "0");
    const outputAmountAtomic = detailString(details, "outputAmountAtomic", "0");

    if (!record.events.some((event) => event.kind === "funding.balances_applied")) {
      try {
        this.#balances.applyDelta(inputMint, -BigInt(inputAmountAtomic));
      } catch {
        // Input debit may already be reflected or overstated; still credit output.
      }
      try {
        this.#balances.applyDelta(outputMint, BigInt(outputAmountAtomic));
      } catch {
        // Output credit may already be reflected.
      }
      record = await this.#store.appendEvent({
        operationId: record.operationId,
        expectedVersion: record.version,
        kind: "funding.balances_applied",
        details: { inputMint, outputMint, inputAmountAtomic, outputAmountAtomic }
      });
    }

    await assertPaymentAssetHeld(this.#balances, intent);

    if (record.state === "funding_submitted") {
      await transition(this.#store, record, "funded", "funding.confirmed", {
        signature,
        inputMint,
        outputMint,
        inputAmountAtomic,
        outputAmountAtomic,
        resumed
      });
    }
    return {
      status: "funded",
      reason: resumed
        ? "Resumed funding from persisted side-effect receipt (no re-plan)"
        : "Exact deficit acquired via funding adapter",
      fundingTransaction: signature,
      inputMint,
      inputAmountAtomic,
      outputAmountAtomic
    };
  }

  async #completeFromPlanReceipt(
    record: ExecutionRecord,
    intent: PaymentIntent,
    details: EventDetails | undefined
  ): Promise<FundingOutcome> {
    const transaction = detailString(details, "transaction", "");
    if (!transaction) {
      return {
        status: "denied",
        reason:
          "Persisted plan receipt is missing transaction payload; refusing to re-plan. Create a new operationId after manual review."
      };
    }
    const order: FundingOrder = {
      inputMint: detailString(details, "inputMint", WSOL_MINT),
      outputMint: detailString(details, "outputMint", intent.assetMint || USDC_MINT),
      inputAmountAtomic: detailString(details, "inputAmountAtomic", "0"),
      outputAmountAtomic: detailString(details, "outputAmountAtomic", "0"),
      minimumOutputAtomic: detailString(
        details,
        "minimumOutputAtomic",
        detailString(details, "outputAmountAtomic", "0")
      ),
      priceImpactPct: detailString(details, "priceImpactPct", "0"),
      transaction,
      plan: {
        inputAmountAtomic: detailString(details, "inputAmountAtomic", "0"),
        expectedOutputAtomic: detailString(details, "outputAmountAtomic", "0"),
        minimumOutputAtomic: detailString(
          details,
          "minimumOutputAtomic",
          detailString(details, "outputAmountAtomic", "0")
        ),
        priceImpactPct: detailString(details, "priceImpactPct", "0"),
        quoteRequests: 0,
        minimized: true
      },
      source: detailString(details, "source", "mock") as FundingOrder["source"]
    };

    try {
      return await this.#signApplyConfirm(record, intent, order, true);
    } catch (error) {
      return this.#handleFundingError(record, error);
    }
  }

  async #persistPlanAndComplete(
    record: ExecutionRecord,
    intent: PaymentIntent,
    order: FundingOrder
  ): Promise<FundingOutcome> {
    const chainSig = adapterSideEffectSignature(order.transaction);
    if (chainSig !== undefined) {
      // Adapter already mutated chain (e.g. Devnet mint). Persist before sign/confirm.
      record = await this.#store.appendEvent({
        operationId: record.operationId,
        expectedVersion: record.version,
        kind: "funding.side_effect_receipt",
        details: {
          signature: chainSig,
          source: order.source,
          inputAmountAtomic: order.inputAmountAtomic,
          outputAmountAtomic: order.outputAmountAtomic,
          inputMint: order.inputMint,
          outputMint: order.outputMint,
          priceImpactPct: order.priceImpactPct,
          adapterSideEffect: true
        }
      });
    } else {
      // No chain side effect yet — persist plan so retries re-sign without re-planning.
      record = await this.#store.appendEvent({
        operationId: record.operationId,
        expectedVersion: record.version,
        kind: "funding.plan_receipt",
        details: {
          source: order.source,
          inputAmountAtomic: order.inputAmountAtomic,
          outputAmountAtomic: order.outputAmountAtomic,
          minimumOutputAtomic: order.minimumOutputAtomic,
          inputMint: order.inputMint,
          outputMint: order.outputMint,
          priceImpactPct: order.priceImpactPct,
          transaction: order.transaction
        }
      });
    }

    return this.#signApplyConfirm(record, intent, order, false);
  }

  async #signApplyConfirm(
    record: ExecutionRecord,
    intent: PaymentIntent,
    order: FundingOrder,
    resumed: boolean
  ): Promise<FundingOutcome> {
    const { signature } = await this.#signer.signFundingTransaction({
      wallet: this.#wallet,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inputAmountAtomic: order.inputAmountAtomic,
      minimumOutputAtomic: order.minimumOutputAtomic,
      network: intent.network,
      operationId: intent.operationId,
      transaction: order.transaction
    });

    // Real broadcast/send: persist side-effect receipt before bookkeeping/confirm.
    if (
      isOnChainFundingSignature(signature) &&
      !record.events.some((event) => event.kind === "funding.side_effect_receipt")
    ) {
      record = await this.#store.appendEvent({
        operationId: record.operationId,
        expectedVersion: record.version,
        kind: "funding.side_effect_receipt",
        details: {
          signature,
          source: order.source,
          inputAmountAtomic: order.inputAmountAtomic,
          outputAmountAtomic: order.outputAmountAtomic,
          inputMint: order.inputMint,
          outputMint: order.outputMint,
          priceImpactPct: order.priceImpactPct,
          adapterSideEffect: false
        }
      });
    }

    if (!record.events.some((event) => event.kind === "funding.balances_applied")) {
      try {
        this.#balances.applyDelta(order.inputMint, -BigInt(order.inputAmountAtomic));
      } catch (error) {
        // Keep going so a successful on-chain side effect can still credit output.
        // Post-funding gate below fail-closes if payment asset is still insufficient.
        void error;
      }
      try {
        this.#balances.applyDelta(order.outputMint, BigInt(order.outputAmountAtomic));
      } catch (error) {
        void error;
      }
      record = await this.#store.appendEvent({
        operationId: record.operationId,
        expectedVersion: record.version,
        kind: "funding.balances_applied",
        details: {
          inputMint: order.inputMint,
          outputMint: order.outputMint,
          inputAmountAtomic: order.inputAmountAtomic,
          outputAmountAtomic: order.outputAmountAtomic
        }
      });
    }

    await assertPaymentAssetHeld(this.#balances, intent);

    if (record.state === "funding_submitted") {
      await transition(this.#store, record, "funded", "funding.confirmed", {
        signature,
        inputAmountAtomic: order.inputAmountAtomic,
        outputAmountAtomic: order.outputAmountAtomic,
        inputMint: order.inputMint,
        outputMint: order.outputMint,
        source: order.source,
        resumed
      });
    }

    return {
      status: "funded",
      reason: resumed
        ? "Resumed funding from persisted plan receipt (re-signed, no re-plan)"
        : "Exact deficit acquired via funding adapter",
      fundingTransaction: signature,
      inputMint: order.inputMint,
      inputAmountAtomic: order.inputAmountAtomic,
      outputAmountAtomic: order.outputAmountAtomic
    };
  }

  async #handleFundingError(
    record: ExecutionRecord,
    error: unknown
  ): Promise<FundingOutcome> {
    const message = error instanceof Error ? error.message : "Funding failed";
    const latest = (await this.#store.get(record.operationId)) ?? record;
    const hasPlan = latest.events.some((event) => event.kind === "funding.plan_receipt");
    const hasSideEffect = latest.events.some(
      (event) => event.kind === "funding.side_effect_receipt"
    );

    // Plan or side-effect already persisted: stay non-terminal so resume can finish.
    if (latest.state === "funding_submitted" && (hasPlan || hasSideEffect)) {
      await this.#store.appendEvent({
        operationId: latest.operationId,
        expectedVersion: latest.version,
        kind: hasSideEffect ? "funding.confirm_interrupted" : "funding.signer_failed",
        details: { message }
      });
      return {
        status: "interrupted",
        reason: hasSideEffect
          ? `${message} (side-effect receipt retained; retry to confirm without re-plan)`
          : `${message} (plan receipt retained; retry to re-sign without re-plan)`
      };
    }

    if (latest.state === "funding_submitted") {
      await transition(this.#store, latest, "failed", "funding.failed", { message });
    }
    return { status: "denied", reason: message };
  }
}

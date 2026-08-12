import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  evaluatePaymentPolicy,
  ExecutionVersionConflictError,
  InvalidExecutionTransitionError,
  isExecutionState,
  paymentIntentSchema,
  paymentPolicySchema,
  type ExecutionRecord,
  type PaymentIntent,
  type PaymentPolicy,
  type PolicyDecision
} from "@agenttab/core";
import { operatorHtml } from "./ui/operator-page.js";
import { gatewayOpenApiDocument } from "./openapi.js";
import {
  createOperatorNotifier,
  operatorNotifyPayload,
  type OperatorNotifyEvent
} from "./notify.js";
import { DFlowClient, DFLOW_DEV_BASE_URL } from "@agenttab/dflow";
import { Connection } from "@solana/web3.js";
import { Hono } from "hono";
import { DEMO_WALLET, LIVE_SIM_WALLET, USDC_MINT, WSOL_MINT } from "./constants.js";
import { LiveQuoteDFlowAdapter } from "./funding/live-quote-dflow.js";
import { LiveSimDFlowAdapter } from "./funding/live-sim-dflow.js";
import { MockBalanceProvider } from "./funding/mock-balances.js";
import type { BalanceProvider } from "./funding/mock-balances.js";
import { MockDFlowAdapter } from "./funding/mock-dflow.js";
import type { DeficitFundingAdapter } from "./funding/types.js";
import {
  GatewayFundingCoordinator,
  InMemorySpendLedger,
  type SpendLedger
} from "./orchestrator/coordinator.js";
import { issuePaymentToken, verifyPaymentToken } from "./payment/token.js";
import {
  createDemoPolicy,
  InMemoryPolicyStore,
  type PolicyStore
} from "./policy/store.js";
import type { SignerBoundary } from "./signer/simulated.js";
import { SimulatedSigner } from "./signer/simulated.js";
import { SqliteExecutionStore } from "./store/sqlite-execution-store.js";

export type FundingMode = "mock" | "live-quote" | "live-sim" | "devnet-mint";

export interface GatewayRuntimeOptions {
  dbPath?: string;
  merchantOrigin?: string;
  paymentHmacSecret?: string;
  initialUsdcAtomic?: string;
  initialSolAtomic?: string;
  failFunding?: boolean;
  policy?: PaymentPolicy;
  fundingMode?: FundingMode;
  /** Buyer wallet pubkey bound into funding plans / signer checks. */
  wallet?: string;
  dflowApiKey?: string;
  dflowBaseUrl?: string;
  dflowFetch?: typeof fetch;
  dflowAdapter?: DeficitFundingAdapter;
  /** RPC URL for live-sim simulateTransaction only (never send). */
  solanaRpcUrl?: string;
  /** Reject live-sim plans when simulateTransaction returns an error. */
  liveSimFailClosed?: boolean;
  /**
   * When true with live-sim + fail-closed, plans may set broadcast=true.
   * Still requires LocalKeypairSigner.broadcastEnabled to actually send.
   * Default false.
   */
  broadcastEnabled?: boolean;
  /** Inject a real signer (e.g. LocalKeypairSigner). Defaults to SimulatedSigner. */
  signer?: SignerBoundary;
  /**
   * Optional live balance provider (e.g. RpcBalanceProvider).
   * Defaults to MockBalanceProvider seeded from initial*Atomic.
   * Providers with `refresh()` are refreshed before each funding decision.
   */
  balances?: BalanceProvider;
  /**
   * When set, operator reads/writes (policy, spend, balances, unfiltered
   * execution lists, approve, deny) require `Authorization: Bearer <token>`.
   * Agent fund/pay/fulfill and requestHash resume stay open. Leave unset for
   * local demos; set AGENTTAB_ADMIN_TOKEN for hosted / Docker use.
   */
  adminToken?: string;
  /**
   * Optional webhook for first-time park / approve / deny.
   * Fail-open: notify errors never change funding.
   */
  notifyUrl?: string;
  notifyFetch?: typeof fetch;
}

export interface GatewayRuntime {
  app: Hono;
  store: SqliteExecutionStore;
  balances: BalanceProvider;
  dflow: DeficitFundingAdapter;
  fundingMode: FundingMode;
  wallet: string;
  broadcastEnabled: boolean;
  coordinator: GatewayFundingCoordinator;
  policies: PolicyStore;
  spend: SpendLedger;
  paymentHmacSecret: string;
  policyDurable: boolean;
  close: () => void;
}

function ensureDbDir(dbPath: string): void {
  if (dbPath === ":memory:") return;
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
}

async function transitionPayment(
  store: SqliteExecutionStore,
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

function createFundingAdapter(options: {
  fundingMode: FundingMode;
  failFunding: boolean;
  dflowApiKey?: string;
  dflowBaseUrl?: string;
  dflowFetch?: typeof fetch;
  solanaRpcUrl?: string;
  dflowAdapter?: DeficitFundingAdapter;
  liveSimFailClosed?: boolean;
  broadcastEnabled?: boolean;
}): DeficitFundingAdapter {
  if (options.dflowAdapter !== undefined) {
    return options.dflowAdapter;
  }
  if (options.fundingMode === "devnet-mint") {
    throw new Error(
      "fundingMode=devnet-mint requires an injected dflowAdapter (DevnetMintFundingAdapter)"
    );
  }
  if (options.fundingMode === "live-quote") {
    return new LiveQuoteDFlowAdapter({
      client: new DFlowClient({
        baseUrl: options.dflowBaseUrl ?? DFLOW_DEV_BASE_URL,
        ...(options.dflowApiKey === undefined ? {} : { apiKey: options.dflowApiKey }),
        ...(options.dflowFetch === undefined ? {} : { fetch: options.dflowFetch })
      })
    });
  }
  if (options.fundingMode === "live-sim") {
    const failClosed = options.liveSimFailClosed ?? false;
    const broadcastEnabled = options.broadcastEnabled ?? false;
    if (broadcastEnabled && !failClosed) {
      throw new Error(
        "broadcastEnabled requires liveSimFailClosed=true so failed simulations cannot be sent"
      );
    }
    return new LiveSimDFlowAdapter({
      client: new DFlowClient({
        baseUrl: options.dflowBaseUrl ?? DFLOW_DEV_BASE_URL,
        ...(options.dflowApiKey === undefined ? {} : { apiKey: options.dflowApiKey }),
        ...(options.dflowFetch === undefined ? {} : { fetch: options.dflowFetch })
      }),
      connection: new Connection(
        options.solanaRpcUrl ?? "https://api.mainnet-beta.solana.com",
        "confirmed"
      ),
      failClosedOnSimulationError: failClosed,
      allowBroadcastInPlan: broadcastEnabled
    });
  }
  return new MockDFlowAdapter({ failFunding: options.failFunding });
}

export function createGatewayRuntime(options: GatewayRuntimeOptions = {}): GatewayRuntime {
  const dbPath = options.dbPath ?? ":memory:";
  ensureDbDir(dbPath);
  const store = new SqliteExecutionStore(dbPath);
  const merchantOrigin = options.merchantOrigin ?? "http://127.0.0.1:8790";
  // 8790 = in-process HMAC paid-api demo. Adopt/neutral-merchant/Docker use 8791.
  const seedPolicy = options.policy ?? createDemoPolicy(merchantOrigin);
  const policyDurable = dbPath !== ":memory:";
  const policies: PolicyStore = policyDurable
    ? store.createPolicyStore(seedPolicy)
    : new InMemoryPolicyStore(seedPolicy);
  const fundingMode = options.fundingMode ?? "mock";
  const broadcastEnabled = options.broadcastEnabled ?? false;
  const adminToken = options.adminToken;
  const notify =
    options.notifyUrl !== undefined && options.notifyUrl.length > 0
      ? createOperatorNotifier({
          url: options.notifyUrl,
          ...(options.notifyFetch === undefined ? {} : { fetchImpl: options.notifyFetch })
        })
      : undefined;
  const emitNotify = async (
    event: OperatorNotifyEvent["event"],
    record: ExecutionRecord
  ): Promise<void> => {
    if (notify === undefined) return;
    try {
      await notify(operatorNotifyPayload(event, record));
    } catch {
      // Fail-open.
    }
  };
  const wallet =
    options.wallet ?? (fundingMode === "live-sim" ? LIVE_SIM_WALLET : DEMO_WALLET);
  const balances =
    options.balances ??
    new MockBalanceProvider([
      {
        mint: USDC_MINT,
        symbol: "USDC",
        balanceAtomic: options.initialUsdcAtomic ?? "200000",
        verified: true
      },
      {
        mint: WSOL_MINT,
        symbol: "SOL",
        balanceAtomic: options.initialSolAtomic ?? "5000000000",
        verified: true
      }
    ]);
  const dflow = createFundingAdapter({
    fundingMode,
    failFunding: options.failFunding ?? false,
    ...(options.dflowApiKey === undefined ? {} : { dflowApiKey: options.dflowApiKey }),
    ...(options.dflowBaseUrl === undefined ? {} : { dflowBaseUrl: options.dflowBaseUrl }),
    ...(options.dflowFetch === undefined ? {} : { dflowFetch: options.dflowFetch }),
    ...(options.solanaRpcUrl === undefined ? {} : { solanaRpcUrl: options.solanaRpcUrl }),
    ...(options.dflowAdapter === undefined ? {} : { dflowAdapter: options.dflowAdapter }),
    ...(options.liveSimFailClosed === undefined
      ? {}
      : { liveSimFailClosed: options.liveSimFailClosed }),
    broadcastEnabled
  });
  const spend = new InMemorySpendLedger();
  // Prefer durable spend whenever SQLite is on disk (Mainnet-safe daily caps).
  const durableSpend =
    dbPath !== ":memory:" ? store.createSpendLedger() : spend;
  const signer = options.signer ?? new SimulatedSigner();
  const coordinator = new GatewayFundingCoordinator({
    store,
    getPolicy: () => policies.get(),
    balances,
    dflow,
    signer,
    spend: durableSpend,
    wallet,
    ...(notify === undefined
      ? {}
      : {
          notifyParked: async (record) => {
            await notify(operatorNotifyPayload("approval_required", record));
          }
        })
  });
  const paymentHmacSecret = options.paymentHmacSecret ?? "local-dev-only-change-me";

  const app = new Hono();
  const adminRequired = adminToken !== undefined && adminToken.length > 0;
  const isAdmin = (header: string | undefined): boolean => {
    if (!adminRequired) return true;
    return header === `Bearer ${adminToken}`;
  };

  app.get("/", (c) => c.redirect("/ui", 302));
  app.get("/ui", (c) =>
    c.html(operatorHtml({ adminRequired, policyMode: policies.get().mode }))
  );
  app.get("/openapi.json", (c) => c.json(gatewayOpenApiDocument()));

  app.get("/health", async (c) => {
    const parked = await store.listRecent({ state: "approval_required", limit: 100 });
    const policy = policies.get();
    return c.json({
      ok: true,
      service: "agenttab-gateway",
      fundingMode,
      wallet,
      broadcastEnabled,
      policyDurable,
      policyMode: policy.mode,
      policyWriteAuth: adminRequired,
      operatorUi: "/ui",
      preview: "/v1/preview",
      openapi: "/openapi.json",
      notifyConfigured: notify !== undefined,
      parkedCount: parked.length,
      spentUsdMicrosLast24h: durableSpend.getSpentUsdMicrosLast24h(),
      maxDailyUsdMicros: policy.maxDailyUsdMicros
    });
  });

  app.get("/v1/spend", (c) => {
    if (!isAdmin(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const policy = policies.get();
    return c.json({
      spentUsdMicrosLast24h: durableSpend.getSpentUsdMicrosLast24h(),
      maxDailyUsdMicros: policy.maxDailyUsdMicros,
      maxPaymentUsdMicros: policy.maxPaymentUsdMicros
    });
  });

  app.get("/v1/policy", (c) => {
    if (!isAdmin(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json(policies.get());
  });

  app.put("/v1/policy", async (c) => {
    if (!isAdmin(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const parsed = paymentPolicySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "invalid_policy", message: parsed.error.message }, 400);
    }
    return c.json(policies.set(parsed.data));
  });

  app.get("/v1/balances", (c) => {
    if (!isAdmin(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json({ wallet, balances: balances.list() });
  });

  app.get("/v1/executions", async (c) => {
    const limitRaw = c.req.query("limit");
    const stateRaw = c.req.query("state");
    const requestHash = c.req.query("requestHash");
    const reusableRaw = c.req.query("reusable");
    const limit = limitRaw === undefined ? 20 : Number(limitRaw);
    if (!Number.isFinite(limit) || limit < 1) {
      return c.json({ error: "invalid_limit" }, 400);
    }
    if (stateRaw !== undefined && !isExecutionState(stateRaw)) {
      return c.json({ error: "invalid_state" }, 400);
    }
    if (
      requestHash !== undefined &&
      (requestHash.length < 16 || requestHash.length > 256)
    ) {
      return c.json({ error: "invalid_request_hash" }, 400);
    }
    const reusable = reusableRaw === "1" || reusableRaw === "true";
    const listingWithoutHash = requestHash === undefined || requestHash.length === 0;
    if (listingWithoutHash && !isAdmin(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const executions = await store.listRecent({
      limit,
      ...(stateRaw === undefined ? {} : { state: stateRaw }),
      ...(requestHash === undefined ? {} : { requestHash }),
      ...(reusable ? { reusable: true } : {})
    });
    return c.json({ executions, count: executions.length });
  });

  app.post("/v1/executions", async (c) => {
    const body = paymentIntentSchema.parse(await c.req.json());
    const result = await store.createOrGet(body);
    return c.json(result, result.created ? 201 : 200);
  });

  app.get("/v1/executions/:operationId", async (c) => {
    const record = await store.get(c.req.param("operationId"));
    if (record === undefined) return c.json({ error: "not_found" }, 404);
    return c.json(record);
  });

  app.post("/v1/preview", async (c) => {
    const parsed = paymentIntentSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "invalid_intent", message: parsed.error.message }, 400);
    }
    const policy = policies.get();
    const spend = { spentUsdMicrosLast24h: durableSpend.getSpentUsdMicrosLast24h() };
    const decision = evaluatePaymentPolicy({
      intent: parsed.data,
      policy,
      spend
    });
    return c.json({
      preview: true,
      funded: false,
      policyMode: policy.mode,
      decision,
      hint: previewHint(decision, parsed.data.merchantOrigin),
      observeIsNotDryRun: policy.mode === "observe"
    });
  });

  app.post("/v1/fund", async (c) => {
    const intent = paymentIntentSchema.parse(await c.req.json());
    const outcome = await coordinator.ensurePaymentAsset({ intent });
    const record = await store.get(intent.operationId);
    return c.json({ outcome, record });
  });

  app.post("/v1/approvals/:operationId", async (c) => {
    if (!isAdmin(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const operationId = c.req.param("operationId");
    let record = await store.get(operationId);
    if (record === undefined) return c.json({ error: "not_found" }, 404);
    if (record.state !== "approval_required") {
      return c.json({ error: "not_awaiting_approval", state: record.state }, 409);
    }
    record = await transitionPayment(store, record, "approved", "approval.granted");
    await emitNotify("approved", record);
    const outcome = await coordinator.ensurePaymentAsset({ intent: record.intent });
    record = (await store.get(operationId))!;
    return c.json({ outcome, record });
  });

  app.post("/v1/denials/:operationId", async (c) => {
    if (!isAdmin(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const operationId = c.req.param("operationId");
    let record = await store.get(operationId);
    if (record === undefined) return c.json({ error: "not_found" }, 404);
    if (record.state !== "approval_required") {
      return c.json({ error: "not_awaiting_approval", state: record.state }, 409);
    }
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    record = await transitionPayment(store, record, "denied", "approval.denied", {
      reason: body.reason ?? "operator_denied"
    });
    await emitNotify("denied", record);
    return c.json({
      denied: true,
      funded: false,
      record
    });
  });

  app.post("/v1/executions/:operationId/pay", async (c) => {
    const operationId = c.req.param("operationId");
    let record = await store.get(operationId);
    if (record === undefined) return c.json({ error: "not_found" }, 404);

    if (record.state === "paid" || record.state === "fulfilled" || record.state === "fulfillment_failed") {
      if (record.intent.amountUsdMicros !== undefined) {
        durableSpend.ensureOperationSpend(operationId, record.intent.amountUsdMicros);
      }
      const existing = record.events.find(
        (event) => event.kind === "payment.token_issued" || event.kind === "payment.settled"
      );
      const token =
        existing?.details && typeof existing.details.token === "string"
          ? existing.details.token
          : undefined;
      const settlementId =
        existing?.details && typeof existing.details.settlementId === "string"
          ? existing.details.settlementId
          : undefined;
      return c.json({ token, settlementId, record, replayed: true });
    }

    if (record.state !== "funded" && record.state !== "payment_submitted") {
      return c.json({ error: "not_funded", state: record.state }, 409);
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      fail?: boolean;
      /** External x402 facilitator settlement (Devnet/mainnet). */
      settlementId?: string;
      transaction?: string;
    };
    if (body.fail === true) {
      // Keep non-terminal state so payment can retry without re-funding.
      if (record.state === "funded") {
        record = await transitionPayment(store, record, "payment_submitted", "payment.attempt_failed", {
          message: "Simulated payment failure"
        });
      }
      return c.json({ error: "payment_failed", record }, 502);
    }

    if (record.state === "funded") {
      record = await transitionPayment(store, record, "payment_submitted", "payment.submitted");
    }

    if (body.settlementId) {
      record = await transitionPayment(store, record, "paid", "payment.settled", {
        settlementId: body.settlementId,
        ...(body.transaction === undefined ? {} : { transaction: body.transaction })
      });
      if (record.intent.amountUsdMicros !== undefined) {
        durableSpend.ensureOperationSpend(operationId, record.intent.amountUsdMicros);
      }
      return c.json({ settlementId: body.settlementId, record, replayed: false });
    }

    const now = new Date();
    const claims = {
      operationId: record.operationId,
      amountAtomic: record.intent.amountAtomic,
      assetMint: record.intent.assetMint,
      destination: record.intent.destination,
      merchantOrigin: record.intent.merchantOrigin,
      resource: record.intent.resource,
      network: record.intent.network,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString()
    };
    const token = issuePaymentToken(claims, paymentHmacSecret);

    record = await transitionPayment(store, record, "paid", "payment.token_issued", {
      token,
      settlementId: `local-${operationId}`
    });

    if (record.intent.amountUsdMicros !== undefined) {
      durableSpend.ensureOperationSpend(operationId, record.intent.amountUsdMicros);
    }

    return c.json({ token, record, replayed: false });
  });

  app.post("/v1/executions/:operationId/fulfill", async (c) => {
    const operationId = c.req.param("operationId");
    let record = await store.get(operationId);
    if (record === undefined) return c.json({ error: "not_found" }, 404);

    if (record.state === "fulfilled") {
      return c.json({ record, replayed: true });
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      fail?: boolean;
      responseHash?: string;
    };

    if (record.state === "paid" || record.state === "fulfillment_failed") {
      if (body.fail === true) {
        record = await transitionPayment(store, record, "fulfillment_failed", "resource.fulfillment_failed");
        return c.json({ error: "fulfillment_failed", record }, 502);
      }
      record = await transitionPayment(store, record, "fulfilled", "resource.fulfilled", {
        responseHash: body.responseHash ?? "sha256:local"
      });
      return c.json({ record, replayed: false });
    }

    return c.json({ error: "not_paid", state: record.state }, 409);
  });

  app.post("/v1/settlements/verify", async (c) => {
    const body = (await c.req.json()) as { token?: string };
    if (!body.token) return c.json({ error: "token_required" }, 400);
    try {
      const claims = verifyPaymentToken(body.token, paymentHmacSecret);
      return c.json({ valid: true, claims });
    } catch (error) {
      return c.json(
        {
          valid: false,
          error: error instanceof Error ? error.message : "invalid_token"
        },
        401
      );
    }
  });

  app.onError((error, c) => {
    if (error instanceof InvalidExecutionTransitionError) {
      return c.json({ error: "invalid_transition", message: error.message }, 409);
    }
    if (error instanceof ExecutionVersionConflictError) {
      return c.json({ error: "version_conflict", message: error.message }, 409);
    }
    if (error instanceof Error && error.name === "ZodError") {
      return c.json({ error: "invalid_intent", message: error.message }, 400);
    }
    console.error(error);
    return c.json({ error: "internal_error" }, 500);
  });

  return {
    app,
    store,
    balances,
    dflow,
    fundingMode,
    wallet,
    broadcastEnabled,
    coordinator,
    policies,
    spend: durableSpend,
    paymentHmacSecret,
    policyDurable,
    close: () => store.close()
  };
}

function previewHint(decision: PolicyDecision, merchantOrigin: string): string {
  switch (decision.reason) {
    case "merchant_not_allowed":
      return `Add ${merchantOrigin} to allowedMerchantOrigins (PUT /v1/policy or the operator UI).`;
    case "network_not_allowed":
      return "Add this CAIP-2 network to allowedNetworks on the live policy.";
    case "payment_asset_not_allowed":
      return "Add this mint to allowedPaymentAssets on the live policy.";
    case "usd_value_unknown":
      return "Provide amountUsdMicros. observe parks; approve/autopay deny. Approving still funds.";
    case "approval_threshold_exceeded":
    case "allowed":
      return decision.kind === "approval_required"
        ? "Policy would park. POST /v1/approvals/:id still funds — this preview did not."
        : "Policy would allow funding. This preview did not create an execution or fund.";
    default:
      return decision.message;
  }
}

export type { PaymentIntent };

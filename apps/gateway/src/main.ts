import { serve } from "@hono/node-server";
import { DFLOW_DEV_BASE_URL } from "@agenttab/dflow";
import { createGatewayRuntime, type FundingMode } from "./app.js";
import { parseAgentTokenMap } from "./agent-identity.js";
import { notifyBoundsFromEnv } from "./notify.js";
import { loadPolicyFromEnv } from "./policy/load-policy-file.js";

const port = Number(process.env.PORT ?? "8787");
const host = process.env.HOST ?? "127.0.0.1";
const fundingMode = (process.env.AGENTTAB_FUNDING_MODE ?? "mock") as FundingMode;
const supported: FundingMode[] = ["mock", "live-quote", "live-sim"];
if (!supported.includes(fundingMode)) {
  throw new Error(
    `Unsupported AGENTTAB_FUNDING_MODE for standalone gateway: ${fundingMode}. Use one of: ${supported.join(", ")}`
  );
}

const dflowApiKey = process.env.DFLOW_API_KEY;
const dflowBaseUrl =
  process.env.DFLOW_BASE_URL ??
  (fundingMode === "live-quote" || fundingMode === "live-sim"
    ? DFLOW_DEV_BASE_URL
    : undefined);
const solanaRpcUrl = process.env.SOLANA_RPC_URL;
const liveSimFailClosed = process.env.AGENTTAB_LIVE_SIM_FAIL_CLOSED === "1";
/** Hard default: never broadcast from the standalone gateway process. */
const broadcastEnabled = false;
if (process.env.AGENTTAB_BROADCAST === "1") {
  throw new Error(
    "Standalone gateway refuses AGENTTAB_BROADCAST=1. Use the explicit Mainnet agent entrypoint after human approval."
  );
}

const policyFromFile = loadPolicyFromEnv();
const notifyBounds = notifyBoundsFromEnv();
const merchantOrigin =
  process.env.MERCHANT_ORIGIN ??
  policyFromFile?.policy.allowedMerchantOrigins[0] ??
  "http://127.0.0.1:8790";

const runtime = createGatewayRuntime({
  dbPath: process.env.AGENTTAB_DB_PATH ?? ".data/gateway.sqlite",
  merchantOrigin,
  paymentHmacSecret:
    process.env.PAYMENT_HMAC_SECRET ??
    process.env.AGENTTAB_PAYMENT_HMAC_SECRET ??
    "local-dev-only-change-me",
  fundingMode,
  ...(policyFromFile === undefined ? {} : { policy: policyFromFile.policy }),
  ...(dflowApiKey === undefined ? {} : { dflowApiKey }),
  ...(dflowBaseUrl === undefined ? {} : { dflowBaseUrl }),
  ...(solanaRpcUrl === undefined ? {} : { solanaRpcUrl }),
  liveSimFailClosed,
  broadcastEnabled,
  ...(process.env.AGENTTAB_ADMIN_TOKEN
    ? { adminToken: process.env.AGENTTAB_ADMIN_TOKEN }
    : {}),
  ...(process.env.AGENTTAB_AGENT_TOKEN
    ? { agentToken: process.env.AGENTTAB_AGENT_TOKEN }
    : {}),
  ...(process.env.AGENTTAB_AGENT_ID
    ? { agentId: process.env.AGENTTAB_AGENT_ID }
    : {}),
  ...(process.env.AGENTTAB_AGENT_TOKENS
    ? { agentTokens: parseAgentTokenMap(process.env.AGENTTAB_AGENT_TOKENS) }
    : {}),
  ...(process.env.AGENTTAB_INITIAL_USDC_ATOMIC
    ? { initialUsdcAtomic: process.env.AGENTTAB_INITIAL_USDC_ATOMIC }
    : {}),
  ...(process.env.AGENTTAB_INITIAL_SOL_ATOMIC
    ? { initialSolAtomic: process.env.AGENTTAB_INITIAL_SOL_ATOMIC }
    : {}),
  ...(process.env.AGENTTAB_NOTIFY_URL
    ? { notifyUrl: process.env.AGENTTAB_NOTIFY_URL }
    : {}),
  ...(process.env.AGENTTAB_NOTIFY_SECRET
    ? { notifySecret: process.env.AGENTTAB_NOTIFY_SECRET }
    : {}),
  notifyBudgetMs: notifyBounds.budgetMs,
  notifyAttemptTimeoutMs: notifyBounds.attemptTimeoutMs
});

if (policyFromFile?.replace === true) {
  runtime.policies.set(policyFromFile.policy);
}

serve({ fetch: runtime.app.fetch, port, hostname: host }, (info) => {
  const policy = runtime.policies.get();
  console.log(
    JSON.stringify(
      {
        phase: "gateway-listen",
        url: `http://${host}:${info.port}`,
        operatorUi: `http://${host}:${info.port}/ui`,
        openapi: `http://${host}:${info.port}/openapi.json`,
        fundingMode,
        wallet: runtime.wallet,
        broadcastEnabled: runtime.broadcastEnabled,
        policyDurable: runtime.policyDurable,
        policyMode: policy.mode,
        policySource: policyFromFile?.path ?? "demo-seed",
        policyReplaced: policyFromFile?.replace === true,
        allowedMerchantOrigins: policy.allowedMerchantOrigins,
        notifyUrl: process.env.AGENTTAB_NOTIFY_URL ?? null,
        notifyBudgetMs: notifyBounds.budgetMs,
        notifyAttemptTimeoutMs: notifyBounds.attemptTimeoutMs
      },
      null,
      2
    )
  );
  if (fundingMode === "live-sim") {
    console.log("live-sim: DFlow order + simulateTransaction only; never sendTransaction");
  }
});

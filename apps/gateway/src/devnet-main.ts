import { serve } from "@hono/node-server";
import { createDevnetGatewayRuntime } from "./devnet-runtime.js";
import { loadPolicyFromEnv } from "./policy/load-policy-file.js";

const port = Number(process.env.PORT ?? "8787");
const host = process.env.HOST ?? "127.0.0.1";
const policyFromFile = loadPolicyFromEnv();
const merchantOrigin =
  process.env.MERCHANT_ORIGIN ??
  policyFromFile?.policy.allowedMerchantOrigins[0] ??
  "http://127.0.0.1:8791";

if (process.env.AGENTTAB_BROADCAST === "1") {
  throw new Error(
    "Devnet standalone gateway refuses AGENTTAB_BROADCAST=1 (mint adapter does not broadcast funding txs)."
  );
}

const runtime = await createDevnetGatewayRuntime({
  merchantOrigin,
  ...(policyFromFile === undefined ? {} : { policy: policyFromFile.policy }),
  ...(process.env.AGENTTAB_DB_PATH ? { dbPath: process.env.AGENTTAB_DB_PATH } : {}),
  ...(process.env.AGENTTAB_ADMIN_TOKEN
    ? { adminToken: process.env.AGENTTAB_ADMIN_TOKEN }
    : {}),
  ...(process.env.AGENTTAB_INITIAL_USDC_ATOMIC
    ? { paymentBalanceAtomic: process.env.AGENTTAB_INITIAL_USDC_ATOMIC }
    : {}),
  ...(process.env.AGENTTAB_INITIAL_SOL_ATOMIC
    ? { solBalanceAtomic: process.env.AGENTTAB_INITIAL_SOL_ATOMIC }
    : {})
});

if (policyFromFile?.replace === true) {
  runtime.policies.set(policyFromFile.policy);
}

serve({ fetch: runtime.app.fetch, port, hostname: host }, (info) => {
  const policy = runtime.policies.get();
  console.log(
    JSON.stringify(
      {
        phase: "gateway-devnet-listen",
        url: `http://${host}:${info.port}`,
        fundingMode: runtime.fundingMode,
        wallet: runtime.wallet,
        mint: runtime.paths.mint.toBase58(),
        merchantOrigin,
        policyDurable: runtime.policyDurable,
        policyMode: policy.mode,
        policySource: policyFromFile?.path ?? "devnet-seed",
        policyReplaced: policyFromFile?.replace === true,
        broadcastEnabled: runtime.broadcastEnabled
      },
      null,
      2
    )
  );
});

#!/usr/bin/env node
/**
 * Change only the live policy mode (observe | approve | autopay).
 *
 *   pnpm policy:mode -- approve
 *   agenttab-policy-mode
 */
import { paymentPolicySchema, type PaymentPolicy } from "@agenttab/core";
import { gatewayFetch } from "./gateway-http.js";
import { resolvePolicyMode } from "./policy-mode-args.js";

async function main(): Promise<void> {
  const mode = resolvePolicyMode(process.argv.slice(2));
  const current = await gatewayFetch("/v1/policy");
  const currentBody = await current.json();
  if (!current.ok) {
    console.error(
      JSON.stringify(
        { error: "policy_get_failed", status: current.status, body: currentBody },
        null,
        2
      )
    );
    process.exit(1);
  }
  const parsed = paymentPolicySchema.safeParse({
    ...(currentBody as PaymentPolicy),
    mode
  });
  if (!parsed.success) {
    console.error(
      JSON.stringify({ error: "invalid_policy", message: parsed.error.message }, null, 2)
    );
    process.exit(2);
  }
  const response = await gatewayFetch("/v1/policy", {
    method: "PUT",
    body: JSON.stringify(parsed.data)
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(
      JSON.stringify({ error: "policy_mode_failed", status: response.status, body }, null, 2)
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      { ok: true, mode: (body as { mode?: string }).mode, previous: (currentBody as PaymentPolicy).mode },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

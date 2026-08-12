#!/usr/bin/env node
/**
 * Add one merchant origin to the live policy (no restart).
 *
 *   pnpm policy:allow -- http://127.0.0.1:8791
 *   agenttab-policy-allow
 */
import { paymentPolicySchema, type PaymentPolicy } from "@agenttab/core";
import { gatewayFetch } from "./gateway-http.js";
import { resolveMerchantOrigin } from "./policy-allow-args.js";

async function main(): Promise<void> {
  const origin = resolveMerchantOrigin(process.argv.slice(2));
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
  const policy = currentBody as PaymentPolicy;
  const origins = Array.isArray(policy.allowedMerchantOrigins)
    ? [...policy.allowedMerchantOrigins]
    : [];
  const added = !origins.includes(origin);
  if (added) origins.push(origin);
  const parsed = paymentPolicySchema.safeParse({
    ...policy,
    allowedMerchantOrigins: origins
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
      JSON.stringify({ error: "policy_allow_failed", status: response.status, body }, null, 2)
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        added,
        origin,
        allowedMerchantOrigins: (body as PaymentPolicy).allowedMerchantOrigins
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

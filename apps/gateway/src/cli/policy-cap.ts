#!/usr/bin/env node
/**
 * Change one spend cap on the live policy.
 *
 *   pnpm policy:cap -- daily 2000000
 *   pnpm policy:cap -- payment 10000
 *   pnpm policy:cap -- approve-above 5000
 *   pnpm policy:cap -- approve-above -
 */
import { paymentPolicySchema, type PaymentPolicy } from "@agenttab/core";
import { gatewayFetch } from "./gateway-http.js";
import { resolvePolicyCap } from "./policy-cap-args.js";

async function main(): Promise<void> {
  const change = resolvePolicyCap(process.argv.slice(2));
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
  const policy = { ...(currentBody as PaymentPolicy) };
  if (change.field === "daily") policy.maxDailyUsdMicros = change.value!;
  if (change.field === "payment") policy.maxPaymentUsdMicros = change.value!;
  if (change.field === "approve-above") {
    if (change.value === null) {
      delete policy.requireApprovalAboveUsdMicros;
    } else {
      policy.requireApprovalAboveUsdMicros = change.value;
    }
  }
  const parsed = paymentPolicySchema.safeParse(policy);
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
      JSON.stringify({ error: "policy_cap_failed", status: response.status, body }, null, 2)
    );
    process.exit(1);
  }
  const next = body as PaymentPolicy;
  console.log(
    JSON.stringify(
      {
        ok: true,
        field: change.field,
        maxPaymentUsdMicros: next.maxPaymentUsdMicros,
        maxDailyUsdMicros: next.maxDailyUsdMicros,
        requireApprovalAboveUsdMicros: next.requireApprovalAboveUsdMicros ?? null
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

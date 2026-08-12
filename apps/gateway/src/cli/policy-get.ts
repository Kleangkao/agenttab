#!/usr/bin/env node
/**
 * Read the live gateway policy.
 *
 *   pnpm policy:get
 *   agenttab-policy-get
 */
import { gatewayFetch } from "./gateway-http.js";

async function main(): Promise<void> {
  const response = await gatewayFetch("/v1/policy");
  const body = await response.json();
  if (!response.ok) {
    console.error(JSON.stringify({ error: "policy_get_failed", status: response.status, body }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(body, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

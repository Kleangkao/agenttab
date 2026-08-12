#!/usr/bin/env node
/**
 * Update the live gateway policy from a JSON file (no restart required).
 *
 *   pnpm policy:set -- examples/policies/approve.local.json
 *   agenttab-policy-set
 */
import { loadPolicyFile } from "../policy/load-policy-file.js";
import { gatewayFetch } from "./gateway-http.js";

function resolvePolicyPath(argv: string[]): string {
  const flagIndex = argv.findIndex((arg) => arg === "--" || arg === "--file" || arg === "-f");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1]!;
  }
  const positional = argv.find((arg) => !arg.startsWith("-") && arg.endsWith(".json"));
  if (positional) return positional;
  const fromEnv = process.env.AGENTTAB_POLICY_PATH?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    "Usage: pnpm policy:set -- <policy.json>   or set AGENTTAB_POLICY_PATH"
  );
}

async function main(): Promise<void> {
  const path = resolvePolicyPath(process.argv.slice(2));
  const policy = loadPolicyFile(path);
  const response = await gatewayFetch("/v1/policy", {
    method: "PUT",
    body: JSON.stringify(policy)
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(
      JSON.stringify({ error: "policy_set_failed", status: response.status, body }, null, 2)
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        source: path,
        mode: (body as { mode?: string }).mode,
        allowedMerchantOrigins: (body as { allowedMerchantOrigins?: string[] })
          .allowedMerchantOrigins
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

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paymentPolicySchema, type PaymentPolicy } from "@agenttab/core";

/**
 * Load a PaymentPolicy JSON file. Strips optional `notes` for human comments.
 * Fail-closed: invalid schema throws.
 */
export function loadPolicyFile(path: string): PaymentPolicy {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    // pnpm --filter / package cwd: also try repo-root relative.
    const fromRepoRoot = resolve(process.cwd(), "../..", path);
    if (existsSync(fromRepoRoot)) {
      return parsePolicyJson(readFileSync(fromRepoRoot, "utf8"), fromRepoRoot);
    }
    throw new Error(`Policy file not found: ${absolute}`);
  }
  return parsePolicyJson(readFileSync(absolute, "utf8"), absolute);
}

function parsePolicyJson(raw: string, source: string): PaymentPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Policy file ${source} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (parsed !== null && typeof parsed === "object" && "notes" in parsed) {
    delete (parsed as { notes?: unknown }).notes;
  }
  const result = paymentPolicySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Policy file ${source} failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Resolve optional policy for standalone gateway boot.
 * `AGENTTAB_POLICY_JSON` wins (Docker/env bootstrap). Else `AGENTTAB_POLICY_PATH`.
 * Returns undefined when neither is set (caller keeps demo seed).
 */
export function loadPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): { policy: PaymentPolicy; path: string; replace: boolean } | undefined {
  const json = env.AGENTTAB_POLICY_JSON?.trim();
  if (json !== undefined && json.length > 0) {
    return {
      policy: parsePolicyJson(json, "AGENTTAB_POLICY_JSON"),
      path: "AGENTTAB_POLICY_JSON",
      replace: env.AGENTTAB_POLICY_REPLACE === "1"
    };
  }
  const path = env.AGENTTAB_POLICY_PATH?.trim();
  if (path === undefined || path.length === 0) return undefined;
  return {
    policy: loadPolicyFile(path),
    path: resolve(path),
    replace: env.AGENTTAB_POLICY_REPLACE === "1"
  };
}

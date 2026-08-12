import { createHash } from "node:crypto";

/**
 * Canonical request binding hash used by AgentTab executions.
 * Format matches gateway demos: `sha256:${hex(method\\nurl\\nbody)}`.
 */
export function hashHttpRequest(method: string, url: string, body = ""): string {
  return `sha256:${createHash("sha256").update(`${method}\n${url}\n${body}`).digest("hex")}`;
}

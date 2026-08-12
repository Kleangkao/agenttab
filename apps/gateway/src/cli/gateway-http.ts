/**
 * Shared HTTP helpers for operator CLIs that talk to a running gateway.
 */
export function gatewayBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.AGENTTAB_GATEWAY_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
}

/**
 * Prefer HTTP whenever a gateway URL is set (Docker image always has
 * AGENTTAB_DB_PATH=/data/gateway.sqlite; that must not hide the live server).
 * Use a local DB only when no URL is set.
 */
export function shouldAuditOverHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  const gatewayExplicit =
    env.AGENTTAB_GATEWAY_URL !== undefined && env.AGENTTAB_GATEWAY_URL.length > 0;
  return gatewayExplicit;
}

export function gatewayHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  const admin = env.AGENTTAB_ADMIN_TOKEN?.trim();
  const agent = env.AGENTTAB_AGENT_TOKEN?.trim();
  const token = admin || agent;
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function gatewayFetch(
  path: string,
  init?: RequestInit,
  env: NodeJS.ProcessEnv = process.env
): Promise<Response> {
  const url = `${gatewayBaseUrl(env)}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    ...init,
    headers: {
      ...gatewayHeaders(env),
      ...(init?.headers ?? {})
    }
  });
}

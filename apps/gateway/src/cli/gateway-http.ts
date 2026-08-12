/**
 * Shared HTTP helpers for operator CLIs that talk to a running gateway.
 */
export function gatewayBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.AGENTTAB_GATEWAY_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
}

/** HTTP audit when a remote gateway is named and local DB path is not. */
export function shouldAuditOverHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  const dbExplicit = env.AGENTTAB_DB_PATH !== undefined && env.AGENTTAB_DB_PATH.length > 0;
  const gatewayExplicit =
    env.AGENTTAB_GATEWAY_URL !== undefined && env.AGENTTAB_GATEWAY_URL.length > 0;
  return gatewayExplicit && !dbExplicit;
}

export function gatewayHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  const token = env.AGENTTAB_ADMIN_TOKEN?.trim();
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

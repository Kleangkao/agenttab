export const DEFAULT_AGENT_ID = "agent";
export const AGENT_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export function parseAgentTokenMap(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AGENTTAB_AGENT_TOKENS must be a JSON object of { agentId: token }");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AGENTTAB_AGENT_TOKENS must be a JSON object of { agentId: token }");
  }
  const out: Record<string, string> = {};
  const seenTokens = new Map<string, string>();
  for (const [id, token] of Object.entries(parsed as Record<string, unknown>)) {
    if (!AGENT_ID_PATTERN.test(id)) {
      throw new Error(`Invalid AGENTTAB_AGENT_TOKENS id: ${id}`);
    }
    if (typeof token !== "string" || token.length === 0) {
      throw new Error(`AGENTTAB_AGENT_TOKENS.${id} must be a non-empty string`);
    }
    const owner = seenTokens.get(token);
    if (owner !== undefined) {
      throw new Error("AGENTTAB_AGENT_TOKENS values must be unique per agent");
    }
    seenTokens.set(token, id);
    out[id] = token;
  }
  return out;
}

export function mergeAgentCredentials(input: {
  agentToken?: string | undefined;
  agentId?: string | undefined;
  agentTokens?: Record<string, string> | undefined;
}): { tokens: Record<string, string>; ids: string[] } {
  const tokens: Record<string, string> = { ...(input.agentTokens ?? {}) };
  if (input.agentToken !== undefined && input.agentToken.length > 0) {
    const id =
      input.agentId !== undefined && input.agentId.length > 0
        ? input.agentId
        : DEFAULT_AGENT_ID;
    if (!AGENT_ID_PATTERN.test(id)) {
      throw new Error(`Invalid AGENTTAB_AGENT_ID: ${id}`);
    }
    const clash = Object.entries(tokens).find(([, secret]) => secret === input.agentToken);
    if (clash !== undefined && clash[0] !== id) {
      throw new Error("AGENTTAB_AGENT_TOKEN collides with AGENTTAB_AGENT_TOKENS");
    }
    if (tokens[id] !== undefined && tokens[id] !== input.agentToken) {
      throw new Error(`Duplicate agent id ${id}`);
    }
    tokens[id] = input.agentToken;
  }
  return { tokens, ids: Object.keys(tokens).sort() };
}

export function resolveAgentIdFromBearer(
  header: string | undefined,
  tokens: Record<string, string>
): string | undefined {
  if (header === undefined) return undefined;
  for (const [id, token] of Object.entries(tokens)) {
    if (header === `Bearer ${token}`) return id;
  }
  return undefined;
}

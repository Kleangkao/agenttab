import {
  DEXTER_FACILITATOR_URL,
  PAYAI_FACILITATOR_URL,
  SOLANA_MAINNET
} from "./constants.js";

export interface FacilitatorKindSummary {
  scheme: string;
  network: string;
  feePayer: string | null;
  minPaymentAmountAtomic: string | null;
}

export interface FacilitatorHealthResult {
  url: string;
  label: "dexter" | "payai" | "custom";
  reachable: boolean;
  healthOk: boolean;
  supportedOk: boolean;
  mainnetExact: FacilitatorKindSummary | null;
  error: string | null;
  latencyMs: number;
}

export interface FacilitatorHealthReport {
  checkedAt: string;
  network: string;
  results: FacilitatorHealthResult[];
  /** Prefer a reachable Mainnet exact facilitator; never spends funds. */
  recommendedUrl: string | null;
  notes: string[];
}

function labelFor(url: string): FacilitatorHealthResult["label"] {
  if (url.replace(/\/$/, "") === DEXTER_FACILITATOR_URL) return "dexter";
  if (url.replace(/\/$/, "") === PAYAI_FACILITATOR_URL) return "payai";
  return "custom";
}

function parseMainnetExact(payload: unknown): FacilitatorKindSummary | null {
  const kinds = Array.isArray((payload as { kinds?: unknown[] })?.kinds)
    ? (payload as { kinds: Array<Record<string, unknown>> }).kinds
    : [];
  const match = kinds.find(
    (kind) => kind.network === SOLANA_MAINNET && kind.scheme === "exact"
  );
  if (!match) return null;
  const extra = (match.extra ?? {}) as {
    feePayer?: unknown;
    minPaymentAmountAtomic?: unknown;
  };
  const min =
    typeof extra.minPaymentAmountAtomic === "string" &&
    /^\d+$/.test(extra.minPaymentAmountAtomic)
      ? extra.minPaymentAmountAtomic
      : null;
  return {
    scheme: "exact",
    network: SOLANA_MAINNET,
    feePayer: typeof extra.feePayer === "string" ? extra.feePayer : null,
    minPaymentAmountAtomic: min
  };
}

async function probeOne(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<FacilitatorHealthResult> {
  const base = url.replace(/\/$/, "");
  const started = Date.now();
  const result: FacilitatorHealthResult = {
    url: base,
    label: labelFor(base),
    reachable: false,
    healthOk: false,
    supportedOk: false,
    mainnetExact: null,
    error: null,
    latencyMs: 0
  };

  try {
    const healthRes = await fetchImpl(`${base}/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    result.reachable = true;
    result.healthOk = healthRes.ok;

    const supportedRes = await fetchImpl(`${base}/supported`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    result.supportedOk = supportedRes.ok;
    if (supportedRes.ok) {
      result.mainnetExact = parseMainnetExact(await supportedRes.json());
    } else {
      result.error = `supported_status_${supportedRes.status}`;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  result.latencyMs = Date.now() - started;
  return result;
}

/**
 * Read-only facilitator probes. Does not verify or settle payments.
 * Recommendation prefers Dexter when Mainnet exact is advertised, else PayAI,
 * else first healthy custom URL.
 */
export async function checkFacilitatorHealth(
  options: {
    urls?: string[];
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    preferUrl?: string;
  } = {}
): Promise<FacilitatorHealthReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const urls = options.urls ?? [DEXTER_FACILITATOR_URL, PAYAI_FACILITATOR_URL];
  const results: FacilitatorHealthResult[] = [];
  for (const url of urls) {
    results.push(await probeOne(url, fetchImpl, timeoutMs));
  }

  const notes: string[] = [
    "Health checks are read-only (/health + /supported). They do not prove settle/simulation works.",
    "If Dexter advertises Mainnet exact but settle fails with simulation fetch errors, use PayAI."
  ];

  const usable = results.filter(
    (r) => r.reachable && r.supportedOk && r.mainnetExact?.feePayer
  );

  let recommendedUrl: string | null = null;
  const prefer = options.preferUrl?.replace(/\/$/, "");
  if (prefer && usable.some((r) => r.url === prefer)) {
    recommendedUrl = prefer;
  } else {
    const dexter = usable.find((r) => r.label === "dexter");
    const payai = usable.find((r) => r.label === "payai");
    recommendedUrl = dexter?.url ?? payai?.url ?? usable[0]?.url ?? null;
  }

  if (!recommendedUrl) {
    notes.push("No facilitator advertised Solana Mainnet exact with a feePayer.");
  }

  return {
    checkedAt: new Date().toISOString(),
    network: SOLANA_MAINNET,
    results,
    recommendedUrl,
    notes
  };
}

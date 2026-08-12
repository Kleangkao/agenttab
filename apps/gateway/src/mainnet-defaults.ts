/**
 * Shared Mainnet tooling defaults. Prefer production DFlow when an API key is present;
 * otherwise use the open dev quote API for no-funds dry-runs.
 */
import { DFLOW_DEV_BASE_URL, DFLOW_PROD_BASE_URL } from "@agenttab/dflow";
import {
  DEXTER_FACILITATOR_URL,
  DEXTER_MAINNET_MIN_PAYMENT_ATOMIC,
  MAINNET_MIN_TEST_PAYMENT_ATOMIC,
  SOLANA_MAINNET
} from "./constants.js";

export interface FacilitatorMinimumResult {
  facilitatorUrl: string;
  network: string;
  scheme: string;
  minPaymentAmountAtomic: string;
  minPaymentAmountUsd: number | null;
}

export function resolveMainnetDflowBaseUrl(): {
  baseUrl: string;
  source: "env" | "prod-with-key" | "dev-fallback";
} {
  if (process.env.DFLOW_BASE_URL) {
    return { baseUrl: process.env.DFLOW_BASE_URL, source: "env" };
  }
  if (process.env.DFLOW_API_KEY) {
    return { baseUrl: DFLOW_PROD_BASE_URL, source: "prod-with-key" };
  }
  return { baseUrl: DFLOW_DEV_BASE_URL, source: "dev-fallback" };
}

export function resolvePaymentAtomicFloor(
  requestedAtomic = MAINNET_MIN_TEST_PAYMENT_ATOMIC,
  minimumAtomic = DEXTER_MAINNET_MIN_PAYMENT_ATOMIC
): string {
  const requested = BigInt(requestedAtomic);
  const minimum = BigInt(minimumAtomic);
  return (requested >= minimum ? requested : minimum).toString();
}

export function parseFacilitatorMinimum(
  payload: unknown,
  options: {
    network?: string;
    scheme?: string;
    facilitatorUrl?: string;
  } = {}
): FacilitatorMinimumResult {
  const network = options.network ?? SOLANA_MAINNET;
  const scheme = options.scheme ?? "exact";
  const facilitatorUrl = options.facilitatorUrl ?? DEXTER_FACILITATOR_URL;
  const kinds = Array.isArray((payload as { kinds?: unknown[] })?.kinds)
    ? ((payload as { kinds: unknown[] }).kinds as Array<Record<string, unknown>>)
    : [];
  const match = kinds.find(
    (kind) => kind.network === network && kind.scheme === scheme
  );
  const minPaymentAmountAtomic = match?.extra
    ? String((match.extra as { minPaymentAmountAtomic?: unknown }).minPaymentAmountAtomic ?? "")
    : "";
  if (!/^\d+$/.test(minPaymentAmountAtomic)) {
    throw new Error(
      `Facilitator ${facilitatorUrl} did not advertise a numeric ${scheme} minimum for ${network}`
    );
  }
  const minPaymentAmountUsdRaw = match?.extra
    ? (match.extra as { minPaymentAmountUsd?: unknown }).minPaymentAmountUsd
    : undefined;
  return {
    facilitatorUrl,
    network,
    scheme,
    minPaymentAmountAtomic,
    minPaymentAmountUsd:
      typeof minPaymentAmountUsdRaw === "number" ? minPaymentAmountUsdRaw : null
  };
}

export async function fetchFacilitatorMinimum(
  options: {
    facilitatorUrl?: string;
    network?: string;
    scheme?: string;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<FacilitatorMinimumResult> {
  const facilitatorUrl = options.facilitatorUrl ?? DEXTER_FACILITATOR_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${facilitatorUrl.replace(/\/$/, "")}/supported`, {
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(
      `Facilitator /supported failed with status ${response.status} at ${facilitatorUrl}`
    );
  }
  const payload = (await response.json()) as unknown;
  return parseFacilitatorMinimum(payload, {
    facilitatorUrl,
    ...(options.network === undefined ? {} : { network: options.network }),
    ...(options.scheme === undefined ? {} : { scheme: options.scheme })
  });
}

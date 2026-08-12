import {
  DFlowApiError,
  DFLOW_PROD_BASE_URL,
  type DFlowClientOptions,
  type DFlowOrderRequest,
  type DFlowOrderResponse
} from "./types.js";

export class DFlowClient {
  readonly #apiKey: string | undefined;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: DFlowClientOptions = {}) {
    const apiKey = options.apiKey?.trim();
    this.#apiKey = apiKey === undefined || apiKey === "" ? undefined : apiKey;
    this.#baseUrl = (options.baseUrl ?? DFLOW_PROD_BASE_URL).replace(/\/$/, "");
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  get hasApiKey(): boolean {
    return this.#apiKey !== undefined;
  }

  async getOrder(request: DFlowOrderRequest): Promise<DFlowOrderResponse> {
    const url = new URL(`${this.#baseUrl}/order`);
    for (const [key, value] of Object.entries(request)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {};
    if (this.#apiKey !== undefined) {
      headers["x-api-key"] = this.#apiKey;
    }

    const response = await this.#fetch(url, {
      headers,
      signal: AbortSignal.timeout(this.#timeoutMs)
    });

    const rawText =
      typeof response.text === "function"
        ? await response.text()
        : JSON.stringify(await response.json());
    if (!rawText.trim()) {
      throw new DFlowApiError(
        `DFlow returned an empty body (status ${response.status}); often rate-limited on the open dev endpoint — set DFLOW_API_KEY and use quote-api.dflow.net`,
        response.status,
        "empty_body"
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText) as unknown;
    } catch {
      throw new DFlowApiError(
        `DFlow returned non-JSON body (status ${response.status}): ${rawText.slice(0, 120)}`,
        response.status,
        "invalid_json"
      );
    }

    if (!response.ok) {
      const error = body as { msg?: string; code?: string };
      throw new DFlowApiError(
        error.msg ?? `DFlow request failed with status ${response.status}`,
        response.status,
        error.code
      );
    }

    return normalizeOrderResponse(body);
  }
}

function normalizeOrderResponse(body: unknown): DFlowOrderResponse {
  const raw = body as Record<string, unknown>;
  const inAmount = String(raw.inAmount ?? "");
  const outAmount = String(raw.outAmount ?? "");
  const minOutAmount = String(
    raw.minOutAmount ?? raw.otherAmountThreshold ?? ""
  );
  const otherAmountThreshold = String(
    raw.otherAmountThreshold ?? raw.minOutAmount ?? ""
  );

  return {
    inputMint: String(raw.inputMint ?? ""),
    outputMint: String(raw.outputMint ?? ""),
    inAmount,
    outAmount,
    minOutAmount,
    otherAmountThreshold,
    slippageBps: Number(raw.slippageBps ?? 0),
    priceImpactPct: String(raw.priceImpactPct ?? "0"),
    contextSlot: Number(raw.contextSlot ?? 0),
    executionMode: raw.executionMode === "async" ? "async" : "sync",
    ...(typeof raw.transaction === "string" ? { transaction: raw.transaction } : {}),
    ...(raw.lastValidBlockHeight !== undefined
      ? { lastValidBlockHeight: Number(raw.lastValidBlockHeight) }
      : {}),
    ...(raw.prioritizationFeeLamports !== undefined
      ? { prioritizationFeeLamports: Number(raw.prioritizationFeeLamports) }
      : {})
  };
}

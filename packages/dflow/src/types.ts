export interface DFlowOrderRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  userPublicKey?: string;
  slippageBps?: number | "auto";
  priceImpactTolerancePct?: number;
  sponsor?: string;
  sponsorExec?: boolean;
  destinationWallet?: string;
  includeAddressLookupTables?: boolean;
  reserveAccounts?: number;
  reserveTransactionSize?: number;
  allowSyncExec?: boolean;
  allowAsyncExec?: boolean;
}

export interface DFlowOrderResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  contextSlot: number;
  executionMode: "sync" | "async";
  transaction?: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
}

export interface DFlowClientOptions {
  /**
   * Optional. Required for production `quote-api.dflow.net`.
   * Developer endpoint `https://dev-quote-api.dflow.net` works without a key.
   */
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Official DFlow developer Trade API (no API key, rate-limited). */
export const DFLOW_DEV_BASE_URL = "https://dev-quote-api.dflow.net";

/** Official DFlow production Trade API (requires x-api-key). */
export const DFLOW_PROD_BASE_URL = "https://quote-api.dflow.net";

export class DFlowApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "DFlowApiError";
  }
}

export interface DFlowOutputQuote {
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: string;
}

export interface MinimumInputPlan {
  inputAmountAtomic: string;
  expectedOutputAtomic: string;
  minimumOutputAtomic: string;
  priceImpactPct: string;
  quoteRequests: number;
  minimized: boolean;
}

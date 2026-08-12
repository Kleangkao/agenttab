import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { PaymentFundingCoordinator } from "@agenttab/core";
import {
  createAgentTabFundingHook,
  type RequestBinding
} from "@agenttab/x402";
import {
  x402Client,
  type OnPaymentCreationFailureHook,
  type SchemeRegistration,
  type x402ClientConfig
} from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createGatewayClient } from "./gateway-api.js";
import {
  createGatewayAuditRecorder,
  createGatewayFundingCoordinator,
  type AgentTabAuditRecorder,
  type GatewayHttpOptions
} from "./gateway-client.js";
import { hashHttpRequest } from "./hash.js";
import { isAgentTabApprovalRequiredError, toAgentTabFundingError } from "./errors.js";

export interface AgentTabRequestMeta {
  operationId: string;
  requestHash: string;
  merchantId: string;
  resourceUrl: string;
  method: string;
  auditRecorded: boolean;
  auditError?: string;
}

export type AgentTabFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface CreateAgentTabFetchOptions {
  /**
   * Official x402 client with payment schemes already registered (BYO signer).
   * Prefer `schemes` when possible so AgentTab owns hook registration on a
   * dedicated client instance (x402 appends hooks; reuse can double-fund).
   */
  x402Client?: x402Client;

  /**
   * Scheme registrations used to construct a dedicated x402Client.
   * Same shape as `@x402/fetch` `wrapFetchWithPaymentFromConfig`.
   */
  schemes?: SchemeRegistration[];

  /** Optional payment-requirements selector forwarded to x402Client. */
  paymentRequirementsSelector?: x402ClientConfig["paymentRequirementsSelector"];

  /**
   * In-process funding coordinator (tests, embedded gateway runtimes).
   * Prefer this when the agent process already owns the gateway orchestrator.
   */
  coordinator?: PaymentFundingCoordinator;

  /**
   * Base URL of a running AgentTab gateway (e.g. http://127.0.0.1:8787).
   * Used for funding when `coordinator` is omitted, and for audit when
   * `recordAudit` is enabled and `audit` is omitted.
   */
  gatewayBaseUrl?: string;

  /** Optional extra headers for gateway HTTP calls (funding + audit). */
  gatewayHeaders?: Record<string, string>;

  /** Underlying fetch used for merchant resource requests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;

  /**
   * Fetch used only for AgentTab gateway HTTP (fund / pay / fulfill / get).
   * Defaults to `fetchImpl` then global fetch. Keep this separate when tests or
   * agents intercept merchant traffic without wanting to intercept the gateway.
   */
  gatewayFetchImpl?: typeof fetch;

  /**
   * USD micros for policy evaluation. Omit to leave `amountUsdMicros` unset
   * (fail-closed policies that require USD will deny).
   */
  getUsdValueMicros?: (payment: {
    network: string;
    assetMint: string;
    amountAtomic: string;
  }) => Promise<string | undefined>;

  /** Override operation id generation (default: `agenttab-${uuid}`). */
  createOperationId?: (ctx: { url: string; method: string }) => string;

  /** Override merchant id derivation (default: URL host). */
  merchantIdFromUrl?: (url: URL) => string;

  /**
   * When true, after a successful paid response, record settlement + fulfill
   * on the gateway audit trail. Defaults to true when `gatewayBaseUrl` or
   * `audit` is provided.
   */
  recordAudit?: boolean;

  /** Custom audit recorder. Defaults to HTTP gateway recorder when `gatewayBaseUrl` is set. */
  audit?: AgentTabAuditRecorder;

  /** Called when audit recording fails after a successful resource response. */
  onAuditError?: (error: unknown, meta: AgentTabRequestMeta) => void;

  /** Forwarded to the owned/provided x402Client after the funding hook is registered. */
  onPaymentCreationFailure?: OnPaymentCreationFailureHook;

  /**
   * Reuse the same operationId when the previous attempt for this
   * method+url+body parked at `approval_required`. Enabled by default.
   * Without this, a naive retry starts a new execution that needs approval again.
   */
  reusePendingOperationId?: boolean;

  /**
   * Resolve a parked or in-flight operationId for this request hash.
   * Default: query the gateway when `gatewayBaseUrl` is set so a new process
   * can resume after `pnpm approve -- <id>`. Coordinator-only clients skip
   * this (the in-memory map is enough). `createOperationId` still wins.
   */
  lookupPendingOperationId?: (requestHash: string) => Promise<string | undefined>;
}

const bindingStore = new AsyncLocalStorage<RequestBinding>();
const metaByResponse = new WeakMap<Response, AgentTabRequestMeta>();

export function getAgentTabMeta(response: Response): AgentTabRequestMeta | undefined {
  return metaByResponse.get(response);
}

function gatewayHttpOptions(
  options: CreateAgentTabFetchOptions
): GatewayHttpOptions | undefined {
  if (options.gatewayBaseUrl === undefined || options.gatewayBaseUrl.length === 0) {
    return undefined;
  }
  return {
    baseUrl: options.gatewayBaseUrl,
    fetchImpl: options.gatewayFetchImpl ?? options.fetchImpl ?? fetch,
    ...(options.gatewayHeaders === undefined ? {} : { headers: options.gatewayHeaders })
  };
}

function requireFundingSource(
  options: CreateAgentTabFetchOptions
): PaymentFundingCoordinator {
  if (options.coordinator !== undefined) return options.coordinator;
  const http = gatewayHttpOptions(options);
  if (http !== undefined) {
    return createGatewayFundingCoordinator(http);
  }
  throw new Error(
    "createAgentTabFetch requires `coordinator` or `gatewayBaseUrl` for funding"
  );
}

function resolveAudit(
  options: CreateAgentTabFetchOptions
): AgentTabAuditRecorder | undefined {
  if (options.audit !== undefined) return options.audit;
  const http = gatewayHttpOptions(options);
  if (http !== undefined) {
    return createGatewayAuditRecorder(http);
  }
  return undefined;
}

async function materializeRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{
  url: string;
  method: string;
  bodyText: string;
  init: RequestInit;
}> {
  if (input instanceof Request) {
    const method = (init?.method ?? input.method ?? "GET").toUpperCase();
    const url = input.url;
    const headers = new Headers(input.headers);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    let bodyText = "";
    if (init?.body !== undefined && init.body !== null) {
      bodyText = await bodyToText(init.body);
    } else if (method !== "GET" && method !== "HEAD") {
      bodyText = await input.clone().text();
    }

    const nextInit: RequestInit = {
      method,
      headers,
      ...(bodyText.length > 0 ? { body: bodyText } : {}),
      ...(init?.signal === undefined ? {} : { signal: init.signal }),
      ...(init?.redirect === undefined ? {} : { redirect: init.redirect }),
      ...(init?.credentials === undefined ? {} : { credentials: init.credentials }),
      ...(init?.cache === undefined ? {} : { cache: init.cache }),
      ...(init?.integrity === undefined ? {} : { integrity: init.integrity }),
      ...(init?.keepalive === undefined ? {} : { keepalive: init.keepalive }),
      ...(init?.mode === undefined ? {} : { mode: init.mode }),
      ...(init?.referrer === undefined ? {} : { referrer: init.referrer }),
      ...(init?.referrerPolicy === undefined ? {} : { referrerPolicy: init.referrerPolicy })
    };
    return { url, method, bodyText, init: nextInit };
  }

  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const bodyText =
    init?.body === undefined || init.body === null ? "" : await bodyToText(init.body);
  const nextInit: RequestInit = {
    ...(init ?? {}),
    method,
    ...(bodyText.length > 0 ? { body: bodyText } : {})
  };
  return { url, method, bodyText, init: nextInit };
}

async function bodyToText(body: BodyInit): Promise<string> {
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return Buffer.from(body).toString("utf8");
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return body.text();
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    // FormData is not a stable wire encoding; bind method+url only.
    return "";
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return new Response(body).text();
  }
  return "";
}

function paymentResponseHeader(response: Response): string | null {
  return (
    response.headers.get("PAYMENT-RESPONSE") ??
    response.headers.get("X-PAYMENT-RESPONSE") ??
    response.headers.get("payment-response")
  );
}

function resolveX402Client(options: CreateAgentTabFetchOptions): x402Client {
  if (options.schemes !== undefined && options.schemes.length > 0) {
    return x402Client.fromConfig({
      schemes: options.schemes,
      ...(options.paymentRequirementsSelector === undefined
        ? {}
        : { paymentRequirementsSelector: options.paymentRequirementsSelector })
    });
  }
  if (options.x402Client !== undefined) return options.x402Client;
  throw new Error("createAgentTabFetch requires `schemes` or `x402Client`");
}

/**
 * Drop-in fetch wrapper: 402 → AgentTab policy/funding → official x402 pay → retry → audit.
 *
 * Keeps merchants on standard x402. Signing stays with the caller's scheme clients.
 */
export function createAgentTabFetch(options: CreateAgentTabFetchOptions): AgentTabFetch {
  const fetchImpl = options.fetchImpl ?? fetch;
  const coordinator = requireFundingSource(options);
  const audit = resolveAudit(options);
  const recordAudit =
    options.recordAudit ?? (audit !== undefined);

  if (recordAudit && audit === undefined) {
    throw new Error(
      "recordAudit is enabled but no `audit` recorder or `gatewayBaseUrl` was provided"
    );
  }

  const client = resolveX402Client(options);
  client.onBeforePaymentCreation(
    createAgentTabFundingHook({
      coordinator,
      getRequestBinding: async () => {
        const binding = bindingStore.getStore();
        if (binding === undefined) {
          throw new Error(
            "AgentTab request binding missing; call the fetch returned by createAgentTabFetch"
          );
        }
        return binding;
      },
      getUsdValueMicros:
        options.getUsdValueMicros ??
        (async () => undefined)
    })
  );
  if (options.onPaymentCreationFailure !== undefined) {
    client.onPaymentCreationFailure(options.onPaymentCreationFailure);
  }

  const paidFetch = wrapFetchWithPayment(fetchImpl, client);
  const pendingByRequestHash = new Map<string, string>();
  const reusePending = options.reusePendingOperationId !== false;
  const http = gatewayHttpOptions(options);
  const gatewayLookup =
    options.lookupPendingOperationId === undefined && http !== undefined
      ? createGatewayClient(http)
      : undefined;
  const lookupPending =
    options.lookupPendingOperationId ??
    (gatewayLookup === undefined
      ? undefined
      : (requestHash: string) => gatewayLookup.findReusableOperationId(requestHash));

  return async (input, init) => {
    const materialized = await materializeRequest(input, init);
    const resourceUrl = materialized.url;
    const parsed = new URL(resourceUrl);
    const merchantId =
      options.merchantIdFromUrl?.(parsed) ?? parsed.host;
    const requestHash = hashHttpRequest(
      materialized.method,
      resourceUrl,
      materialized.bodyText
    );
    let operationId =
      options.createOperationId?.({
        url: resourceUrl,
        method: materialized.method
      }) ?? (reusePending ? pendingByRequestHash.get(requestHash) : undefined);
    if (operationId === undefined && reusePending && lookupPending !== undefined) {
      operationId = await lookupPending(requestHash);
    }
    if (operationId === undefined) {
      operationId = `agenttab-${randomUUID()}`;
    }
    const binding: RequestBinding = { operationId, requestHash, merchantId };

    return bindingStore.run(binding, async () => {
      let response: Response;
      try {
        response = await paidFetch(resourceUrl, materialized.init);
      } catch (error) {
        const fundingError = toAgentTabFundingError(error);
        if (fundingError !== undefined) {
          if (isAgentTabApprovalRequiredError(fundingError) && reusePending) {
            pendingByRequestHash.set(requestHash, fundingError.operationId);
          } else {
            pendingByRequestHash.delete(requestHash);
          }
          throw fundingError;
        }
        throw error;
      }
      pendingByRequestHash.delete(requestHash);
      let auditRecorded = false;
      let auditError: string | undefined;

      if (recordAudit && audit !== undefined && response.ok) {
        try {
          const settlementId =
            paymentResponseHeader(response) ?? `x402-${operationId}`;
          const bodyText = await response.clone().text();
          await audit.recordPayment({
            operationId,
            settlementId,
            transaction: settlementId
          });
          await audit.recordFulfillment({
            operationId,
            responseHash: hashHttpRequest("RESPONSE", resourceUrl, bodyText)
          });
          auditRecorded = true;
        } catch (error) {
          auditError = error instanceof Error ? error.message : String(error);
          const meta: AgentTabRequestMeta = {
            operationId,
            requestHash,
            merchantId,
            resourceUrl,
            method: materialized.method,
            auditRecorded: false,
            auditError
          };
          options.onAuditError?.(error, meta);
        }
      }

      const meta: AgentTabRequestMeta = {
        operationId,
        requestHash,
        merchantId,
        resourceUrl,
        method: materialized.method,
        auditRecorded,
        ...(auditError === undefined ? {} : { auditError })
      };
      metaByResponse.set(response, meta);
      return response;
    });
  };
}

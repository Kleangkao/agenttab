import { createHmac, timingSafeEqual } from "node:crypto";
import type { ExecutionRecord } from "@agenttab/core";

export type OperatorNotifyEventName =
  | "approval_required"
  | "approved"
  | "denied"
  | "interrupted";

export const NOTIFY_SIGNATURE_HEADER = "x-agenttab-signature";
export const DEFAULT_NOTIFY_MAX_ATTEMPTS = 3;
export const DEFAULT_NOTIFY_RETRY_DELAY_MS = 50;
/** Total time notify may add to a park/approve/deny/interrupted on the payment path. */
export const DEFAULT_NOTIFY_BUDGET_MS = 300;
/** Per-attempt ceiling; the sequence still stops when the overall budget is gone. */
export const DEFAULT_NOTIFY_ATTEMPT_TIMEOUT_MS = 200;
export const NOTIFY_TIMEOUT_ERROR = "timeout";

export class NotifyTimeoutError extends Error {
  constructor() {
    super(NOTIFY_TIMEOUT_ERROR);
    this.name = "NotifyTimeoutError";
  }
}

export interface OperatorNotifyEvent {
  event: OperatorNotifyEventName;
  operationId: string;
  state: string;
  merchantOrigin: string;
  resource: string;
  amountUsdMicros?: string;
  amountAtomic: string;
}

export interface NotifyAttemptRecord {
  operationId: string;
  event: OperatorNotifyEventName;
  attempt: number;
  ok: boolean;
  at: string;
  status?: number;
  error?: string;
}

export function operatorNotifyPayload(
  event: OperatorNotifyEventName,
  record: ExecutionRecord
): OperatorNotifyEvent {
  return {
    event,
    operationId: record.operationId,
    state: record.state,
    merchantOrigin: record.intent.merchantOrigin,
    resource: record.intent.resource,
    amountAtomic: record.intent.amountAtomic,
    ...(record.intent.amountUsdMicros === undefined
      ? {}
      : { amountUsdMicros: record.intent.amountUsdMicros })
  };
}

export function signNotifyBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function verifyNotifySignature(
  body: string,
  header: string | undefined,
  secret: string
): boolean {
  if (header === undefined || header.length === 0) return false;
  const expected = signNotifyBody(body, secret);
  const actual = Buffer.from(header);
  const want = Buffer.from(expected);
  if (actual.length !== want.length) return false;
  return timingSafeEqual(actual, want);
}

function rememberAttempt(
  recordAttempt: ((row: NotifyAttemptRecord) => void) | undefined,
  row: NotifyAttemptRecord
): void {
  if (recordAttempt === undefined) return;
  try {
    recordAttempt(row);
  } catch {
    // Durable log is best-effort; never fail the payment path.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new NotifyTimeoutError()), ms);
  });
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof NotifyTimeoutError ||
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof Error && error.message === NOTIFY_TIMEOUT_ERROR)
  );
}

export function createOperatorNotifier(options: {
  url: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  retryDelayMs?: number;
  budgetMs?: number;
  attemptTimeoutMs?: number;
  recordAttempt?: (row: NotifyAttemptRecord) => void;
}): (payload: OperatorNotifyEvent) => Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url;
  const secret = options.secret;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_NOTIFY_MAX_ATTEMPTS);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_NOTIFY_RETRY_DELAY_MS);
  const budgetMs = Math.max(1, options.budgetMs ?? DEFAULT_NOTIFY_BUDGET_MS);
  const attemptTimeoutMs = Math.max(
    1,
    options.attemptTimeoutMs ?? DEFAULT_NOTIFY_ATTEMPT_TIMEOUT_MS
  );
  const recordAttempt = options.recordAttempt;

  return async (payload) => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (secret !== undefined && secret.length > 0) {
      headers[NOTIFY_SIGNATURE_HEADER] = signNotifyBody(body, secret);
    }

    const started = Date.now();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remaining = budgetMs - (Date.now() - started);
      if (remaining <= 0) {
        rememberAttempt(recordAttempt, {
          operationId: payload.operationId,
          event: payload.event,
          attempt,
          ok: false,
          at: new Date().toISOString(),
          error: NOTIFY_TIMEOUT_ERROR
        });
        return;
      }
      const attemptMs = Math.min(attemptTimeoutMs, remaining);
      const at = new Date().toISOString();
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), attemptMs);
      try {
        const response = await Promise.race([
          fetchImpl(url, {
            method: "POST",
            headers,
            body,
            signal: controller.signal
          }),
          timeoutAfter(attemptMs)
        ]);
        rememberAttempt(recordAttempt, {
          operationId: payload.operationId,
          event: payload.event,
          attempt,
          ok: response.ok,
          at,
          status: response.status
        });
        if (response.ok) return;
        console.error(
          JSON.stringify({
            phase: "operator-notify-failed",
            status: response.status,
            event: payload.event,
            operationId: payload.operationId,
            attempt
          })
        );
      } catch (error) {
        const timedOut = isTimeout(error);
        const message = timedOut
          ? NOTIFY_TIMEOUT_ERROR
          : error instanceof Error
            ? error.message
            : String(error);
        rememberAttempt(recordAttempt, {
          operationId: payload.operationId,
          event: payload.event,
          attempt,
          ok: false,
          at,
          error: message
        });
        console.error(
          JSON.stringify({
            phase: timedOut ? "operator-notify-timeout" : "operator-notify-error",
            event: payload.event,
            operationId: payload.operationId,
            attempt,
            message
          })
        );
        if (timedOut && budgetMs - (Date.now() - started) <= 0) return;
      } finally {
        clearTimeout(abortTimer);
      }
      const remainingAfter = budgetMs - (Date.now() - started);
      if (attempt < maxAttempts && retryDelayMs > 0 && remainingAfter > retryDelayMs) {
        await sleep(retryDelayMs);
      }
    }
  };
}

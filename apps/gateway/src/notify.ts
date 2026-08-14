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

export function createOperatorNotifier(options: {
  url: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  retryDelayMs?: number;
  recordAttempt?: (row: NotifyAttemptRecord) => void;
}): (payload: OperatorNotifyEvent) => Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url;
  const secret = options.secret;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_NOTIFY_MAX_ATTEMPTS);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_NOTIFY_RETRY_DELAY_MS);
  const recordAttempt = options.recordAttempt;

  return async (payload) => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (secret !== undefined && secret.length > 0) {
      headers[NOTIFY_SIGNATURE_HEADER] = signNotifyBody(body, secret);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const at = new Date().toISOString();
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers,
          body
        });
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
        const message = error instanceof Error ? error.message : String(error);
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
            phase: "operator-notify-error",
            event: payload.event,
            operationId: payload.operationId,
            attempt,
            message
          })
        );
      }
      if (attempt < maxAttempts && retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  };
}

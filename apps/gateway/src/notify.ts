import { createHmac, timingSafeEqual } from "node:crypto";
import type { ExecutionRecord } from "@agenttab/core";

export type OperatorNotifyEventName =
  | "approval_required"
  | "approved"
  | "denied"
  | "interrupted";

export const NOTIFY_SIGNATURE_HEADER = "x-agenttab-signature";

export interface OperatorNotifyEvent {
  event: OperatorNotifyEventName;
  operationId: string;
  state: string;
  merchantOrigin: string;
  resource: string;
  amountUsdMicros?: string;
  amountAtomic: string;
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

export function createOperatorNotifier(options: {
  url: string;
  secret?: string;
  fetchImpl?: typeof fetch;
}): (payload: OperatorNotifyEvent) => Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url;
  const secret = options.secret;
  return async (payload) => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (secret !== undefined && secret.length > 0) {
      headers[NOTIFY_SIGNATURE_HEADER] = signNotifyBody(body, secret);
    }
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body
      });
      if (!response.ok) {
        console.error(
          JSON.stringify({
            phase: "operator-notify-failed",
            status: response.status,
            event: payload.event,
            operationId: payload.operationId
          })
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          phase: "operator-notify-error",
          event: payload.event,
          operationId: payload.operationId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  };
}

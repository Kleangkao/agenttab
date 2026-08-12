import type { ExecutionRecord } from "@agenttab/core";

export type OperatorNotifyEventName = "approval_required" | "approved" | "denied";

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

export function createOperatorNotifier(options: {
  url: string;
  fetchImpl?: typeof fetch;
}): (payload: OperatorNotifyEvent) => Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url;
  return async (payload) => {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
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

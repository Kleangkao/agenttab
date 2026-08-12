import type { PaymentPolicy } from "@agenttab/gateway";

export const MAINNET_BROADCAST_APPROVAL =
  "I_UNDERSTAND_THIS_WILL_SPEND_REAL_FUNDS";

export interface OneShotExecutionMode {
  broadcastEnabled: boolean;
  allowBroadcastInPlan: boolean;
  label: "dry-run" | "armed-broadcast";
}

export function resolveOneShotExecutionMode(
  env: NodeJS.ProcessEnv
): OneShotExecutionMode {
  const requestedBroadcast = env.AGENTTAB_BROADCAST === "1";
  if (!requestedBroadcast) {
    return {
      broadcastEnabled: false,
      allowBroadcastInPlan: false,
      label: "dry-run"
    };
  }

  if (env.MAINNET_ONE_SHOT_MODE !== "broadcast") {
    throw new Error(
      "AGENTTAB_BROADCAST=1 requires MAINNET_ONE_SHOT_MODE=broadcast"
    );
  }
  if (env.AGENTTAB_MAINNET_EXECUTION_APPROVED !== MAINNET_BROADCAST_APPROVAL) {
    throw new Error(
      "Broadcast requires AGENTTAB_MAINNET_EXECUTION_APPROVED=I_UNDERSTAND_THIS_WILL_SPEND_REAL_FUNDS"
    );
  }
  return {
    broadcastEnabled: true,
    allowBroadcastInPlan: true,
    label: "armed-broadcast"
  };
}

/**
 * Validates the persisted Mainnet policy for oneshot execution.
 * Does not silently flip approve→autopay; that lied about operator intent.
 */
export function createExecutablePolicy(policy: PaymentPolicy): PaymentPolicy {
  if (policy.mode !== "autopay") {
    throw new Error(
      `Mainnet oneshot requires policy.mode=autopay (found "${policy.mode}"). ` +
        `Set mode to autopay in .data/mainnet/policy.mainnet.json for gated auto-execution, ` +
        `or keep approve and use POST /v1/approvals/:operationId after funding is requested.`
    );
  }
  return { ...policy };
}

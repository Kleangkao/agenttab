import type { SchemeNetworkClient } from "@x402/core/types";

/**
 * Local-only payment scheme for smoke tests.
 * Prefer `createLocalSmokeScheme` from `@agenttab/fetch` in new code.
 */
export function createSmokePaymentScheme(): SchemeNetworkClient {
  return {
    scheme: "exact",
    createPaymentPayload: async () => ({
      x402Version: 2,
      payload: {
        transaction: `smoke-${Date.now()}`
      }
    })
  };
}

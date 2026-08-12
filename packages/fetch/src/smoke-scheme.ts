import type { SchemeNetworkClient } from "@x402/core/types";

/**
 * Local/CI-only payment scheme that does not touch a chain.
 * Production agents must register ExactSvmScheme (or equivalent) with a real signer.
 */
export function createLocalSmokeScheme(): SchemeNetworkClient {
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

import { describe, expect, it, vi } from "vitest";
import {
  DEXTER_FACILITATOR_URL,
  SOLANA_MAINNET
} from "../src/constants.js";
import {
  fetchFacilitatorMinimum,
  parseFacilitatorMinimum,
  resolvePaymentAtomicFloor
} from "../src/mainnet-defaults.js";

describe("mainnet defaults helpers", () => {
  it("parses the live facilitator minimum for Solana exact", () => {
    const result = parseFacilitatorMinimum({
      kinds: [
        {
          scheme: "exact",
          network: SOLANA_MAINNET,
          extra: {
            minPaymentAmountAtomic: "800",
            minPaymentAmountUsd: 0.0008
          }
        }
      ]
    });
    expect(result.minPaymentAmountAtomic).toBe("800");
    expect(result.minPaymentAmountUsd).toBe(0.0008);
  });

  it("raises the requested payment to the live floor", () => {
    expect(resolvePaymentAtomicFloor("1000", "800")).toBe("1000");
    expect(resolvePaymentAtomicFloor("500", "800")).toBe("800");
  });

  it("fetches facilitator minimum from /supported", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        kinds: [
          {
            scheme: "exact",
            network: SOLANA_MAINNET,
            extra: {
              minPaymentAmountAtomic: "800",
              minPaymentAmountUsd: 0.0008
            }
          }
        ]
      })
    });
    const result = await fetchFacilitatorMinimum({
      facilitatorUrl: DEXTER_FACILITATOR_URL,
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    expect(result.minPaymentAmountAtomic).toBe("800");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

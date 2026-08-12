import { describe, expect, it, vi } from "vitest";
import {
  DEXTER_FACILITATOR_URL,
  PAYAI_FACILITATOR_URL,
  SOLANA_MAINNET
} from "../src/constants.js";
import { checkFacilitatorHealth } from "../src/facilitator-health.js";

describe("checkFacilitatorHealth", () => {
  it("recommends Dexter when both advertise Mainnet exact", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return { ok: true, json: async () => ({ status: "ok" }) };
      }
      if (url.includes("dexter") && url.endsWith("/supported")) {
        return {
          ok: true,
          json: async () => ({
            kinds: [
              {
                scheme: "exact",
                network: SOLANA_MAINNET,
                extra: { feePayer: "DexterFeePayer111111111111111111111111111", minPaymentAmountAtomic: "800" }
              }
            ]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          kinds: [
            {
              scheme: "exact",
              network: SOLANA_MAINNET,
              extra: { feePayer: "PayAiFeePayer1111111111111111111111111111" }
            }
          ]
        })
      };
    });

    const report = await checkFacilitatorHealth({
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    expect(report.recommendedUrl).toBe(DEXTER_FACILITATOR_URL);
    expect(report.results).toHaveLength(2);
    expect(report.results[0]?.mainnetExact?.minPaymentAmountAtomic).toBe("800");
  });

  it("falls back to PayAI when Dexter is unreachable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("dexter")) {
        throw new Error("fetch failed");
      }
      if (url.endsWith("/health")) {
        return { ok: true, json: async () => ({ status: "ok" }) };
      }
      return {
        ok: true,
        json: async () => ({
          kinds: [
            {
              scheme: "exact",
              network: SOLANA_MAINNET,
              extra: { feePayer: "PayAiFeePayer1111111111111111111111111111" }
            }
          ]
        })
      };
    });

    const report = await checkFacilitatorHealth({
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    expect(report.recommendedUrl).toBe(PAYAI_FACILITATOR_URL);
    expect(report.results.find((r) => r.label === "dexter")?.error).toContain("fetch failed");
  });

  it("honors preferUrl when that facilitator is usable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return { ok: true, json: async () => ({ status: "ok" }) };
      }
      const feePayer = url.includes("dexter")
        ? "DexterFeePayer111111111111111111111111111"
        : "PayAiFeePayer1111111111111111111111111111";
      return {
        ok: true,
        json: async () => ({
          kinds: [
            {
              scheme: "exact",
              network: SOLANA_MAINNET,
              extra: { feePayer }
            }
          ]
        })
      };
    });

    const report = await checkFacilitatorHealth({
      fetchImpl: fetchMock as unknown as typeof fetch,
      preferUrl: PAYAI_FACILITATOR_URL
    });
    expect(report.recommendedUrl).toBe(PAYAI_FACILITATOR_URL);
  });
});

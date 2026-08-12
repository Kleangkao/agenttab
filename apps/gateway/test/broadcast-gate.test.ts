import { describe, expect, it } from "vitest";
import { evaluateBroadcastGate } from "../src/broadcast-gate.js";
import { DEXTER_FACILITATOR_URL } from "../src/constants.js";

const base = {
  solLamports: 100_000_000,
  usdcAtomic: "0",
  paymentAtomic: "1000",
  facilitatorMinAtomic: "800",
  priceImpactPct: 0,
  fundingInputAtomic: "13200",
  simulationOk: true,
  planBroadcast: true,
  planType: "live-funding-plan",
  merchantPriceAtomic: "1000",
  merchantFacilitatorUrl: DEXTER_FACILITATOR_URL,
  expectedFacilitatorUrl: DEXTER_FACILITATOR_URL,
  merchantAddress: "Merchant1111111111111111111111111111111111",
  expectedMerchantAddress: "Merchant1111111111111111111111111111111111"
};

describe("evaluateBroadcastGate", () => {
  it("passes a validated Mainnet envelope", () => {
    expect(evaluateBroadcastGate(base)).toEqual({ ok: true, abortReasons: [] });
  });

  it("aborts when simulation failed", () => {
    const result = evaluateBroadcastGate({ ...base, simulationOk: false });
    expect(result.ok).toBe(false);
    expect(result.abortReasons).toContain("simulation_not_ok");
  });

  it("aborts when USDC is already sufficient (no funding needed)", () => {
    const result = evaluateBroadcastGate({ ...base, usdcAtomic: "5000" });
    expect(result.abortReasons).toContain("usdc_already_sufficient");
  });

  it("aborts on facilitator mismatch", () => {
    const result = evaluateBroadcastGate({
      ...base,
      merchantFacilitatorUrl: "https://facilitator.payai.network"
    });
    expect(result.abortReasons).toContain("facilitator_mismatch");
  });

  it("aborts when funding input is out of envelope", () => {
    expect(
      evaluateBroadcastGate({ ...base, fundingInputAtomic: "9000000" }).abortReasons
    ).toContain("funding_input_unexpectedly_large");
    expect(
      evaluateBroadcastGate({ ...base, fundingInputAtomic: "10" }).abortReasons
    ).toContain("funding_input_unexpectedly_small");
  });
});

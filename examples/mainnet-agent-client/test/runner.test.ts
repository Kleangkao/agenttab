import { describe, expect, it } from "vitest";
import { createExecutablePolicy, MAINNET_BROADCAST_APPROVAL, resolveOneShotExecutionMode } from "../src/runner.js";

describe("mainnet one-shot runner guards", () => {
  it("defaults to dry-run when AGENTTAB_BROADCAST is unset", () => {
    expect(resolveOneShotExecutionMode({})).toEqual({
      broadcastEnabled: false,
      allowBroadcastInPlan: false,
      label: "dry-run"
    });
  });

  it("refuses broadcast without the explicit one-shot mode", () => {
    expect(() =>
      resolveOneShotExecutionMode({ AGENTTAB_BROADCAST: "1" })
    ).toThrow(/MAINNET_ONE_SHOT_MODE=broadcast/);
  });

  it("refuses broadcast without the approval phrase", () => {
    expect(() =>
      resolveOneShotExecutionMode({
        AGENTTAB_BROADCAST: "1",
        MAINNET_ONE_SHOT_MODE: "broadcast"
      })
    ).toThrow(/AGENTTAB_MAINNET_EXECUTION_APPROVED/);
  });

  it("arms broadcast only when both safety gates are present", () => {
    expect(
      resolveOneShotExecutionMode({
        AGENTTAB_BROADCAST: "1",
        MAINNET_ONE_SHOT_MODE: "broadcast",
        AGENTTAB_MAINNET_EXECUTION_APPROVED: MAINNET_BROADCAST_APPROVAL
      })
    ).toEqual({
      broadcastEnabled: true,
      allowBroadcastInPlan: true,
      label: "armed-broadcast"
    });
  });

  it("requires persisted policy mode=autopay (no silent override)", () => {
    expect(() =>
      createExecutablePolicy({
        mode: "approve",
        allowedMerchantOrigins: ["http://127.0.0.1:4022"],
        allowedNetworks: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
        allowedPaymentAssets: ["mint"],
        allowedFundingAssets: ["sol"],
        requireVerifiedFundingAssets: true,
        maxPaymentUsdMicros: "10000",
        maxDailyUsdMicros: "50000",
        requireApprovalAboveUsdMicros: "0",
        maxSlippageBps: 50,
        maxPriceImpactPct: 1
      })
    ).toThrow(/requires policy.mode=autopay/);

    expect(
      createExecutablePolicy({
        mode: "autopay",
        allowedMerchantOrigins: ["http://127.0.0.1:4022"],
        allowedNetworks: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
        allowedPaymentAssets: ["mint"],
        allowedFundingAssets: ["sol"],
        requireVerifiedFundingAssets: true,
        maxPaymentUsdMicros: "10000",
        maxDailyUsdMicros: "50000",
        maxSlippageBps: 50,
        maxPriceImpactPct: 1
      }).mode
    ).toBe("autopay");
  });
});

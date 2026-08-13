import { describe, expect, it, vi } from "vitest";
import { AgentTabApprovalRequiredError } from "../src/errors.js";
import { requestPaidResource } from "../src/paid-request.js";
import type { AgentTabClient } from "../src/client.js";

function approvalError(): AgentTabApprovalRequiredError {
  return new AgentTabApprovalRequiredError({
    code: "approval_required",
    message: "parked",
    operationId: "op-parked",
    requestHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    merchantId: "merchant.local"
  });
}

describe("requestPaidResource", () => {
  it("does not retry the merchant when approve returns denied", async () => {
    const fetchPaid = vi.fn(async () => {
      throw approvalError();
    });
    const approve = vi.fn(async () => ({
      outcome: { status: "denied", reason: "over daily cap" }
    }));
    const agent = {
      fetch: fetchPaid,
      getMeta: () => undefined,
      getExecution: async () => undefined,
      getLastApprovalRequired: () => undefined,
      gateway: { approve }
    } as unknown as AgentTabClient;

    await expect(
      requestPaidResource(agent, "http://merchant.local/v1/x", undefined, {
        onApprovalRequired: () => "approve"
      })
    ).rejects.toMatchObject({
      name: "AgentTabFundingDeniedError",
      operationId: "op-parked"
    });
    expect(approve).toHaveBeenCalledWith("op-parked");
    expect(fetchPaid).toHaveBeenCalledOnce();
  });

  it("surfaces interrupted approve without treating it as funded", async () => {
    const agent = {
      fetch: vi.fn(async () => {
        throw approvalError();
      }),
      getMeta: () => undefined,
      getExecution: async () => undefined,
      getLastApprovalRequired: () => undefined,
      gateway: {
        approve: async () => ({
          outcome: {
            status: "interrupted",
            reason: "plan receipt retained; retry to re-sign"
          }
        })
      }
    } as unknown as AgentTabClient;

    await expect(
      requestPaidResource(agent, "http://merchant.local/v1/x", undefined, {
        onApprovalRequired: () => "approve"
      })
    ).rejects.toMatchObject({
      name: "AgentTabFundingInterruptedError",
      operationId: "op-parked"
    });
  });

  it("throws when the paid retry is not ok", async () => {
    let calls = 0;
    const agent = {
      fetch: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw approvalError();
        return new Response("merchant down", { status: 503 });
      }),
      getMeta: () => ({ operationId: "op-parked" }),
      getExecution: async () => ({ state: "funded" }),
      getLastApprovalRequired: () => undefined,
      gateway: {
        approve: async () => ({ outcome: { status: "funded", reason: "ok" } })
      }
    } as unknown as AgentTabClient;

    await expect(
      requestPaidResource(agent, "http://merchant.local/v1/x", undefined, {
        onApprovalRequired: () => "approve"
      })
    ).rejects.toThrow(/paid retry returned HTTP 503/);
  });
});

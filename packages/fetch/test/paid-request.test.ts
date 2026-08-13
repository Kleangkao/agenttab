import { describe, expect, it, vi } from "vitest";
import {
  AgentTabApprovalRequiredError,
  AgentTabFundingInterruptedError
} from "../src/errors.js";
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

  it("retries the same request once after funding is interrupted", async () => {
    let calls = 0;
    const agent = {
      fetch: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw new AgentTabFundingInterruptedError({
            code: "interrupted",
            message: "plan receipt retained; retry to re-sign",
            operationId: "op-int",
            requestHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            merchantId: "merchant.local"
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
      getMeta: () => ({ operationId: "op-int" }),
      getExecution: async () => ({ state: "fulfilled" }),
      getLastApprovalRequired: () => undefined
    } as unknown as AgentTabClient;

    const result = await requestPaidResource(agent, "http://merchant.local/v1/x");
    expect(result.response.status).toBe(200);
    expect(agent.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries the merchant after approve returns interrupted", async () => {
    let calls = 0;
    const agent = {
      fetch: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw approvalError();
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
      getMeta: () => ({ operationId: "op-parked" }),
      getExecution: async () => ({ state: "funded" }),
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

    const result = await requestPaidResource(
      agent,
      "http://merchant.local/v1/x",
      undefined,
      { onApprovalRequired: () => "approve" }
    );
    expect(result.approvedByHook).toBe(true);
    expect(result.response.status).toBe(200);
    expect(agent.fetch).toHaveBeenCalledTimes(2);
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

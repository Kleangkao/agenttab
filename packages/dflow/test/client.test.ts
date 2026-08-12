import { describe, expect, it, vi } from "vitest";
import { DFlowApiError, DFlowClient, DFLOW_DEV_BASE_URL } from "../src/index.js";

describe("DFlowClient", () => {
  it("omits x-api-key for developer endpoint usage without a key", async () => {
    const payload = {
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inAmount: "100",
      outAmount: "200",
      otherAmountThreshold: "198",
      minOutAmount: "198",
      slippageBps: 50,
      priceImpactPct: 0,
      contextSlot: 1,
      executionMode: "sync"
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload)
    });

    const client = new DFlowClient({
      baseUrl: DFLOW_DEV_BASE_URL,
      fetch: fetchMock as unknown as typeof fetch
    });

    const order = await client.getOrder({
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "100",
      slippageBps: 50
    });

    expect(client.hasApiKey).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toEqual({});
    expect(order.minOutAmount).toBe("198");
    expect(order.priceImpactPct).toBe("0");
  });

  it("sends x-api-key when provided and surfaces API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ msg: "forbidden", code: "AUTH" })
    });

    const client = new DFlowClient({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(
      client.getOrder({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "100"
      })
    ).rejects.toBeInstanceOf(DFlowApiError);

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toEqual({ "x-api-key": "test-key" });
  });

  it("rejects empty bodies with a clear rate-limit hint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ""
    });
    const client = new DFlowClient({
      baseUrl: DFLOW_DEV_BASE_URL,
      fetch: fetchMock as unknown as typeof fetch
    });
    await expect(
      client.getOrder({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "100"
      })
    ).rejects.toMatchObject({
      name: "DFlowApiError",
      code: "empty_body"
    });
  });
});

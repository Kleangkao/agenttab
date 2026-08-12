import { describe, expect, it } from "vitest";
import { runAdoptDemo } from "../src/adopt-demo.js";

describe("HTTP adopt demo", () => {
  it("previews, approves to fulfill, then denies without reuse", async () => {
    const result = await runAdoptDemo();
    expect(result.previewFunded).toBe(false);
    expect(result.fulfilledState).toBe("fulfilled");
    expect(result.approvedOperationId.length).toBeGreaterThan(0);
    expect(result.deniedOperationId).not.toBe(result.approvedOperationId);
    expect(result.deniedReusable).toBeUndefined();
    expect(result.events).toContain("funding.confirmed");
    expect(result.events).toContain("resource.fulfilled");
  });
});

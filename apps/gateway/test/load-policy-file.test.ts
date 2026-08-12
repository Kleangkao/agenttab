import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadPolicyFile } from "../src/policy/load-policy-file.js";

describe("loadPolicyFile", () => {
  it("loads example approve policy and strips notes", () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    expect(policy.mode).toBe("approve");
    expect(policy.allowedMerchantOrigins).toContain("http://127.0.0.1:8791");
    expect((policy as { notes?: string }).notes).toBeUndefined();
  });

  it("loads observe policy as a fail-closed approve alias", () => {
    const policy = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/observe.local.json")
    );
    expect(policy.mode).toBe("observe");
  });

  it("rejects invalid policy files", () => {
    expect(() =>
      loadPolicyFile(resolve(process.cwd(), "../../examples/policies/does-not-exist.json"))
    ).toThrow(/not found/i);
  });
});

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadPolicyFile, loadPolicyFromEnv } from "../src/policy/load-policy-file.js";

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

  it("loads AGENTTAB_POLICY_JSON ahead of AGENTTAB_POLICY_PATH", () => {
    const fromFile = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/approve.local.json")
    );
    const loaded = loadPolicyFromEnv({
      AGENTTAB_POLICY_PATH: resolve(
        process.cwd(),
        "../../examples/policies/approve.local.json"
      ),
      AGENTTAB_POLICY_JSON: JSON.stringify({
        ...fromFile,
        mode: "observe"
      })
    });
    expect(loaded?.path).toBe("AGENTTAB_POLICY_JSON");
    expect(loaded?.policy.mode).toBe("observe");
    expect(loaded?.replace).toBe(false);
  });

  it("honors AGENTTAB_POLICY_REPLACE on JSON bootstrap", () => {
    const fromFile = loadPolicyFile(
      resolve(process.cwd(), "../../examples/policies/autopay.local.json")
    );
    const loaded = loadPolicyFromEnv({
      AGENTTAB_POLICY_JSON: JSON.stringify(fromFile),
      AGENTTAB_POLICY_REPLACE: "1"
    });
    expect(loaded?.replace).toBe(true);
    expect(loaded?.policy.mode).toBe("autopay");
  });
});

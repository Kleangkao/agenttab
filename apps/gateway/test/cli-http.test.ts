import { describe, expect, it } from "vitest";
import { shouldAuditOverHttp } from "../src/cli/gateway-http.js";
import { resolveIntentPath } from "../src/cli/preview-args.js";

describe("operator CLI HTTP helpers", () => {
  it("uses HTTP whenever a gateway URL is set, even if DB path is also set", () => {
    expect(shouldAuditOverHttp({})).toBe(false);
    expect(shouldAuditOverHttp({ AGENTTAB_GATEWAY_URL: "http://127.0.0.1:8787" })).toBe(true);
    expect(
      shouldAuditOverHttp({
        AGENTTAB_GATEWAY_URL: "http://127.0.0.1:8787",
        AGENTTAB_DB_PATH: "/data/gateway.sqlite"
      })
    ).toBe(true);
    expect(shouldAuditOverHttp({ AGENTTAB_DB_PATH: ".data/gateway.sqlite" })).toBe(false);
  });
});

describe("preview CLI", () => {
  it("resolves intent path from argv or AGENTTAB_PREVIEW_INTENT", () => {
    expect(resolveIntentPath(["--", "examples/intents/preview.local.json"])).toBe(
      "examples/intents/preview.local.json"
    );
    expect(
      resolveIntentPath([], { AGENTTAB_PREVIEW_INTENT: "examples/intents/preview.local.json" })
    ).toBe("examples/intents/preview.local.json");
    expect(() => resolveIntentPath([])).toThrow(/Usage/);
  });
});

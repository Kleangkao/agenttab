import { describe, expect, it } from "vitest";
import { shouldAuditOverHttp } from "../src/cli/gateway-http.js";

describe("operator CLI HTTP helpers", () => {
  it("audits over HTTP only when gateway URL is set and DB path is not", () => {
    expect(shouldAuditOverHttp({})).toBe(false);
    expect(shouldAuditOverHttp({ AGENTTAB_GATEWAY_URL: "http://127.0.0.1:8787" })).toBe(true);
    expect(
      shouldAuditOverHttp({
        AGENTTAB_GATEWAY_URL: "http://127.0.0.1:8787",
        AGENTTAB_DB_PATH: ".data/gateway.sqlite"
      })
    ).toBe(false);
    expect(shouldAuditOverHttp({ AGENTTAB_DB_PATH: ".data/gateway.sqlite" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { gatewayHeaders, shouldAuditOverHttp } from "../src/cli/gateway-http.js";
import { resolveIntentPath } from "../src/cli/preview-args.js";
import { resolveOperationId } from "../src/cli/operation-id.js";
import { resolvePolicyMode } from "../src/cli/policy-mode-args.js";
import { resolveMerchantOrigin } from "../src/cli/policy-allow-args.js";
import { resolvePolicyCap } from "../src/cli/policy-cap-args.js";

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

  it("prefers admin bearer, then agent bearer", () => {
    expect(gatewayHeaders({ AGENTTAB_AGENT_TOKEN: "ag" }).authorization).toBe("Bearer ag");
    expect(
      gatewayHeaders({ AGENTTAB_ADMIN_TOKEN: "adm", AGENTTAB_AGENT_TOKEN: "ag" }).authorization
    ).toBe("Bearer adm");
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

describe("policy cap CLI", () => {
  it("resolves daily/payment/approve-above micros", () => {
    expect(resolvePolicyCap(["--", "daily", "2000000"])).toEqual({
      field: "daily",
      value: "2000000"
    });
    expect(resolvePolicyCap(["approve-above", "-"])).toEqual({
      field: "approve-above",
      value: null
    });
    expect(() => resolvePolicyCap(["daily", "-"])).toThrow(/approve-above/);
    expect(() => resolvePolicyCap([])).toThrow(/Usage: pnpm policy:cap/);
  });
});

describe("policy allow CLI", () => {
  it("canonicalizes http(s) origins", () => {
    expect(resolveMerchantOrigin(["--", "http://127.0.0.1:8791/path"])).toBe(
      "http://127.0.0.1:8791"
    );
    expect(() => resolveMerchantOrigin([])).toThrow(/Usage: pnpm policy:allow/);
    expect(() => resolveMerchantOrigin(["--", "ftp://x"])).toThrow(/Invalid origin/);
  });
});

describe("policy mode CLI", () => {
  it("resolves observe|approve|autopay from argv", () => {
    expect(resolvePolicyMode(["--", "approve"])).toBe("approve");
    expect(resolvePolicyMode(["autopay"])).toBe("autopay");
    expect(() => resolvePolicyMode([])).toThrow(/Usage: pnpm policy:mode/);
    expect(() => resolvePolicyMode(["--", "nukes"])).toThrow(/Usage/);
  });
});

describe("operator CLI operation id", () => {
  it("resolves approve/deny ids from argv", () => {
    expect(
      resolveOperationId(["--", "op-1"], {
        command: "deny",
        usage: "Usage"
      })
    ).toBe("op-1");
    expect(() =>
      resolveOperationId([], { command: "deny", usage: "Usage: pnpm deny" })
    ).toThrow(/Usage: pnpm deny/);
  });
});

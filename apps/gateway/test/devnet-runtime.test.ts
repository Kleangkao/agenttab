import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createDevnetPolicy,
  loadDevnetGatewayPaths,
  SOLANA_DEVNET
} from "../src/devnet-runtime.js";
import { WSOL_MINT } from "../src/constants.js";

describe("createDevnetPolicy", () => {
  it("allowlists Devnet network and test mint", () => {
    const mint = "377ooYeau3YgZAWKcJDXc2CpzrNcVdcyUwx5ghVF4udX";
    const policy = createDevnetPolicy({
      merchantOrigin: "http://127.0.0.1:8791",
      mint
    });
    expect(policy.mode).toBe("autopay");
    expect(policy.allowedNetworks).toEqual([SOLANA_DEVNET]);
    expect(policy.allowedPaymentAssets).toEqual([mint]);
    expect(policy.allowedFundingAssets).toContain(WSOL_MINT);
    expect(policy.allowedFundingAssets).toContain(mint);
  });
});

describe("loadDevnetGatewayPaths", () => {
  it("loads disposable artifacts when present", () => {
    const dataDir = resolve(process.cwd(), "../../.data/devnet");
    if (!existsSync(resolve(dataDir, "buyer.json"))) {
      return;
    }
    const paths = loadDevnetGatewayPaths(dataDir);
    expect(paths.buyerAddress.length).toBeGreaterThan(30);
    expect(paths.mint.toBase58().length).toBeGreaterThan(30);
  });
});

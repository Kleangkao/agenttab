import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGatewayRuntime } from "../src/index.js";
import { landingHtml } from "../src/ui/landing-page.js";
import { demoHtml } from "../src/ui/demo-page.js";
import { operatorHtml } from "../src/ui/operator-page.js";
import { REPO_URL } from "../src/ui/head.js";
import { MAINNET_DFLOW_TX, MAINNET_X402_TX } from "../src/ui/proof.js";

describe("product surfaces", () => {
  it("serves landing at / and keeps /ui as operator", async () => {
    const gateway = createGatewayRuntime({ demoControls: true });
    try {
      const home = await gateway.app.request("/");
      expect(home.status).toBe(200);
      const homeHtml = await home.text();
      expect(homeHtml).toContain("Keep agents moving when payments fall short");
      expect(homeHtml).toContain("Try the interactive demo");
      // The product page sells the outcome; jargon belongs on /ui.
      expect(homeHtml).not.toContain("x402");
      expect(homeHtml).not.toContain("exact deficit");
      expect(homeHtml).toContain('href="/demo"');

      const demo = await gateway.app.request("/demo");
      expect(demo.status).toBe(200);
      const demoHtml = await demo.text();
      expect(demoHtml).toContain("Ask for the result, not the transaction");
      expect(demoHtml).toContain('id="run-request"');
      expect(demoHtml).not.toContain("Add $1 USDC");
      // The demo intro must not lead with the payment protocol.
      expect(demoHtml).not.toContain("x402");

      const ui = await gateway.app.request("/ui");
      expect(ui.status).toBe(200);
      const uiHtml = await ui.text();
      expect(uiHtml).toContain('id="panel-now"');
      expect(uiHtml).toContain("Technical proof surface");

      const health = (await (await gateway.app.request("/health")).json()) as {
        landing: string;
        playableDemo: string;
        operatorUi: string;
        demoControls: boolean;
      };
      expect(health.landing).toBe("/");
      expect(health.playableDemo).toBe("/demo");
      expect(health.operatorUi).toBe("/ui");
      expect(health.demoControls).toBe(true);
    } finally {
      gateway.close();
    }
  });

  it("every surface ships link-preview metadata and a real favicon", () => {
    const pages = [
      landingHtml(),
      demoHtml(),
      operatorHtml({ adminRequired: false, policyMode: "approve" })
    ];
    for (const html of pages) {
      expect(html).toContain('<meta name="description"');
      expect(html).toContain('<meta property="og:title"');
      expect(html).toContain('<meta property="og:description"');
      expect(html).toContain('<meta property="og:url"');
      expect(html).toContain('<meta name="twitter:card"');
      expect(html).toContain('<link rel="canonical"');
      // An empty data: icon renders as a broken tab mark.
      expect(html).not.toContain('rel="icon" href="data:,"');
      expect(html).toContain('rel="icon" href="data:image/svg+xml,');
      expect(html).toContain(REPO_URL);
    }
  });

  it("puts the settled Mainnet pair on the product page itself", () => {
    const html = landingHtml();
    expect(html).toContain(`https://solscan.io/tx/${MAINNET_DFLOW_TX}`);
    expect(html).toContain(`https://solscan.io/tx/${MAINNET_X402_TX}`);
    expect(html).toContain('href="/ui#mainnet-proof"');
  });

  it("keeps the operator console proof signatures identical to proof.ts", () => {
    // app.js is served as a static asset, so it cannot import proof.ts.
    const appJs = readFileSync(
      new URL("../src/ui/app.js", import.meta.url),
      "utf8"
    );
    expect(appJs).toContain(MAINNET_DFLOW_TX);
    expect(appJs).toContain(MAINNET_X402_TX);
    expect(appJs).toContain('id="mainnet-proof"');
  });

  it("landing and demo HTML include the present path links", () => {
    expect(landingHtml()).toContain('href="/demo"');
    expect(landingHtml()).toContain('href="/ui"');
    expect(demoHtml()).toContain('href="/ui"');
    expect(demoHtml()).toContain('data-request="valuation"');
    expect(demoHtml()).toContain('data-request="price-check"');
    expect(demoHtml()).toContain('data-scenario="partial"');
  });
});

import { describe, expect, it } from "vitest";
import { createGatewayRuntime } from "../src/index.js";
import { landingHtml } from "../src/ui/landing-page.js";
import { demoHtml } from "../src/ui/demo-page.js";

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
      expect(demoHtml).toContain("You ask for the result");
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

  it("landing and demo HTML include the present path links", () => {
    expect(landingHtml()).toContain('href="/demo"');
    expect(landingHtml()).toContain('href="/ui"');
    expect(demoHtml()).toContain('href="/ui"');
    expect(demoHtml()).toContain('data-request="valuation"');
    expect(demoHtml()).toContain('data-request="price-check"');
    expect(demoHtml()).toContain('data-scenario="partial"');
  });
});

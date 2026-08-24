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
      expect(homeHtml).toContain("Try the demo");
      expect(homeHtml).toContain('href="/demo"');

      const demo = await gateway.app.request("/demo");
      expect(demo.status).toBe(200);
      expect(await demo.text()).toContain("Wallet valuation agent");

      const ui = await gateway.app.request("/ui");
      expect(ui.status).toBe(200);
      expect(await ui.text()).toContain('id="panel-now"');

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
    expect(demoHtml()).toContain('data-scenario="partial"');
  });
});

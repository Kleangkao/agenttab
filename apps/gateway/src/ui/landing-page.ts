import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function landingCss(): string {
  return readFileSync(join(here, "landing.css"), "utf8");
}

/** Brand-first product landing for judges who open the site with no slides. */
export function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentTab</title>
  <link rel="stylesheet" href="/landing.css" />
</head>
<body>
  <div class="land">
    <header class="land-brand">
      <span class="land-mark" aria-hidden="true">AT</span>
      <span class="land-name">AgentTab</span>
    </header>

    <main class="land-hero">
      <h1 class="land-title">Buy only the missing payment asset, then finish the original request</h1>
      <p class="land-lede">When an agent hits a standard x402 paywall short on USDC, AgentTab funds the exact deficit through DFlow — then the same request continues.</p>
      <div class="land-cta">
        <a class="land-btn land-btn-primary" href="/demo">Try the demo</a>
        <a class="land-btn land-btn-ghost" href="/ui">Operator proof</a>
      </div>
      <p class="land-proof">Already settled on Solana Mainnet:
        <a href="https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg">exact-deficit DFlow</a>
        ·
        <a href="https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR">x402 pay</a>
      </p>
    </main>
  </div>
</body>
</html>`;
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function demoCss(): string {
  return readFileSync(join(here, "demo.css"), "utf8");
}

export function demoJs(): string {
  return readFileSync(join(here, "demo.js"), "utf8");
}

/** Playable product surface: agent story + one-click mock settle. */
export function demoHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentTab demo</title>
  <link rel="stylesheet" href="/demo.css" />
</head>
<body>
  <div class="demo">
    <header class="demo-top">
      <a class="demo-brand" href="/">
        <span class="demo-mark" aria-hidden="true">AT</span>
        <span class="demo-name">AgentTab</span>
      </a>
      <nav class="demo-nav" aria-label="Demo">
        <a href="/demo" aria-current="page">Demo</a>
        <a href="/ui">Operator</a>
        <a href="/">Home</a>
      </nav>
    </header>

    <p class="demo-badge" id="mode-badge">Local DFlow mock — no chain</p>

    <section class="demo-agent" aria-labelledby="agent-heading">
      <p class="demo-kicker">Agent</p>
      <h1 id="agent-heading">Wallet valuation agent</h1>
      <p class="demo-intent" id="agent-intent">Needs a paid market snapshot to finish its task.</p>
    </section>

    <section class="demo-stage" aria-live="polite">
      <div id="status" class="demo-status" role="status"></div>
      <div id="panel" class="demo-panel">
        <p class="demo-loading">Loading the live request…</p>
      </div>
    </section>

    <section class="demo-controls" aria-label="Demo controls">
      <div class="demo-control-block">
        <h2>Scenario</h2>
        <div class="demo-chips" id="scenarios">
          <button type="button" class="chip" data-scenario="partial" aria-pressed="true">Partial USDC</button>
          <button type="button" class="chip" data-scenario="empty" aria-pressed="false">Empty USDC</button>
          <button type="button" class="chip" data-scenario="funded" aria-pressed="false">Already funded</button>
        </div>
      </div>
      <div class="demo-control-block">
        <h2>Wallet</h2>
        <button type="button" class="demo-btn demo-btn-ghost" id="topup">Add $1 USDC</button>
        <p class="demo-hint" id="wallet-hint">Balances update on the next parked request.</p>
      </div>
    </section>

    <footer class="demo-foot">
      Same loop already settled on Solana Mainnet —
      <a href="https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg">DFlow</a>
      ·
      <a href="https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR">x402</a>.
      No new Mainnet spend from this screen.
    </footer>
  </div>
  <script src="/demo.js"></script>
</body>
</html>`;
}

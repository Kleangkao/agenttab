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

/** Playable product surface: human request + one-click exact-deficit loop. */
export function demoHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentTab demo</title>
  <link rel="icon" href="data:," />
  <link rel="stylesheet" href="/demo.css" />
</head>
<body>
  <div class="demo">
    <header class="demo-top">
      <a class="demo-brand" href="/">
        <span class="demo-mark" aria-hidden="true">AT</span>
        <span class="demo-name">AgentTab</span>
      </a>
      <nav class="demo-nav" aria-label="Product surfaces">
        <a href="/">Product</a>
        <a href="/demo" aria-current="page">Interactive demo</a>
        <a href="/ui">Operator console</a>
      </nav>
    </header>

    <section class="demo-intro" aria-labelledby="demo-title">
      <div>
        <p class="demo-kicker">Interactive product demo</p>
        <h1 id="demo-title">You ask for the result. AgentTab handles the payment gap.</h1>
      </div>
      <p>Choose a paid task and a starting wallet. The agent will hit x402, AgentTab will calculate the exact deficit, and the original request will continue.</p>
    </section>

    <main class="demo-workspace">
      <section class="demo-builder" aria-labelledby="request-heading">
        <div class="demo-builder-head">
          <span>01</span>
          <div>
            <p class="demo-kicker">Your request</p>
            <h2 id="request-heading">What should the agent get for you?</h2>
          </div>
        </div>

        <div class="demo-control-block">
          <h3>Paid task</h3>
          <div class="demo-request-options" id="requests">
            <button type="button" class="request-option" data-request="valuation" aria-pressed="true">
              <span>Wallet valuation</span><strong>Value my wallet</strong><small>Paid market data · $4.00</small>
            </button>
            <button type="button" class="request-option" data-request="price-check" aria-pressed="false">
              <span>Price check</span><strong>Check SOL's live mark</strong><small>Paid market data · $1.25</small>
            </button>
            <button type="button" class="request-option" data-request="portfolio-refresh" aria-pressed="false">
              <span>Portfolio refresh</span><strong>Refresh my portfolio</strong><small>Paid market data · $5.00</small>
            </button>
          </div>
        </div>

        <div class="demo-control-block">
          <h3>Starting wallet</h3>
          <div class="demo-chips" id="scenarios">
            <button type="button" class="chip" data-scenario="partial" aria-pressed="true">Wallet is short</button>
            <button type="button" class="chip" data-scenario="empty" aria-pressed="false">No USDC</button>
            <button type="button" class="chip" data-scenario="funded" aria-pressed="false">Already covered</button>
          </div>
        </div>

        <button type="button" class="demo-btn demo-btn-primary" id="run-request">Run this request <span aria-hidden="true">→</span></button>
        <p class="demo-hint">This playground uses a local mock and never broadcasts. The amount AgentTab buys is always derived from the request deficit.</p>
      </section>

      <section class="demo-stage" aria-live="polite" aria-labelledby="execution-heading">
        <header class="demo-stage-head">
          <div>
            <span>02</span>
            <div>
              <p class="demo-kicker">AgentTab execution</p>
              <h2 id="execution-heading">Request → payment gap → result</h2>
            </div>
          </div>
          <p class="demo-badge" id="mode-badge">Local DFlow mock — no chain</p>
        </header>
        <div id="status" class="demo-status" role="status"></div>
        <div id="panel" class="demo-panel">
          <p class="demo-loading">Loading the active request…</p>
        </div>
      </section>
    </main>

    <footer class="demo-foot">
      <div><strong>Already proven on Solana Mainnet</strong><span>The same loop settled end to end; this screen does not create new Mainnet spend.</span></div>
      <div class="demo-foot-links">
        <a href="https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg">DFlow transaction ↗</a>
        <a href="https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR">x402 payment ↗</a>
        <a href="/ui">Open operator proof →</a>
      </div>
    </footer>
  </div>
  <script src="/demo.js"></script>
</body>
</html>`;
}

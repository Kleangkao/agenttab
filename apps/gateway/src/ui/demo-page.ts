import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pageHead, REPO_URL } from "./head.js";

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
${pageHead({
  title: "AgentTab interactive demo",
  description:
    "Pick a task and watch AgentTab cover the payment gap and finish the request. Safe demo, no real funds.",
  path: "/demo",
  stylesheet: "/demo.css"
})}
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
        <h1 id="demo-title">Ask for the result, not the transaction</h1>
      </div>
      <p>Choose a task and see AgentTab keep it moving when payment is short.</p>
    </section>

    <main class="demo-workspace">
      <section class="demo-builder" aria-labelledby="request-heading">
        <div class="demo-builder-head">
          <span>01</span>
          <div>
            <p class="demo-kicker">Choose a task</p>
            <h2 id="request-heading">What should the agent get for you?</h2>
          </div>
        </div>

        <div class="demo-control-block">
          <h3>Paid task</h3>
          <div class="demo-request-options" id="requests">
            <button type="button" class="request-option" data-request="valuation" aria-pressed="true">
              <span>Wallet valuation</span><strong>Value my wallet</strong><small>Costs $4.00 to run</small>
            </button>
            <button type="button" class="request-option" data-request="price-check" aria-pressed="false">
              <span>Price check</span><strong>Check SOL's live mark</strong><small>Costs $1.25 to run</small>
            </button>
            <button type="button" class="request-option" data-request="portfolio-refresh" aria-pressed="false">
              <span>Portfolio refresh</span><strong>Refresh my portfolio</strong><small>Costs $5.00 to run</small>
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
        <p class="demo-hint">Safe demo, no real funds. AgentTab only ever covers the amount this task is short.</p>
      </section>

      <section class="demo-stage" aria-live="polite" aria-labelledby="execution-heading">
        <header class="demo-stage-head">
          <div>
            <span>02</span>
            <div>
              <p class="demo-kicker">Your request</p>
              <h2 id="execution-heading">From payment gap to result</h2>
            </div>
          </div>
          <p class="demo-badge" id="mode-badge">Safe demo, no real funds</p>
        </header>
        <div id="status" class="demo-status" role="status"></div>
        <div id="panel" class="demo-panel">
          <p class="demo-loading">Loading the active request…</p>
        </div>
      </section>
    </main>

    <footer class="demo-foot">
      <div><strong>Verified on Solana Mainnet</strong><span>This screen is a safe demo and does not create new Mainnet spend.</span></div>
      <div class="demo-foot-links">
        <a href="/ui#mainnet-proof">View technical proof →</a>
        <a href="${REPO_URL}" target="_blank" rel="noopener">Source on GitHub →</a>
      </div>
    </footer>
  </div>
  <script src="/demo.js"></script>
</body>
</html>`;
}

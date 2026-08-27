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

/** Shared by both public surfaces; English HTML, Thai applied in the browser. */
export function i18nJs(): string {
  return readFileSync(join(here, "i18n.js"), "utf8");
}

/** Playable product surface: human request + one-click exact-deficit loop. */
export function demoHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
${pageHead({
  title: "AgentTab interactive demo",
  description:
    "Pick a paid service and watch AgentTab swap SOL into the missing amount and finish the request. Safe demo, no real funds.",
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
        <a href="/" data-i18n="nav.product">Product</a>
        <a href="/demo" aria-current="page" data-i18n="nav.demo">Interactive demo</a>
        <a href="/ui" data-i18n="nav.console">Operator console</a>
        <button type="button" class="lang-toggle" id="lang-toggle">ไทย</button>
      </nav>
    </header>

    <section class="demo-intro" aria-labelledby="demo-title">
      <div>
        <p class="demo-kicker" data-i18n="d.kicker">Interactive product demo</p>
        <h1 id="demo-title" data-i18n="d.title">Ask for the result, not the transaction</h1>
      </div>
      <p data-i18n="d.sub">Pick a paid service and see AgentTab keep the request moving when the wallet is short.</p>
    </section>

    <main class="demo-workspace">
      <section class="demo-builder" aria-labelledby="request-heading">
        <div class="demo-builder-head">
          <span>01</span>
          <div>
            <p class="demo-kicker" data-i18n="d.step1.kicker">Choose a task</p>
            <h2 id="request-heading" data-i18n="d.step1.h2">What should the agent pay for?</h2>
          </div>
        </div>

        <div class="demo-control-block">
          <h3 data-i18n="d.block.task">Paid service</h3>
          <div class="demo-request-options" id="requests">
            <button type="button" class="request-option" data-request="subscription" aria-pressed="true">
              <span data-i18n="d.task.sub.cat">Subscription</span><strong data-i18n="d.task.sub.name">Pay a monthly subscription</strong><small data-i18n="d.task.sub.price">Costs $5.00 a month</small>
            </button>
            <button type="button" class="request-option" data-request="agentic-ai" aria-pressed="false">
              <span data-i18n="d.task.ai.cat">Agentic AI</span><strong data-i18n="d.task.ai.name">Pay for an agentic AI service</strong><small data-i18n="d.task.ai.price">Costs $1.25 a call</small>
            </button>
          </div>
        </div>

        <div class="demo-control-block">
          <h3 data-i18n="d.block.wallet">Starting wallet</h3>
          <div class="demo-chips" id="scenarios">
            <button type="button" class="chip" data-scenario="partial" aria-pressed="true" data-i18n="d.sc.partial">Some USDC, not enough</button>
            <button type="button" class="chip" data-scenario="empty" aria-pressed="false" data-i18n="d.sc.empty">Only SOL, no USDC</button>
            <button type="button" class="chip" data-scenario="funded" aria-pressed="false" data-i18n="d.sc.funded">Enough USDC already</button>
          </div>
        </div>

        <button type="button" class="demo-btn demo-btn-primary" id="run-request"><span data-i18n="d.run">Run this request</span> <span aria-hidden="true">→</span></button>
        <p class="demo-hint" data-i18n="d.hint">Safe demo, no real funds. AgentTab only ever covers the amount this task is short.</p>
      </section>

      <section class="demo-stage" aria-live="polite" aria-labelledby="execution-heading">
        <header class="demo-stage-head">
          <div>
            <span>02</span>
            <div>
              <p class="demo-kicker" data-i18n="d.step2.kicker">Your request</p>
              <h2 id="execution-heading" data-i18n="d.step2.h2">From payment gap to result</h2>
            </div>
          </div>
          <p class="demo-badge" id="mode-badge">Safe demo, no real funds</p>
        </header>
        <div id="status" class="demo-status" role="status"></div>
        <div id="panel" class="demo-panel">
          <p class="demo-loading" data-i18n="d.loading">Loading the active request…</p>
        </div>
      </section>
    </main>

    <footer class="demo-foot">
      <div><strong data-i18n="d.foot.title">Verified on Solana Mainnet</strong><span data-i18n="d.foot.note">This screen is a safe demo and does not create new Mainnet spend.</span></div>
      <div class="demo-foot-links">
        <a href="/ui#mainnet-proof" data-i18n="d.foot.proof">View technical proof →</a>
        <a href="${REPO_URL}" target="_blank" rel="noopener" data-i18n="foot.src">Source on GitHub →</a>
      </div>
    </footer>
  </div>
  <script src="/i18n.js"></script>
  <script src="/demo.js"></script>
</body>
</html>`;
}

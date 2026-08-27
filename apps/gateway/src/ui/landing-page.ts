import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pageHead, REPO_URL } from "./head.js";
import { MAINNET_DFLOW_TX, MAINNET_X402_TX, solscanTx } from "./proof.js";

const here = dirname(fileURLToPath(import.meta.url));

export function landingCss(): string {
  return readFileSync(join(here, "landing.css"), "utf8");
}

/**
 * Product-first landing for judges who open the site with no slides.
 * Sells the outcome. The only technical claims here are "Powered by DFlow"
 * and the Mainnet proof strip; everything else lives on /ui.
 *
 * English is the served copy; /i18n.js swaps it to Thai in the browser.
 */
export function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
${pageHead({
  title: "AgentTab",
  description:
    "AgentTab swaps the SOL you already hold into only the amount your agent is missing, then continues the original request. Powered by DFlow on Solana.",
  path: "/",
  stylesheet: "/landing.css"
})}
</head>
<body>
  <div class="land">
    <header class="land-top">
      <a class="land-brand" href="/" aria-label="AgentTab product">
        <span class="land-mark" aria-hidden="true">AT</span>
        <span class="land-name">AgentTab</span>
      </a>
      <nav class="land-nav" aria-label="Product surfaces">
        <a href="/" aria-current="page" data-i18n="nav.product">Product</a>
        <a href="/demo" data-i18n="nav.demo">Interactive demo</a>
        <a href="/ui" data-i18n="nav.console">Operator console</a>
        <button type="button" class="lang-toggle" id="lang-toggle">ไทย</button>
      </nav>
    </header>

    <main>
      <section class="land-hero" aria-labelledby="product-title">
        <div class="land-hero-copy">
          <p class="land-eyebrow" data-i18n="l.eyebrow">Powered by DFlow on Solana</p>
          <h1 class="land-title" id="product-title" data-i18n="l.title">Keep agents moving when payments fall short</h1>
          <p class="land-lede" data-i18n="l.lede">AgentTab swaps the SOL you already hold into only the amount you are missing, then the request carries on. Your agent never stops to ask for money, and you never see a trading screen.</p>
          <div class="land-cta">
            <a class="land-btn land-btn-primary" href="/demo"><span data-i18n="l.cta">Try the interactive demo</span> <span aria-hidden="true">→</span></a>
            <span class="land-badge" data-i18n="l.badge">Safe demo, no real funds</span>
          </div>
        </div>

        <div class="land-product-card" aria-label="Example AgentTab request">
          <div class="land-card-head">
            <div>
              <span data-i18n="l.card.req">Your request</span>
              <strong data-i18n="l.card.task">Pay a monthly subscription</strong>
            </div>
            <span class="land-card-state" data-i18n="l.card.state">Payment needed</span>
          </div>
          <div class="land-equation" data-i18n-aria="l.card.eq" aria-label="You have 1 dollar 50 cents, the service costs 5 dollars, AgentTab covers 3 dollars 50 cents">
            <div><span data-i18n="l.card.have">You have</span><strong>$1.50</strong><small data-i18n="l.card.have.sub">in your wallet</small></div>
            <b aria-hidden="true">→</b>
            <div><span data-i18n="l.card.cost">Service costs</span><strong>$5.00</strong><small data-i18n="l.card.cost.sub">to run this task</small></div>
            <b aria-hidden="true">=</b>
            <div class="is-deficit"><span data-i18n="l.card.cover">AgentTab covers</span><strong>$3.50</strong><small data-i18n="l.card.cover.sub">only what is missing</small></div>
          </div>
          <ol class="land-card-flow">
            <li class="is-done" data-i18n="l.flow.1">Request</li>
            <li class="is-done" data-i18n="l.flow.2">Payment needed</li>
            <li class="is-active" data-i18n="l.flow.3">Covered</li>
            <li data-i18n="l.flow.4">Paid</li>
            <li data-i18n="l.flow.5">Result</li>
          </ol>
          <p class="land-card-note" data-i18n="l.card.note">You get the answer you asked for. AgentTab handles the shortfall in the background.</p>
        </div>
      </section>

      <section class="land-loop" aria-labelledby="loop-title">
        <div class="land-section-head">
          <p class="land-eyebrow" data-i18n="l.loop.eyebrow">One bounded product loop</p>
          <h2 id="loop-title" data-i18n="l.loop.title">Your agent keeps working</h2>
          <p data-i18n="l.loop.body">You ask for a result, not a transaction. When a paid step costs more than the wallet holds, AgentTab closes the gap and the same request carries on, without handing your agent open-ended spending power.</p>
        </div>
        <ol class="land-steps">
          <li><span>01</span><strong data-i18n="l.step1.t">Your agent needs a paid service</strong><p data-i18n="l.step1.p">It is working on your task and reaches a step that costs money.</p></li>
          <li><span>02</span><strong data-i18n="l.step2.t">AgentTab covers the shortfall</strong><p data-i18n="l.step2.p">Your rules decide what is allowed, and only the missing amount is covered, never more.</p></li>
          <li><span>03</span><strong data-i18n="l.step3.t">The task finishes</strong><p data-i18n="l.step3.p">The service is paid, the result comes back, and one record shows exactly what happened.</p></li>
        </ol>
      </section>

      <section class="land-trust" aria-labelledby="trust-title">
        <p id="trust-title"><strong data-i18n="l.trust.lead">Proven end-to-end on Solana Mainnet.</strong><span data-i18n="l.trust.rest"> This site runs a safe demo; the same loop has already settled for real.</span></p>
        <p class="land-trust-links">
          <a href="${solscanTx(MAINNET_DFLOW_TX)}" target="_blank" rel="noopener" data-i18n="l.trust.fund">Funding transaction</a>
          <span aria-hidden="true">→</span>
          <a href="${solscanTx(MAINNET_X402_TX)}" target="_blank" rel="noopener" data-i18n="l.trust.pay">Payment transaction</a>
          <span aria-hidden="true">→</span>
          <a href="/ui#mainnet-proof" data-i18n="l.trust.audit">Full audit trail</a>
        </p>
      </section>
    </main>

    <footer class="land-foot">
      <span>AgentTab</span>
      <span data-i18n="l.foot.powered">Powered by DFlow on Solana</span>
      <a href="${REPO_URL}" target="_blank" rel="noopener" data-i18n="foot.src">Source on GitHub →</a>
    </footer>
  </div>
  <script src="/i18n.js"></script>
</body>
</html>`;
}

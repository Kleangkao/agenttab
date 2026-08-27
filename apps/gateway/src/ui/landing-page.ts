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
 */
export function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
${pageHead({
  title: "AgentTab",
  description:
    "AgentTab covers only the missing amount when an agent's wallet falls short, then continues the original request. Powered by DFlow on Solana.",
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
        <a href="/" aria-current="page">Product</a>
        <a href="/demo">Interactive demo</a>
        <a href="/ui">Operator console</a>
      </nav>
    </header>

    <main>
      <section class="land-hero" aria-labelledby="product-title">
        <div class="land-hero-copy">
          <p class="land-eyebrow">Powered by DFlow on Solana</p>
          <h1 class="land-title" id="product-title">Keep agents moving when payments fall short.</h1>
          <p class="land-lede">AgentTab covers only the missing amount and continues the request. Your agent never stops to ask for money, and you never see a trading screen.</p>
          <div class="land-cta">
            <a class="land-btn land-btn-primary" href="/demo">Try the interactive demo <span aria-hidden="true">→</span></a>
            <span class="land-badge">Safe demo — no real funds</span>
          </div>
        </div>

        <div class="land-product-card" aria-label="Example AgentTab request">
          <div class="land-card-head">
            <div>
              <span>Your request</span>
              <strong>Value my wallet</strong>
            </div>
            <span class="land-card-state">Payment needed</span>
          </div>
          <div class="land-equation" aria-label="You have 2 dollars 60 cents, the service costs 4 dollars, AgentTab covers 1 dollar 40 cents">
            <div><span>You have</span><strong>$2.60</strong><small>in your wallet</small></div>
            <b aria-hidden="true">→</b>
            <div><span>Service costs</span><strong>$4.00</strong><small>to run this task</small></div>
            <b aria-hidden="true">=</b>
            <div class="is-deficit"><span>AgentTab covers</span><strong>$1.40</strong><small>only what is missing</small></div>
          </div>
          <ol class="land-card-flow">
            <li class="is-done">Request</li>
            <li class="is-done">Payment needed</li>
            <li class="is-active">Covered</li>
            <li>Paid</li>
            <li>Result</li>
          </ol>
          <p class="land-card-note">You get the answer you asked for. AgentTab handles the shortfall in the background.</p>
        </div>
      </section>

      <section class="land-loop" aria-labelledby="loop-title">
        <div class="land-section-head">
          <p class="land-eyebrow">One bounded product loop</p>
          <h2 id="loop-title">Your agent keeps working.</h2>
          <p>You ask for a result, not a transaction. When a paid step costs more than the wallet holds, AgentTab closes the gap and the same request carries on — without handing your agent open-ended spending power.</p>
        </div>
        <ol class="land-steps">
          <li><span>01</span><strong>Your agent needs a paid service</strong><p>It is working on your task and reaches a step that costs money.</p></li>
          <li><span>02</span><strong>AgentTab covers the shortfall</strong><p>Your rules decide what is allowed, and only the missing amount is covered — never more.</p></li>
          <li><span>03</span><strong>The task finishes</strong><p>The service is paid, the result comes back, and one record shows exactly what happened.</p></li>
        </ol>
      </section>

      <section class="land-trust" aria-labelledby="trust-title">
        <p id="trust-title"><strong>Proven end-to-end on Solana Mainnet.</strong> This site runs a safe demo; the same loop has already settled for real.</p>
        <p class="land-trust-links">
          <a href="${solscanTx(MAINNET_DFLOW_TX)}" target="_blank" rel="noopener">Funding transaction</a>
          <span aria-hidden="true">→</span>
          <a href="${solscanTx(MAINNET_X402_TX)}" target="_blank" rel="noopener">Payment transaction</a>
          <span aria-hidden="true">→</span>
          <a href="/ui#mainnet-proof">Full audit trail</a>
        </p>
      </section>
    </main>

    <footer class="land-foot">
      <span>AgentTab</span>
      <span>Powered by DFlow on Solana.</span>
      <a href="${REPO_URL}" target="_blank" rel="noopener">Source on GitHub →</a>
    </footer>
  </div>
</body>
</html>`;
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function landingCss(): string {
  return readFileSync(join(here, "landing.css"), "utf8");
}

/** Product-first landing for judges who open the site with no slides. */
export function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentTab</title>
  <link rel="icon" href="data:," />
  <link rel="stylesheet" href="/landing.css" />
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
          <p class="land-eyebrow">Agent-native payments on Solana</p>
          <h1 class="land-title" id="product-title">Ask for the outcome. AgentTab handles the missing payment asset.</h1>
          <p class="land-lede">When a paid agent task hits x402 without enough USDC, AgentTab uses DFlow to acquire only the exact deficit, pays the merchant, and continues the same request.</p>
          <div class="land-cta">
            <a class="land-btn land-btn-primary" href="/demo">Try the interactive demo <span aria-hidden="true">→</span></a>
            <a class="land-btn land-btn-ghost" href="/ui">See technical proof</a>
          </div>
          <p class="land-honesty">The public experience is a safe local mock. The same loop has already settled on Solana Mainnet.</p>
        </div>

        <div class="land-product-card" aria-label="Example AgentTab request">
          <div class="land-card-head">
            <div>
              <span>Your request</span>
              <strong>Value my wallet</strong>
            </div>
            <span class="land-card-state">Waiting on payment</span>
          </div>
          <div class="land-equation" aria-label="Wallet holds 2 dollars 60 cents, request needs 4 dollars, DFlow buys 1 dollar 40 cents">
            <div><span>Wallet holds</span><strong>$2.60</strong><small>USDC</small></div>
            <b aria-hidden="true">→</b>
            <div><span>Request needs</span><strong>$4.00</strong><small>x402 ask</small></div>
            <b aria-hidden="true">=</b>
            <div class="is-deficit"><span>DFlow buys</span><strong>$1.40</strong><small>exact deficit</small></div>
          </div>
          <ol class="land-card-flow">
            <li class="is-done">Request</li>
            <li class="is-done">x402</li>
            <li class="is-active">DFlow</li>
            <li>Pay</li>
            <li>Result</li>
          </ol>
          <p class="land-card-note">No swap screen. The trade exists only so the original task can finish.</p>
        </div>
      </section>

      <section class="land-loop" aria-labelledby="loop-title">
        <div class="land-section-head">
          <p class="land-eyebrow">One bounded product loop</p>
          <h2 id="loop-title">The swap is a step, not the destination.</h2>
          <p>The user asks for a result. AgentTab turns an insufficient payment asset into a completed request without giving the agent open-ended trading permission.</p>
        </div>
        <ol class="land-steps">
          <li><span>01</span><strong>Request a paid resource</strong><p>The agent encounters a standard x402 payment requirement while working for the user.</p></li>
          <li><span>02</span><strong>Buy only what is missing</strong><p>Policy approves the task and DFlow acquires the exact payment-asset deficit.</p></li>
          <li><span>03</span><strong>Continue the same request</strong><p>x402 settles, the paid resource is delivered, and one audit trail binds the whole loop.</p></li>
        </ol>
      </section>

      <section class="land-proof" aria-labelledby="proof-title">
        <div>
          <p class="land-eyebrow">Historical Mainnet proof</p>
          <h2 id="proof-title">Already settled end to end.</h2>
          <p>DFlow acquired the missing USDC, x402 paid the merchant, and the original request reached <code>fulfilled</code>.</p>
        </div>
        <div class="land-proof-links">
          <a href="https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg"><span>1</span> Exact-deficit DFlow <b aria-hidden="true">↗</b></a>
          <a href="https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR"><span>2</span> x402 payment <b aria-hidden="true">↗</b></a>
          <a href="/ui"><span>3</span> Operator audit trail <b aria-hidden="true">→</b></a>
        </div>
      </section>
    </main>

    <footer class="land-foot">
      <span>AgentTab</span>
      <span>Built around DFlow trading + standard x402 payments.</span>
    </footer>
  </div>
</body>
</html>`;
}

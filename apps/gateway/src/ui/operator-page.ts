import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function operatorCss(): string {
  return readFileSync(join(here, "app.css"), "utf8");
}

export function operatorJs(): string {
  return readFileSync(join(here, "app.js"), "utf8");
}

export function operatorHtml(input: {
  adminRequired: boolean;
  agentRequired?: boolean;
  policyMode: string;
}): string {
  const boot = JSON.stringify({
    adminRequired: input.adminRequired,
    agentRequired: input.agentRequired === true,
    policyMode: input.policyMode
  });
  const observeHidden = input.policyMode === "observe" ? "" : " hidden";
  const tokenPlaceholder = input.adminRequired
    ? "AGENTTAB_ADMIN_TOKEN"
    : "AGENTTAB_AGENT_TOKEN";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentTab</title>
  <link rel="stylesheet" href="/ui/app.css" />
</head>
<body>
  <div class="app">
    <header class="top">
      <div class="brand">
        <h1>AgentTab</h1>
        <p>See what agents are doing with money, then decide. Preview never funds. Release still spends.</p>
      </div>
      <div>
        <nav class="nav" aria-label="Operator">
          <button type="button" data-view="inbox">Needs you <span class="count" id="parked-count">0</span></button>
          <button type="button" data-view="activity">Activity</button>
          <button type="button" data-view="rules">Rules</button>
          <button type="button" data-view="ask">Ask</button>
        </nav>
        <label class="field" style="margin-top:10px;align-items:flex-end">Gateway token
          <input id="token" type="password" autocomplete="off" placeholder="${tokenPlaceholder}" />
        </label>
      </div>
    </header>

    <p class="notice" id="observe-banner"${observeHidden}>Observe is not a dry-run. Matching payments can still fund and pay.</p>

    <section class="posture" aria-label="Treasury">
      <div class="meter">
        <div class="label">Spent today</div>
        <div class="value" id="spend-used">—</div>
        <div class="bar" aria-hidden="true"><span id="spend-bar"></span></div>
        <p class="help" id="spend-copy">Loading spend…</p>
      </div>
      <div class="stat">
        <div class="label">Ready to pay</div>
        <strong id="wallet-value">—</strong>
        <em id="wallet-copy">Buyer wallet</em>
      </div>
      <div class="stat">
        <div class="label">How money moves</div>
        <strong id="mode-value">${input.policyMode}</strong>
        <em id="mode-copy">Loading policy…</em>
      </div>
    </section>
    <p class="help" id="flags"></p>
    <p class="help" id="auth-note"></p>
    <p class="status" id="status"></p>

    <section class="unlock" id="unlock" hidden>
      <h2>Unlock this console</h2>
      <p>This gateway is gated. Paste the token the process was started with. It stays in this tab only.</p>
      <button class="btn primary" id="unlock-open" type="button">Open with this token</button>
    </section>

    <div id="workspace">
      <section class="panel" id="panel-inbox">
        <div id="inbox-list"></div>
      </section>

      <section class="panel" id="panel-activity" hidden>
        <div id="activity-list"></div>
      </section>

      <section class="panel" id="panel-rules" hidden>
        <div class="block">
          <h3>When should agents wait?</h3>
          <div class="mode-grid">
            <button type="button" class="mode" data-mode="observe" aria-pressed="false">
              <strong>Watch</strong>
              <span>Observe is not a dry-run. Policy is looser; spends can still happen.</span>
            </button>
            <button type="button" class="mode" data-mode="approve" aria-pressed="false">
              <strong>Ask me</strong>
              <span>Park payments that need a person. Release or reject from Needs you.</span>
            </button>
            <button type="button" class="mode" data-mode="autopay" aria-pressed="false">
              <strong>Within limits</strong>
              <span>Matching merchants and caps pay without interrupting the agent.</span>
            </button>
          </div>
        </div>
        <div class="block">
          <h3>Who agents may pay</h3>
          <div class="chips" id="allowed"></div>
          <form class="row" id="origin-form">
            <label class="field">Merchant origin
              <input id="new-origin" placeholder="http://127.0.0.1:8791" />
            </label>
            <button class="btn ghost" type="submit">Allow this merchant</button>
          </form>
        </div>
        <div class="block">
          <h3>How much</h3>
          <p class="help">Caps are µUSD — millionths of a dollar. $1.00 is 1000000.</p>
          <form class="row" id="caps-form">
            <label class="field">Max payment µUSD <input id="max-payment" inputmode="numeric" /></label>
            <label class="field">Max daily µUSD <input id="max-daily" inputmode="numeric" /></label>
            <label class="field">Ask me above µUSD <input id="approve-above" placeholder="empty = always ask in Ask me" /></label>
            <button class="btn primary" type="submit">Save limits</button>
          </form>
        </div>
        <div class="block">
          <details>
            <summary>Advanced policy JSON</summary>
            <p class="help">Same document the CLIs and SDK write. Prefer the controls above unless you need networks or mints.</p>
            <form id="json-form">
              <label class="field">Policy
                <textarea id="policy-json" spellcheck="false"></textarea>
              </label>
              <div class="row" style="margin-top:12px">
                <button class="btn ghost" type="submit">Save policy JSON</button>
              </div>
            </form>
          </details>
        </div>
      </section>

      <section class="panel" id="panel-ask" hidden>
        <div class="block">
          <h3>Would this be allowed?</h3>
          <p class="help">Ask evaluates the live policy only. It never creates an execution, funds, pays, or fulfills.</p>
          <form id="ask-form">
            <div class="row">
              <label class="field">Merchant origin <input id="ask-origin" value="http://127.0.0.1:8791" /></label>
              <label class="field">Resource <input id="ask-resource" value="http://127.0.0.1:8791/v1/market-snapshot" /></label>
            </div>
            <div class="row">
              <label class="field">Amount atomic <input id="ask-atomic" value="1000" /></label>
              <label class="field">Amount µUSD <input id="ask-usd" value="1000" /></label>
              <label class="field">Network
                <select id="ask-network">
                  <option value="solana:local">solana:local</option>
                  <option value="solana:devnet">solana:devnet</option>
                  <option value="solana:mainnet">solana:mainnet</option>
                </select>
              </label>
            </div>
            <label class="field">Payment mint
              <input id="ask-mint" value="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" />
            </label>
            <div class="row" style="margin-top:12px">
              <button class="btn primary" type="submit">Ask the policy</button>
            </div>
          </form>
          <div class="ask-result" id="ask-result" hidden></div>
        </div>
      </section>
    </div>

    <p class="help footer-note">
      Same control plane as the CLIs.
      <a href="/openapi.json">OpenAPI</a>
      · Release funds · Reject is terminal · token stays in sessionStorage
    </p>
  </div>

  <div class="modal-back" id="confirm" hidden aria-hidden="true">
    <div class="modal" role="dialog" aria-labelledby="confirm-title">
      <h2 id="confirm-title">Release this payment?</h2>
      <p id="confirm-copy"></p>
      <div class="row">
        <button class="btn primary" id="confirm-ok" type="button">Release</button>
        <button class="btn ghost" id="confirm-cancel" type="button">Keep waiting</button>
      </div>
    </div>
  </div>

  <script>window.AGENTTAB = ${boot};</script>
  <script src="/ui/app.js"></script>
</body>
</html>`;
}

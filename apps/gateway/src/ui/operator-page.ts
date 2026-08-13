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
  <div class="shell">
    <header class="top">
      <a class="brand" href="/ui">
        <strong>AgentTab</strong>
        <span>Buy only the missing payment asset, then finish the original request</span>
      </a>
      <nav class="nav" aria-label="AgentTab">
        <button type="button" data-view="now">Now <span class="count" id="parked-count"></span></button>
        <button type="button" data-view="ledger">Ledger</button>
        <button type="button" data-view="policy">Policy</button>
      </nav>
    </header>

    <p class="stance" id="stance">Loading the live policy…</p>
    <p class="notice" id="observe-banner"${observeHidden}>Observe is not a dry-run. Matching payments can still fund and pay.</p>
    <p class="status" id="status"></p>

    <section class="unlock" id="unlock" hidden>
      <h1>Unlock AgentTab</h1>
      <p>This gateway requires a token before you can see spend, policy, or pending payments. It stays in this browser tab.</p>
      <label class="field">Gateway token
        <input id="token" type="password" autocomplete="off" placeholder="${tokenPlaceholder}" />
      </label>
      <button class="btn primary" id="unlock-open" type="button">Continue</button>
    </section>

    <main id="workspace">
      <section id="panel-now">
        <div id="decision-list"></div>
      </section>

      <section id="panel-ledger" hidden>
        <div id="ledger-list"></div>
      </section>

      <section class="policy" id="panel-policy" hidden>
        <h2>When should AgentTab pay?</h2>
        <p>This is the live policy. Changing it affects the next agent payment, not a copy of the file on disk.</p>
        <div class="modes">
          <button type="button" class="mode" data-mode="observe" aria-pressed="false">
            <strong>Watch</strong>
            <span>Observe is not a dry-run. Policy is looser; matching payments can still spend.</span>
          </button>
          <button type="button" class="mode" data-mode="approve" aria-pressed="false">
            <strong>Ask you first</strong>
            <span>Agents wait on Now until you approve or reject.</span>
          </button>
          <button type="button" class="mode" data-mode="autopay" aria-pressed="false">
            <strong>Pay within limits</strong>
            <span>Matching merchants and caps pay without stopping the agent.</span>
          </button>
        </div>

        <h2>Who agents may pay</h2>
        <div class="merchants" id="allowed"></div>
        <form class="row" id="origin-form">
          <label class="field">Merchant origin
            <input id="new-origin" placeholder="http://127.0.0.1:8791" />
          </label>
          <button class="btn ghost" type="submit">Allow this merchant</button>
        </form>

        <h2>How much</h2>
        <p>Limits are stored as millionths of a dollar. You edit them as dollars.</p>
        <form class="row" id="caps-form">
          <label class="field">Max payment
            <input id="max-payment" inputmode="decimal" placeholder="5.00" />
          </label>
          <label class="field">Max per day
            <input id="max-daily" inputmode="decimal" placeholder="20.00" />
          </label>
          <label class="field">Ask you above
            <input id="approve-above" inputmode="decimal" placeholder="always ask in Ask you first" />
          </label>
          <button class="btn primary" type="submit">Save limits</button>
        </form>

        <section class="check">
          <h2>Would this be allowed?</h2>
          <p>Checks the live policy only. It never creates an execution, funds, pays, or fulfills.</p>
          <form id="ask-form">
            <div class="row">
              <label class="field">Merchant origin <input id="ask-origin" value="http://127.0.0.1:8791" /></label>
              <label class="field">What the agent wants <input id="ask-resource" value="http://127.0.0.1:8791/v1/market-snapshot" /></label>
            </div>
            <div class="row">
              <label class="field">Amount in USD <input id="ask-usd" value="2.50" /></label>
              <label class="field">Network
                <select id="ask-network">
                  <option value="solana:local">Local</option>
                  <option value="solana:devnet">Solana Devnet</option>
                  <option value="solana:mainnet">Solana Mainnet</option>
                </select>
              </label>
            </div>
            <div class="row" style="margin-top:12px">
              <button class="btn primary" type="submit">Check policy</button>
            </div>
          </form>
          <div class="check-result" id="ask-result" hidden></div>
        </section>

        <details>
          <summary>Advanced policy JSON</summary>
          <p>Same document the CLIs and SDK write. Networks and mints live here.</p>
          <form id="json-form">
            <textarea class="policy-json" id="policy-json" spellcheck="false"></textarea>
            <div class="row" style="margin-top:12px">
              <button class="btn ghost" type="submit">Save policy JSON</button>
            </div>
          </form>
        </details>
      </section>
    </main>

    <p class="foot">Reject is final. Preview never moves money. Local mock, Devnet, and Mainnet are labeled on the request. <a href="/openapi.json">Machine contract</a></p>
  </div>

  <script>window.AGENTTAB = ${boot};</script>
  <script src="/ui/app.js"></script>
</body>
</html>`;
}

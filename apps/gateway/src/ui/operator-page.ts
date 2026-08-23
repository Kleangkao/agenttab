import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Self-hosted so the console never depends on an external font host. */
const FONT_FILES = [
  "ibm-plex-sans-400.woff2",
  "ibm-plex-sans-600.woff2",
  "ibm-plex-mono-400.woff2",
  "ibm-plex-mono-600.woff2"
] as const;

/** Returns undefined when the file is not a known face or is not vendored. */
export function operatorFont(name: string): ArrayBuffer | undefined {
  if (!(FONT_FILES as readonly string[]).includes(name)) return undefined;
  try {
    const file = readFileSync(join(here, "fonts", name));
    return file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength
    ) as ArrayBuffer;
  } catch {
    return undefined;
  }
}

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
    <aside class="rail">
      <a class="brand" href="/ui">
        <span class="brand-head">
          <span class="brand-mark" aria-hidden="true">AT</span>
          <span class="brand-name">AgentTab</span>
        </span>
        <span class="brand-copy">Buy only the missing payment asset, then finish the original request</span>
      </a>

      <span class="mode-badge" id="mode-badge" aria-live="polite">…</span>
      <p class="mode-note" id="mode-note"></p>

      <nav class="rail-nav" aria-label="AgentTab">
        <button type="button" data-view="now">Now <span class="count" id="parked-count"></span></button>
        <button type="button" data-view="ledger">Ledger</button>
        <button type="button" data-view="policy">Policy</button>
      </nav>

      <div class="rail-blocks" id="judge-stats" hidden></div>

      <p class="stance" id="stance">Loading the live policy…</p>
      <details class="proof-details">
        <summary>Mainnet proof &amp; mode</summary>
        <p class="proof" id="proof">This /ui is a local DFlow mock — no chain. The same loop already settled on Solana Mainnet: <a href="https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg">exact-deficit DFlow</a> then <a href="https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR">x402 pay</a>, then the original request continued. No new Mainnet spend from this screen.</p>
      </details>
    </aside>

    <main class="stage">
      <div class="stage-inner">
        <p class="notice" id="observe-banner"${observeHidden}>Observe is not a dry-run. Matching payments can still fund and pay.</p>
        <p class="status" id="status" role="status"></p>

        <section class="unlock" id="unlock" hidden>
          <div class="unlock-card">
            <h1>Unlock AgentTab</h1>
            <p>This gateway requires a token before you can see spend, policy, or pending payments. It stays in this browser tab.</p>
            <label class="field">Gateway token
              <input id="token" type="password" autocomplete="off" placeholder="${tokenPlaceholder}" />
            </label>
            <button class="btn btn-primary" id="unlock-open" type="button">Continue</button>
          </div>
        </section>

        <div id="workspace">
          <section id="panel-now">
            <div id="verdict"></div>
            <div id="decision-list"></div>
          </section>

          <section id="panel-ledger" hidden>
            <div id="ledger-list"></div>
          </section>

          <section class="policy-panel" id="panel-policy" hidden>
            <header class="panel-head">
              <h2>Payment policy</h2>
              <p>Live rules for the next agent payment — not a copy of the file on disk.</p>
            </header>

            <div class="policy-section">
              <h3>When should AgentTab pay?</h3>
              <div class="modes">
                <button type="button" class="mode-card" data-mode="observe" aria-pressed="false">
                  <strong>Watch</strong>
                  <span>Observe is not a dry-run. Policy is looser; matching payments can still spend.</span>
                </button>
                <button type="button" class="mode-card" data-mode="approve" aria-pressed="false">
                  <strong>Ask you first</strong>
                  <span>Agents wait on Now until you approve or reject.</span>
                </button>
                <button type="button" class="mode-card" data-mode="autopay" aria-pressed="false">
                  <strong>Pay within limits</strong>
                  <span>Matching merchants and caps pay without stopping the agent.</span>
                </button>
              </div>
            </div>

            <div class="policy-section">
              <h3>Who agents may pay</h3>
              <div class="merchants" id="allowed"></div>
              <form class="form-row" id="origin-form">
                <label class="field">Merchant origin
                  <input id="new-origin" placeholder="http://127.0.0.1:8791" />
                </label>
                <button class="btn btn-ghost" type="submit">Allow merchant</button>
              </form>
            </div>

            <div class="policy-section">
              <h3>Spend limits</h3>
              <p class="hint">Stored as millionths of a dollar; edit as dollars.</p>
              <form class="form-row" id="caps-form">
                <label class="field">Max payment
                  <input id="max-payment" inputmode="decimal" placeholder="5.00" />
                </label>
                <label class="field">Max per day
                  <input id="max-daily" inputmode="decimal" placeholder="20.00" />
                </label>
                <label class="field">Ask you above
                  <input id="approve-above" inputmode="decimal" placeholder="always ask in Ask you first" />
                </label>
                <button class="btn btn-primary" type="submit">Save limits</button>
              </form>
            </div>

            <section class="policy-section check">
              <h3>Would this be allowed?</h3>
              <p class="hint">Checks the live policy only. It never creates an execution, funds, pays, or fulfills.</p>
              <form id="ask-form">
                <div class="form-row">
                  <label class="field">Merchant origin <input id="ask-origin" value="http://127.0.0.1:8791" /></label>
                  <label class="field">What the agent wants <input id="ask-resource" value="http://127.0.0.1:8791/v1/market-snapshot" /></label>
                </div>
                <div class="form-row">
                  <label class="field">Amount in USD <input id="ask-usd" value="2.50" /></label>
                  <label class="field">Network
                    <select id="ask-network">
                      <option value="solana:local">Local</option>
                      <option value="solana:devnet">Solana Devnet</option>
                      <option value="solana:mainnet">Solana Mainnet</option>
                    </select>
                  </label>
                </div>
                <div class="form-row">
                  <button class="btn btn-primary" type="submit">Check policy</button>
                </div>
              </form>
              <div class="check-result" id="ask-result" hidden></div>
            </section>

            <details class="policy-advanced">
              <summary>Advanced policy JSON</summary>
              <p class="hint">Same document the CLIs and SDK write. Networks and mints live here.</p>
              <form id="json-form">
                <textarea class="policy-json" id="policy-json" spellcheck="false"></textarea>
                <div class="form-row">
                  <button class="btn btn-ghost" type="submit">Save policy JSON</button>
                </div>
              </form>
            </details>
          </section>
        </div>

        <footer class="foot">Reject is final. Preview never moves money. Local mock, Devnet, and Mainnet are labeled on the request. <a href="/openapi.json">Machine contract</a></footer>
      </div>
    </main>
  </div>

  <script>window.AGENTTAB = ${boot};</script>
  <script src="/ui/app.js"></script>
</body>
</html>`;
}

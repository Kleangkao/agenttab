import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pageHead, REPO_URL } from "./head.js";

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
${pageHead({
  title: "AgentTab operator console",
  description:
    "Approvals, audit trail, spend policy and the settled Solana Mainnet proof behind the AgentTab funding loop.",
  path: "/ui",
  stylesheet: "/ui/app.css"
})}
</head>
<body>
  <div class="shell">
    <aside class="rail">
      <a class="brand" href="/">
        <span class="brand-head">
          <span class="brand-mark" aria-hidden="true">AT</span>
          <span class="brand-name">AgentTab</span>
        </span>
        <span class="brand-copy" data-i18n="o.brand">Buy only the missing payment asset, then finish the original request</span>
      </a>

      <nav class="rail-nav rail-nav-links" aria-label="Surfaces">
        <a href="/" data-i18n="nav.product">Product</a>
        <a href="/demo" data-i18n="nav.demo">Interactive demo</a>
        <a href="/ui" aria-current="page" data-i18n="nav.console">Operator console</a>
        <button type="button" class="lang-toggle" id="lang-toggle">ไทย</button>
      </nav>

      <p class="surface-label" data-i18n="o.surface">Technical proof surface</p>
      <span class="mode-badge" id="mode-badge" aria-live="polite">…</span>
      <p class="mode-note" id="mode-note"></p>

      <nav class="rail-nav" aria-label="AgentTab">
        <button type="button" data-view="now"><span data-i18n="o.view.now">Now</span> <span class="count" id="parked-count"></span></button>
        <button type="button" data-view="ledger" data-i18n="o.view.ledger">Ledger</button>
        <button type="button" data-view="policy" data-i18n="o.view.policy">Policy</button>
      </nav>

      <div class="rail-blocks" id="judge-stats" hidden></div>

      <p class="stance" id="stance" data-i18n="o.stance.loading">Loading the live policy…</p>
      <a class="rail-repo" href="${REPO_URL}" target="_blank" rel="noopener" data-i18n="foot.src">Source on GitHub →</a>
    </aside>

    <main class="stage">
      <div class="stage-inner">
        <p class="notice" id="observe-banner"${observeHidden} data-i18n="o.observe">Monitor &amp; allow is not a dry-run. Matching payments can still fund and pay.</p>
        <p class="status" id="status" role="status"></p>

        <section class="unlock" id="unlock" hidden>
          <div class="unlock-card">
            <h1 data-i18n="o.unlock.title">Unlock AgentTab</h1>
            <p data-i18n="o.unlock.body">This gateway requires a token before you can see spend, policy, or pending payments. It stays in this browser tab.</p>
            <label class="field"><span data-i18n="o.unlock.label">Gateway token</span>
              <input id="token" type="password" autocomplete="off" placeholder="${tokenPlaceholder}" />
            </label>
            <button class="btn btn-primary" id="unlock-open" type="button" data-i18n="o.unlock.cta">Continue</button>
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
              <h2 data-i18n="o.policy.title">Payment policy</h2>
              <p data-i18n="o.policy.sub">Live rules for the next agent payment, not a copy of the file on disk.</p>
            </header>

            <div class="policy-section">
              <h3 data-i18n="o.policy.when">When should AgentTab pay?</h3>
              <div class="modes">
                <button type="button" class="mode-card" data-mode="observe" aria-pressed="false">
                  <strong data-i18n="o.mode.observe">Monitor &amp; allow</strong>
                  <span data-i18n="o.mode.observe.sub">This is not a dry-run. Rules are looser and matching payments can still spend.</span>
                </button>
                <button type="button" class="mode-card" data-mode="approve" aria-pressed="false">
                  <strong data-i18n="o.mode.approve">Ask me every time</strong>
                  <span data-i18n="o.mode.approve.sub">Every payment waits on Now until you approve or reject it.</span>
                </button>
                <button type="button" class="mode-card" data-mode="autopay" aria-pressed="false">
                  <strong data-i18n="o.mode.autopay">Auto-pay within limits</strong>
                  <span data-i18n="o.mode.autopay.sub">Allowed merchants pay up to your caps without stopping the agent.</span>
                </button>
              </div>
            </div>

            <div class="policy-section">
              <h3 data-i18n="o.policy.who">Who agents may pay</h3>
              <div class="merchants" id="allowed"></div>
              <form class="form-row" id="origin-form">
                <label class="field"><span data-i18n="o.field.origin">Merchant origin</span>
                  <input id="new-origin" placeholder="http://127.0.0.1:8791" />
                </label>
                <button class="btn btn-ghost" type="submit" data-i18n="o.policy.allow">Allow merchant</button>
              </form>
            </div>

            <div class="policy-section">
              <h3 data-i18n="o.policy.limits">Spend limits</h3>
              <form class="form-row" id="caps-form">
                <label class="field"><span data-i18n="o.field.maxpay">Max payment</span>
                  <span class="money-input"><input id="max-payment" inputmode="decimal" placeholder="5.00" /></span>
                </label>
                <label class="field"><span data-i18n="o.field.maxday">Max per day</span>
                  <span class="money-input"><input id="max-daily" inputmode="decimal" placeholder="20.00" /></span>
                </label>
                <label class="field"><span data-i18n="o.field.askabove">Ask me above</span>
                  <span class="money-input"><input id="approve-above" inputmode="decimal" placeholder="5.00" /></span>
                  <small class="field-note" id="approve-above-note"></small>
                </label>
                <button class="btn btn-primary" type="submit" data-i18n="o.policy.savelimits">Save limits</button>
              </form>
            </div>

            <section class="policy-section check">
              <h3 data-i18n="o.check.title">Test a payment against this policy</h3>
              <p class="hint" data-i18n="o.check.hint">Checks the live policy only. It never creates an execution, funds, pays, or fulfills.</p>
              <form id="ask-form">
                <div class="form-row">
                  <label class="field"><span data-i18n="o.field.origin">Merchant origin</span> <input id="ask-origin" value="http://127.0.0.1:8791" /></label>
                  <label class="field"><span data-i18n="o.field.wants">What the agent wants</span> <input id="ask-resource" value="http://127.0.0.1:8791/v1/market-snapshot" /></label>
                </div>
                <div class="form-row">
                  <label class="field"><span data-i18n="o.field.usd">Amount in USD</span> <input id="ask-usd" value="2.50" /></label>
                  <label class="field"><span data-i18n="o.field.network">Network</span>
                    <select id="ask-network">
                      <option value="solana:local" data-i18n="o.net.local">Local</option>
                      <option value="solana:devnet">Solana Devnet</option>
                      <option value="solana:mainnet">Solana Mainnet</option>
                    </select>
                  </label>
                </div>
                <div class="form-row">
                  <button class="btn btn-primary" type="submit" data-i18n="o.check.cta">Check policy</button>
                </div>
              </form>
              <div class="check-result" id="ask-result" hidden></div>
            </section>

            <details class="policy-advanced">
              <summary data-i18n="o.json.title">Advanced policy JSON</summary>
              <p class="hint" data-i18n="o.json.hint">Same document the CLIs and SDK write. Networks and mints live here, and amounts are stored as millionths of a dollar.</p>
              <form id="json-form">
                <textarea class="policy-json" id="policy-json" spellcheck="false"></textarea>
                <div class="form-row">
                  <button class="btn btn-ghost" type="submit" data-i18n="o.json.save">Save policy JSON</button>
                </div>
              </form>
            </details>
          </section>
        </div>

        <footer class="foot"><span data-i18n="o.foot">Reject is final. Preview never moves money.</span> <a href="/openapi.json" data-i18n="o.foot.contract">Machine contract</a></footer>
      </div>
    </main>
  </div>

  <script>window.AGENTTAB = ${boot};</script>
  <script src="/i18n.js"></script>
  <script src="/ui/app.js"></script>
</body>
</html>`;
}

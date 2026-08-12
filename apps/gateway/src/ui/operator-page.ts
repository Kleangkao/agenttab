export function operatorHtml(input: {
  adminRequired: boolean;
  agentRequired?: boolean;
  policyMode: string;
}): string {
  const observe =
    input.policyMode === "observe"
      ? `<p class="warn">Mode is <strong>observe</strong>. That is not a dry-run. Approving still funds.</p>`
      : "";
  const tokenRequired = input.adminRequired || input.agentRequired === true;
  const tokenHint = tokenRequired
    ? `<label>Gateway token <input id="token" type="password" autocomplete="off" placeholder="${
        input.adminRequired ? "AGENTTAB_ADMIN_TOKEN" : "AGENTTAB_AGENT_TOKEN"
      }" /></label>`
    : `<p class="muted">No admin or agent token configured — this process is open on the loopback trust model.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentTab operator</title>
  <style>
    :root { color-scheme: dark; --bg:#0f1216; --card:#1a1f27; --line:#2b3340; --fg:#e8edf4; --muted:#9aa6b8; --acc:#7cb7ff; --ok:#6ee7a8; --bad:#f0a0a0; --warn:#f5d48a; }
    body { margin:0; font:15px/1.45 ui-sans-serif,system-ui,sans-serif; background:var(--bg); color:var(--fg); }
    main { max-width:1080px; margin:0 auto; padding:24px 16px 48px; }
    h1 { font-size:1.25rem; margin:0 0 8px; }
    h2 { font-size:1rem; margin:28px 0 8px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
    .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
    label { display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--muted); flex:1; min-width:180px; }
    input, textarea, select { background:#0d1014; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:8px; font:13px/1.4 ui-monospace,monospace; }
    textarea { width:100%; min-height:220px; box-sizing:border-box; }
    button { background:var(--acc); color:#0b1220; border:0; border-radius:6px; padding:8px 12px; font-weight:600; cursor:pointer; }
    button.ghost { background:transparent; color:var(--acc); border:1px solid var(--acc); }
    .muted { color:var(--muted); }
    .ok { color:var(--ok); }
    .bad { color:var(--bad); }
    .warn { color:var(--warn); }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { text-align:left; padding:6px 4px; border-bottom:1px solid var(--line); vertical-align:top; }
    td.mono { font:12px/1.35 ui-monospace,monospace; word-break:break-all; }
    pre { white-space:pre-wrap; word-break:break-word; margin:8px 0 0; }
  </style>
</head>
<body>
<main>
  <h1>AgentTab operator</h1>
  <p class="muted">Read-only preview never funds. Approve still spends under the live policy. Parked list refreshes every 5s. <a href="/openapi.json" style="color:var(--acc)">OpenAPI</a></p>
  ${observe}
  <div class="card row" id="health">Loading health…</div>
  ${tokenHint}

  <h2>Live policy</h2>
  <div class="card">
    <div class="row" style="margin-bottom:10px">
      <label>Mode
        <select id="mode">
          <option value="observe">observe (still funds on approve)</option>
          <option value="approve">approve (park over threshold)</option>
          <option value="autopay">autopay (funds within caps)</option>
        </select>
      </label>
      <button id="setMode" type="button">Set mode</button>
      <span id="modeStatus" class="muted"></span>
    </div>
    <div class="row" style="margin-bottom:10px">
      <label>Max payment µUSD <input id="maxPayment" /></label>
      <label>Max daily µUSD <input id="maxDaily" /></label>
      <label>Approve above µUSD <input id="approveAbove" placeholder="empty = always park in approve" /></label>
      <button id="saveCaps" type="button">Save caps</button>
    </div>
    <textarea id="policy" spellcheck="false"></textarea>
    <div class="row" style="margin-top:10px">
      <label>Add merchant origin <input id="addOrigin" placeholder="http://127.0.0.1:8791" /></label>
      <button class="ghost" id="allowOrigin" type="button">Allow origin</button>
    </div>
    <div class="row" style="margin-top:10px">
      <button id="savePolicy" type="button">Save policy</button>
      <button class="ghost" id="reloadPolicy" type="button">Reload</button>
      <span id="policyStatus" class="muted"></span>
    </div>
  </div>

  <h2>Preview (does not fund)</h2>
  <div class="card">
    <div class="row">
      <label>Merchant origin <input id="merchant" value="http://127.0.0.1:8791" /></label>
      <label>Amount USD micros <input id="usd" value="1000" /></label>
      <label>Amount atomic <input id="atomic" value="1000" /></label>
    </div>
    <div class="row">
      <label>Resource <input id="resource" value="http://127.0.0.1:8791/v1/market-snapshot" /></label>
      <label>Network <input id="network" value="solana:local" /></label>
    </div>
    <div class="row" style="margin-top:10px">
      <button id="preview" type="button">Preview policy</button>
      <span id="previewStatus" class="muted"></span>
    </div>
    <pre id="previewOut"></pre>
  </div>

  <h2>Parked approvals</h2>
  <div class="card">
    <div class="row">
      <button class="ghost" id="refreshExec" type="button">Refresh</button>
      <span id="execStatus" class="muted"></span>
    </div>
    <table>
      <thead><tr><th>merchant</th><th>µUSD</th><th>resource</th><th>id</th><th></th></tr></thead>
      <tbody id="parked"></tbody>
    </table>
  </div>

  <h2>Recent executions</h2>
  <div class="card">
    <table>
      <thead><tr><th>state</th><th>last</th><th>merchant</th><th>µUSD</th><th>resource</th><th>id</th></tr></thead>
      <tbody id="recent"></tbody>
    </table>
  </div>
</main>
<script>
const adminRequired = ${input.adminRequired ? "true" : "false"};
const $ = (id) => document.getElementById(id);
function headers(json) {
  const h = {};
  if (json) h["content-type"] = "application/json";
  const token = $("token")?.value?.trim();
  if (token) {
    try { sessionStorage.setItem("agenttab.admin", token); } catch {}
    h.authorization = "Bearer " + token;
  }
  return h;
}
(function restoreToken() {
  const el = $("token");
  if (!el) return;
  try {
    const saved = sessionStorage.getItem("agenttab.admin");
    if (saved) el.value = saved;
  } catch {}
})();
function usd(ex) {
  return ex.amountUsdMicros || ex.amountAtomic || "";
}
function pathOf(resource) {
  try { return new URL(resource).pathname + new URL(resource).search; }
  catch { return resource || ""; }
}
async function health() {
  const r = await fetch("/health");
  const b = await r.json();
  $("health").innerHTML =
    "<span>mode <strong>" + b.policyMode + "</strong></span>" +
    "<span>funding <strong>" + b.fundingMode + "</strong></span>" +
    "<span>broadcast <strong>" + (b.broadcastEnabled ? "on" : "off") + "</strong></span>" +
    "<span>policy " + (b.policyDurable ? "durable" : "memory") + "</span>" +
    (b.policyWriteAuth ? "<span>admin token required</span>" : "") +
    (b.agentAuth ? "<span>agent token required</span>" : "") +
    (b.notifyConfigured ? "<span>notify " + (b.notifySigned ? "signed" : "on") + "</span>" : "") +
    "<span>parked <strong>" + (b.parkedCount ?? 0) + "</strong></span>" +
    "<span>spend 24h <strong>" + (b.spentUsdMicrosLast24h ?? "0") + "</strong> / " +
    (b.maxDailyUsdMicros ?? "?") + " µUSD</span>";
  try {
    const bal = await (await fetch("/v1/balances", { headers: headers() })).json();
    const usdc = (bal.balances || []).find((x) => x.symbol === "USDC");
    if (usdc && usdc.balanceAtomic !== undefined) {
      $("health").innerHTML += "<span>USDC <strong>" + usdc.balanceAtomic + "</strong></span>";
    }
  } catch { /* optional */ }
  if (b.policyMode === "observe" && !document.querySelector(".warn")) {
    const p = document.createElement("p");
    p.className = "warn";
    p.textContent = "Mode is observe. That is not a dry-run. Approving still funds.";
    $("health").after(p);
  }
}
function fillCaps(policy) {
  $("maxPayment").value = policy.maxPaymentUsdMicros ?? "";
  $("maxDaily").value = policy.maxDailyUsdMicros ?? "";
  $("approveAbove").value = policy.requireApprovalAboveUsdMicros ?? "";
}
async function loadPolicy() {
  const r = await fetch("/v1/policy", { headers: headers() });
  if (!r.ok) {
    $("policyStatus").className = "bad";
    $("policyStatus").textContent = r.status === 401 ? "admin token required" : String(r.status);
    return;
  }
  const policy = await r.json();
  $("policy").value = JSON.stringify(policy, null, 2);
  if (policy.mode) $("mode").value = policy.mode;
  fillCaps(policy);
}
$("reloadPolicy").onclick = () => loadPolicy();
$("saveCaps").onclick = async () => {
  let policy;
  try { policy = JSON.parse($("policy").value); }
  catch (e) { $("policyStatus").className = "bad"; $("policyStatus").textContent = "invalid JSON"; return; }
  policy.maxPaymentUsdMicros = $("maxPayment").value.trim();
  policy.maxDailyUsdMicros = $("maxDaily").value.trim();
  const above = $("approveAbove").value.trim();
  if (above) policy.requireApprovalAboveUsdMicros = above;
  else delete policy.requireApprovalAboveUsdMicros;
  $("policy").value = JSON.stringify(policy, null, 2);
  $("savePolicy").click();
};
$("setMode").onclick = async () => {
  let policy;
  try { policy = JSON.parse($("policy").value); }
  catch (e) { $("modeStatus").className = "bad"; $("modeStatus").textContent = "invalid JSON"; return; }
  policy.mode = $("mode").value;
  $("policy").value = JSON.stringify(policy, null, 2);
  $("modeStatus").textContent = "saving…";
  $("savePolicy").click();
};
$("allowOrigin").onclick = async () => {
  let origin = $("addOrigin").value.trim();
  if (!origin) { $("policyStatus").className = "bad"; $("policyStatus").textContent = "origin required"; return; }
  try { origin = new URL(origin).origin; $("addOrigin").value = origin; }
  catch (e) { $("policyStatus").className = "bad"; $("policyStatus").textContent = "invalid origin"; return; }
  let policy;
  try { policy = JSON.parse($("policy").value); }
  catch (e) { $("policyStatus").className = "bad"; $("policyStatus").textContent = "invalid JSON"; return; }
  const list = Array.isArray(policy.allowedMerchantOrigins) ? policy.allowedMerchantOrigins : [];
  if (!list.includes(origin)) list.push(origin);
  policy.allowedMerchantOrigins = list;
  $("policy").value = JSON.stringify(policy, null, 2);
  $("savePolicy").click();
};
$("savePolicy").onclick = async () => {
  $("policyStatus").textContent = "saving…";
  let body;
  try { body = JSON.parse($("policy").value); }
  catch (e) { $("policyStatus").className = "bad"; $("policyStatus").textContent = "invalid JSON"; return; }
  const r = await fetch("/v1/policy", { method: "PUT", headers: headers(true), body: JSON.stringify(body) });
  const b = await r.json();
  $("policyStatus").className = r.ok ? "ok" : "bad";
  $("policyStatus").textContent = r.ok ? "saved " + b.mode : (b.error || r.status);
  $("modeStatus").className = $("policyStatus").className;
  $("modeStatus").textContent = r.ok ? "mode " + b.mode : ($("policyStatus").textContent);
  if (r.ok) { $("policy").value = JSON.stringify(b, null, 2); if (b.mode) $("mode").value = b.mode; fillCaps(b); health(); }
};
$("preview").onclick = async () => {
  const intent = {
    operationId: "preview-" + Date.now(),
    requestHash: "sha256:previewpreviewpreviewpreviewpreviewpreviewpreviewpreview",
    protocol: "x402",
    network: $("network").value.trim(),
    merchantId: new URL($("merchant").value.trim()).host,
    merchantOrigin: $("merchant").value.trim(),
    destination: "PreviewDestination1111111111111111111111111",
    assetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amountAtomic: $("atomic").value.trim(),
    amountUsdMicros: $("usd").value.trim(),
    resource: $("resource").value.trim()
  };
  const r = await fetch("/v1/preview", { method: "POST", headers: headers(true), body: JSON.stringify(intent) });
  const b = await r.json();
  $("previewStatus").className = r.ok ? "ok" : "bad";
  $("previewStatus").textContent = r.ok ? (b.decision?.kind + " / " + b.decision?.reason) : (b.error || r.status);
  $("previewOut").textContent = JSON.stringify(b, null, 2);
};
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
async function loadRecent() {
  const r = await fetch("/v1/executions?limit=20", { headers: headers() });
  if (!r.ok) {
    $("recent").innerHTML = "<tr><td colspan=\\"6\\" class=\\"bad\\">" +
      (r.status === 401 ? "admin token required" : r.status) + "</td></tr>";
    return;
  }
  const b = await r.json();
  const rows = (b.executions || []).map((ex) =>
    "<tr><td>" + esc(ex.state) + "</td><td class=\\"muted\\">" + esc(ex.lastEventKind) +
    "</td><td class=\\"mono\\">" + esc(ex.merchantOrigin) +
    "</td><td>" + esc(usd(ex)) + "</td><td class=\\"mono\\">" + esc(pathOf(ex.resource)) +
    "</td><td class=\\"mono\\" title=\\"" + esc(ex.requestHash) + "\\">" +
    esc(ex.operationId) + "</td></tr>"
  ).join("");
  $("recent").innerHTML = rows || "<tr><td colspan=\\"6\\" class=\\"muted\\">None yet</td></tr>";
}
async function loadParked() {
  const r = await fetch("/v1/executions?state=approval_required&limit=20", { headers: headers() });
  if (!r.ok) {
    $("execStatus").className = "bad";
    $("execStatus").textContent = r.status === 401 ? "admin token required" : String(r.status);
    $("parked").innerHTML = "<tr><td colspan=\\"5\\" class=\\"bad\\">" +
      (r.status === 401 ? "admin token required" : r.status) + "</td></tr>";
    return;
  }
  const b = await r.json();
  const rows = (b.executions || []).map((ex) => {
    const id = esc(ex.operationId);
    return "<tr><td class=\\"mono\\">" + esc(ex.merchantOrigin) + "</td><td>" + esc(usd(ex)) +
      "</td><td class=\\"mono\\">" + esc(pathOf(ex.resource)) +
      "</td><td class=\\"mono\\" title=\\"" + esc(ex.requestHash) + "\\">" + id + "</td><td>" +
      "<button data-act=\\"approve\\" data-id=\\"" + id + "\\" type=\\"button\\">Approve</button> " +
      "<button class=\\"ghost\\" data-act=\\"deny\\" data-id=\\"" + id + "\\" type=\\"button\\">Deny</button></td></tr>";
  }).join("");
  $("parked").innerHTML = rows || "<tr><td colspan=\\"5\\" class=\\"muted\\">None parked</td></tr>";
  $("parked").querySelectorAll("button").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      const path = act === "deny" ? "/v1/denials/" : "/v1/approvals/";
      $("execStatus").textContent = act + " " + id + "…";
      const r = await fetch(path + encodeURIComponent(id), { method: "POST", headers: headers(true), body: "{}" });
      const body = await r.json();
      $("execStatus").className = r.ok ? (act === "deny" ? "warn" : "ok") : "bad";
      $("execStatus").textContent = r.ok
        ? (act === "deny" ? "denied" : ("funded " + (body.record?.state || "")))
        : (body.error || r.status);
      loadParked();
      health();
    };
  });
  loadRecent();
}
$("refreshExec").onclick = () => { loadParked(); health(); };
if ($("token")) {
  $("token").onchange = () => { loadPolicy(); loadParked(); health(); };
}
health().then(loadPolicy).then(loadParked).catch((e) => { $("health").textContent = String(e); });
setInterval(() => { loadParked(); health(); }, 5000);
</script>
</body>
</html>`;
}

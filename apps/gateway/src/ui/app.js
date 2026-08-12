(() => {
  const boot = window.AGENTTAB || {
    adminRequired: false,
    agentRequired: false,
    policyMode: "observe",
  };

  const $ = (id) => document.getElementById(id);
  const tokenInput = $("token");
  const statusEl = $("status");
  const parkedCountEl = $("parked-count");
  const panels = {
    inbox: $("panel-inbox"),
    activity: $("panel-activity"),
    rules: $("panel-rules"),
    ask: $("panel-ask"),
  };

  const state = {
    view: "inbox",
    health: null,
    policy: null,
    parked: [],
    recent: [],
    spend: null,
    balances: [],
    detail: {},
    confirm: null,
  };

  function bearerHeaders() {
    const token = tokenInput.value.trim();
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  function needsToken() {
    return boot.adminRequired || boot.agentRequired;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function money(raw) {
    if (raw == null || raw === "") return "—";
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(raw);
    const dollars = n / 1_000_000;
    if (n === 0) return "$0.00";
    if (Math.abs(dollars) >= 1) {
      return dollars.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return `$${dollars.toFixed(4)}`;
  }

  function tokenAmount(row) {
    const atomic = Number(row.balanceAtomic);
    if (!Number.isFinite(atomic)) return String(row.balanceAtomic ?? "—");
    const decimals = row.symbol === "SOL" ? 9 : 6;
    const ui = atomic / 10 ** decimals;
    if (row.symbol === "USDC" || row.symbol === "SOL") {
      return `${ui.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${row.symbol}`;
    }
    return `${row.balanceAtomic} ${row.symbol || ""}`.trim();
  }

  function originHost(origin) {
    try {
      return new URL(origin).host;
    } catch {
      return origin || "unknown merchant";
    }
  }

  function when(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso || "" : date.toLocaleString();
  }

  function pathOf(resource) {
    try {
      const url = new URL(resource);
      return url.pathname + url.search;
    } catch {
      return resource || "";
    }
  }

  function setStatus(kind, text) {
    statusEl.className = `status ${kind || ""}`;
    statusEl.textContent = text || "";
  }

  function persistToken() {
    sessionStorage.setItem("agenttab.admin", tokenInput.value);
  }

  async function readJson(res) {
    return res.json().catch(() => ({}));
  }

  async function api(path, init = {}) {
    const headers = { ...bearerHeaders(), ...(init.headers || {}) };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(path, { ...init, headers });
    const body = await readJson(res);
    if (res.status === 401) {
      showUnlock(true);
      throw new Error(
        boot.adminRequired ? "admin token required" : "gateway token required",
      );
    }
    if (!res.ok) {
      throw new Error(body.error || body.message || `${res.status} ${path}`);
    }
    return body;
  }

  function showUnlock(show) {
    $("unlock").hidden = !show;
    $("unlock").setAttribute("aria-hidden", show ? "false" : "true");
    $("workspace").hidden = show;
    $("workspace").setAttribute("aria-hidden", show ? "true" : "false");
    $("confirm").setAttribute("aria-hidden", $("confirm").hidden ? "true" : "false");
  }

  function setView(view) {
    state.view = view;
    for (const [name, panel] of Object.entries(panels)) {
      const hide = name !== view;
      panel.hidden = hide;
      panel.setAttribute("aria-hidden", hide ? "true" : "false");
    }
    for (const button of document.querySelectorAll("[data-view]")) {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (location.hash.replace("#", "") !== view) {
      location.hash = view;
    }
  }

  function renderPosture() {
    const health = state.health || {};
    const spend = state.spend || {};
    const used = Number(spend.spentUsdMicrosLast24h ?? health.spentUsdMicrosLast24h ?? 0);
    const daily = Number(spend.maxDailyUsdMicros ?? health.maxDailyUsdMicros ?? 0);
    const pct = daily > 0 ? Math.min(100, Math.round((used / daily) * 100)) : 0;
    $("spend-used").textContent = money(used);
    $("spend-copy").textContent = daily
      ? `${money(daily)} daily ceiling · ${money(Math.max(0, daily - used))} left`
      : "No daily ceiling on file";
    $("spend-bar").style.width = `${pct}%`;

    const usdc = state.balances.find((row) => row.symbol === "USDC") || state.balances[0];
    $("wallet-value").textContent = usdc ? tokenAmount(usdc) : "—";
    $("wallet-copy").textContent = usdc?.mint
      ? `${usdc.verified ? "verified" : "unverified"} · ${usdc.mint.slice(0, 4)}…${usdc.mint.slice(-4)}`
      : "Buyer wallet the coordinator can fund from";

    const mode = state.policy?.mode || health.policyMode || boot.policyMode;
    $("mode-value").textContent =
      mode === "autopay" ? "Within limits" : mode === "approve" ? "Ask me" : "Watch";
    $("mode-copy").textContent =
      mode === "autopay"
        ? "Matching intents pay without asking you"
        : mode === "approve"
          ? "Agents wait here when a payment needs a person"
          : "Observe is not a dry-run. Matching payments can still spend.";
    $("observe-banner").hidden = mode !== "observe";
    parkedCountEl.textContent = String(state.parked.length || health.parkedCount || 0);

    const flags = [];
    if (health.policyWriteAuth) flags.push("console locked");
    if (health.agentAuth) flags.push("agent token required");
    if (health.notifyConfigured) flags.push(health.notifySigned ? "signed alerts" : "alerts on");
    flags.push(health.broadcastEnabled ? "Mainnet broadcast on" : "not broadcasting");
    $("flags").textContent = flags.join(" · ");
  }

  function renderInbox() {
    const root = $("inbox-list");
    if (!state.parked.length) {
      root.innerHTML = `
        <div class="empty">
          <h2>Nothing waiting on you</h2>
          <p>When an agent needs a payment you have not pre-allowed, it parks here as a card: who wants money, how much, and whether to release or reject it.</p>
        </div>`;
      return;
    }
    root.innerHTML = state.parked
      .map((row) => {
        const amount = money(row.amountUsdMicros || row.amountAtomic);
        const who = originHost(row.merchantOrigin);
        return `
          <article class="decision" data-id="${esc(row.operationId)}">
            <div>
              <p class="amount">${esc(amount)}</p>
              <p class="who">${esc(who)} is asking to be paid</p>
              <p class="meta">${esc(pathOf(row.resource))} · ${esc(row.network)} · ${esc(row.lastEventKind || row.state)}</p>
              <p class="id">${esc(row.operationId)}</p>
            </div>
            <div class="actions">
              <button class="btn primary" data-act="approve" type="button">Release</button>
              <button class="btn danger" data-act="deny" type="button">Reject</button>
            </div>
          </article>`;
      })
      .join("");
  }

  function renderActivity() {
    const root = $("activity-list");
    if (!state.recent.length) {
      root.innerHTML = `
        <div class="empty">
          <h2>No receipts yet</h2>
          <p>Parks, releases, rejections, and fulfilled pays land here so you can see what agents did with money.</p>
        </div>`;
      return;
    }
    root.innerHTML = state.recent
      .map((row) => {
        const open = state.detail[row.operationId];
        const events = (open?.events || [])
          .map((event) => `<div>${esc(when(event.at))} · ${esc(event.kind)}${event.to ? ` → ${esc(event.to)}` : ""}</div>`)
          .join("");
        return `
          <article class="receipt" data-id="${esc(row.operationId)}">
            <div class="state">${esc(row.state)}</div>
            <div>
              <div>${esc(originHost(row.merchantOrigin))}</div>
              <div class="sub">${esc(pathOf(row.resource) || row.requestHash || "")}</div>
            </div>
            <div class="amount">${esc(money(row.amountUsdMicros || row.amountAtomic))}</div>
            ${open ? `<div class="timeline">${events || "No events on this receipt."}</div>` : ""}
          </article>`;
      })
      .join("");
  }

  function renderRules() {
    const policy = state.policy;
    if (!policy) return;
    for (const button of document.querySelectorAll("[data-mode]")) {
      button.setAttribute("aria-pressed", button.dataset.mode === policy.mode ? "true" : "false");
    }
    const origins = policy.allowedMerchantOrigins || [];
    $("allowed").innerHTML = origins.length
      ? origins
          .map(
            (origin) =>
              `<span class="chip">${esc(origin)}<button type="button" data-remove-origin="${esc(origin)}" aria-label="Remove ${esc(origin)}">×</button></span>`,
          )
          .join("")
      : `<span class="help">No merchants yet. Add an origin agents are allowed to pay.</span>`;
    $("max-payment").value = policy.maxPaymentUsdMicros || "";
    $("max-daily").value = policy.maxDailyUsdMicros || "";
    $("approve-above").value = policy.requireApprovalAboveUsdMicros || "";
    $("policy-json").value = JSON.stringify(policy, null, 2);
  }

  function render() {
    const tokenField = tokenInput.closest("label");
    if (tokenField) tokenField.hidden = !needsToken();
    $("auth-note").textContent = needsToken()
      ? boot.adminRequired
        ? "Operator reads and writes need the admin token."
        : "Spend paths need the agent token. Admin also works here."
      : "This gateway is open for local demo. Tokens stay optional.";
    renderPosture();
    renderInbox();
    renderActivity();
    renderRules();
  }

  async function refresh() {
    try {
      const healthRes = await fetch("/health");
      state.health = await readJson(healthRes);
      const [policy, parked, recent, spend, balances] = await Promise.all([
        api("/v1/policy"),
        api("/v1/executions?state=approval_required&limit=20"),
        api("/v1/executions?limit=20"),
        api("/v1/spend"),
        api("/v1/balances"),
      ]);
      showUnlock(false);
      state.policy = policy;
      state.parked = parked.executions || [];
      state.recent = recent.executions || [];
      state.spend = spend;
      state.balances = balances.balances || [];
      render();
      setStatus("", "");
    } catch (error) {
      renderPosture();
      if (needsToken() && /token|401|unauthorized/i.test(String(error.message))) {
        showUnlock(true);
      }
      setStatus("bad", error.message);
    }
  }

  async function savePolicy(next, done) {
    const body = await api("/v1/policy", { method: "PUT", body: JSON.stringify(next) });
    state.policy = body;
    renderRules();
    renderPosture();
    setStatus("ok", done);
    return body;
  }

  async function setMode(mode) {
    if (!state.policy) return;
    if (mode === "observe") {
      const ok = window.confirm(
        "Observe is not a dry-run. Matching payments can still fund and pay on Mainnet.",
      );
      if (!ok) return;
    }
    await savePolicy({ ...state.policy, mode }, `Mode is now ${mode}.`);
  }

  async function addOrigin(event) {
    event.preventDefault();
    if (!state.policy) return;
    const raw = $("new-origin").value.trim();
    if (!raw) return;
    let origin;
    try {
      origin = new URL(raw.includes("://") ? raw : `http://${raw}`).origin;
    } catch {
      setStatus("bad", "That is not a usable origin.");
      return;
    }
    const next = new Set(state.policy.allowedMerchantOrigins || []);
    next.add(origin);
    await savePolicy(
      { ...state.policy, allowedMerchantOrigins: [...next] },
      `${origin} can be paid.`,
    );
    $("new-origin").value = "";
  }

  async function removeOrigin(origin) {
    if (!state.policy) return;
    const next = (state.policy.allowedMerchantOrigins || []).filter((item) => item !== origin);
    if (next.length === 0) {
      setStatus("bad", "Keep at least one merchant. The live policy will not save an empty list.");
      return;
    }
    await savePolicy(
      { ...state.policy, allowedMerchantOrigins: next },
      `${origin} removed.`,
    );
  }

  async function saveCaps(event) {
    event.preventDefault();
    if (!state.policy) return;
    const maxPaymentUsdMicros = $("max-payment").value.trim();
    const maxDailyUsdMicros = $("max-daily").value.trim();
    const above = $("approve-above").value.trim();
    const next = { ...state.policy, maxPaymentUsdMicros, maxDailyUsdMicros };
    if (above) next.requireApprovalAboveUsdMicros = above;
    else delete next.requireApprovalAboveUsdMicros;
    await savePolicy(next, "Limits saved. Amounts are µUSD (millionths of a dollar).");
  }

  async function saveJson(event) {
    event.preventDefault();
    try {
      const next = JSON.parse($("policy-json").value);
      await savePolicy(next, "Policy JSON saved.");
    } catch (error) {
      setStatus("bad", error.message);
    }
  }

  function askConfirm(row) {
    state.confirm = row;
    $("confirm-copy").textContent =
      `Release ${money(row.amountUsdMicros || row.amountAtomic)} to ${originHost(row.merchantOrigin)}? This uses the live coordinator. Observe is not a dry-run.`;
    $("confirm").hidden = false;
    $("confirm").setAttribute("aria-hidden", "false");
  }

  async function approve(id) {
    const body = await api(`/v1/approvals/${encodeURIComponent(id)}`, {
      method: "POST",
      body: "{}",
    });
    $("confirm").hidden = true;
    $("confirm").setAttribute("aria-hidden", "true");
    state.confirm = null;
    await refresh();
    setStatus("ok", `Released · ${body.record?.state || "funded"}`);
  }

  async function deny(id) {
    await api(`/v1/denials/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ reason: "operator_denied" }),
    });
    await refresh();
    setStatus("ok", "Rejected. That id cannot be reused.");
  }

  async function ask(event) {
    event.preventDefault();
    const result = $("ask-result");
    try {
      const merchantOrigin = $("ask-origin").value.trim();
      const resource = $("ask-resource").value.trim();
      const amountUsdMicros = $("ask-usd").value.trim();
      const body = await api("/v1/preview", {
        method: "POST",
        body: JSON.stringify({
          operationId: `preview-${Date.now()}`,
          requestHash: "sha256:previewpreviewpreviewpreviewpreviewpreviewpreviewpreview",
          protocol: "x402",
          network: $("ask-network").value.trim(),
          merchantId: new URL(merchantOrigin).host,
          merchantOrigin,
          destination: "PreviewDestination1111111111111111111111111",
          assetMint: $("ask-mint").value.trim(),
          amountAtomic: $("ask-atomic").value.trim(),
          ...(amountUsdMicros ? { amountUsdMicros } : {}),
          resource,
        }),
      });
      const kind = body.decision?.kind;
      const title =
        kind === "allow"
          ? "This would be allowed"
          : kind === "approval_required"
            ? "This would wait for you"
            : "This would be denied";
      const detail =
        kind === "allow"
          ? `${body.decision?.message || ""} If an agent requested this now, funding could proceed. This Ask did not move money.`
          : kind === "approval_required"
            ? `${body.decision?.message || ""} It would appear under Needs you. Releasing it later still spends. This Ask did not.`
            : body.decision?.message || body.hint || "";
      result.hidden = false;
      result.innerHTML = `<h3>${esc(title)}</h3><p>${esc(detail)}</p>`;
    } catch (error) {
      result.hidden = false;
      result.innerHTML = `<h3>Could not ask</h3><p>${esc(error.message)}</p>`;
    }
  }

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  $("unlock-open").addEventListener("click", () => {
    persistToken();
    refresh();
  });
  tokenInput.addEventListener("change", () => {
    persistToken();
    refresh();
  });

  $("inbox-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const card = button.closest("[data-id]");
    const row = state.parked.find((item) => item.operationId === card.dataset.id);
    if (!row) return;
    if (button.dataset.act === "approve") askConfirm(row);
    if (button.dataset.act === "deny") deny(row.operationId);
  });

  $("activity-list").addEventListener("click", async (event) => {
    const card = event.target.closest("[data-id]");
    if (!card) return;
    const id = card.dataset.id;
    if (state.detail[id]) {
      delete state.detail[id];
      renderActivity();
      return;
    }
    try {
      state.detail[id] = await api(`/v1/executions/${encodeURIComponent(id)}`);
      renderActivity();
    } catch (error) {
      setStatus("bad", error.message);
    }
  });

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  $("origin-form").addEventListener("submit", addOrigin);
  $("allowed").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-origin]");
    if (button) removeOrigin(button.dataset.removeOrigin);
  });
  $("caps-form").addEventListener("submit", saveCaps);
  $("json-form").addEventListener("submit", saveJson);
  $("ask-form").addEventListener("submit", ask);
  $("confirm-cancel").addEventListener("click", () => {
    $("confirm").hidden = true;
    $("confirm").setAttribute("aria-hidden", "true");
    state.confirm = null;
  });
  $("confirm-ok").addEventListener("click", () => {
    if (state.confirm) approve(state.confirm.operationId);
  });

  tokenInput.value = sessionStorage.getItem("agenttab.admin") || "";
  const hash = location.hash.replace("#", "");
  setView(panels[hash] ? hash : "inbox");
  showUnlock(needsToken() && !tokenInput.value);
  refresh();
  setInterval(refresh, 5000);
})();

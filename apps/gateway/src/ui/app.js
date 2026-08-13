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
    now: $("panel-now"),
    ledger: $("panel-ledger"),
    policy: $("panel-policy"),
  };
  const aliases = { inbox: "now", activity: "ledger", rules: "policy", ask: "policy" };

  const state = {
    view: "now",
    health: null,
    policy: null,
    parked: [],
    nowItems: [],
    recent: [],
    spend: null,
    balances: [],
    detail: {},
    pending: null,
  };

  const STATES = {
    discovered: "Seen",
    approval_required: "Waiting for you",
    approved: "Approved",
    funding_submitted: "Funding",
    funded: "Ready to pay",
    payment_submitted: "Paying",
    paid: "Paid",
    fulfilled: "Done",
    fulfillment_failed: "Fulfillment failed",
    denied: "Rejected",
    failed: "Failed",
  };

  const EVENTS = {
    "payment.discovered": "Agent presented a payment",
    "policy.approval_required": "AgentTab paused it for you",
    "approval.granted": "You approved",
    "approval.denied": "You rejected",
    "funding.submitted": "Buying the payment asset",
    "funding.attempt_locked": "Funding attempt locked",
    "funding.plan_receipt": "Funding plan received",
    "funding.signer_failed": "Funding paused; same payment can retry",
    "funding.confirm_interrupted": "Funding needs confirmation; same payment can retry",
    "funding.balances_applied": "Wallet balances updated",
    "funding.confirmed": "Wallet holds enough to pay",
    "funding.not_required": "Wallet already held the payment asset",
    "payment.submitted": "Paying the merchant",
    "payment.settled": "Merchant was paid",
    "payment.token_issued": "Local payment token issued",
    "payment.attempt_failed": "Payment attempt failed; same payment can retry",
    "resource.fulfilled": "Agent received the resource",
    "resource.fulfillment_failed": "Paid, but the resource was not delivered",
  };

  const REASONS = {
    approval_threshold_exceeded: "Policy is set to ask you before this payment.",
    merchant_not_allowed: "This merchant is not on the allow list.",
    merchant_denied: "This merchant is explicitly denied.",
    network_not_allowed: "This network is not allowed.",
    payment_asset_not_allowed: "This payment asset is not allowed.",
    funding_asset_not_allowed: "The funding asset is not allowed.",
    unverified_funding_asset: "The funding asset is not verified.",
    usd_value_unknown: "AgentTab does not have a USD value for this payment.",
    per_payment_limit_exceeded: "This amount is over the per-payment limit.",
    daily_limit_exceeded: "This would exceed today's spend limit.",
    challenge_expired: "The payment challenge has expired.",
    invalid_intent: "The payment intent is not valid.",
    allowed: "The live policy would allow this.",
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
    if (Math.abs(dollars) >= 0.01) {
      return dollars.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return `$${dollars.toFixed(4)}`;
  }

  function dollarsInput(raw) {
    if (!raw) return "";
    const n = Number(raw) / 1_000_000;
    if (!Number.isFinite(n)) return "";
    return n >= 0.01 ? n.toFixed(2) : String(n);
  }

  function toMicros(raw) {
    const n = Number(String(raw).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) throw new Error("Enter an amount in dollars.");
    return String(Math.round(n * 1_000_000));
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

  function networkLabel(network) {
    if (network === "solana:local") return "Local (no chain)";
    if (network === "solana:devnet") return "Solana Devnet";
    if (network === "solana:mainnet") return "Solana Mainnet";
    return network || "Unknown network";
  }

  function assetLabel(mint) {
    if (mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") return "USDC";
    if (mint === "So11111111111111111111111111111111111111112") return "SOL";
    return mint ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : "payment asset";
  }

  function modeLabel(mode) {
    if (mode === "autopay") return "Pay within limits";
    if (mode === "approve") return "Ask you first";
    return "Watch";
  }

  function reasonText(code, fallback) {
    return REASONS[code] || fallback || "AgentTab stopped this payment for review.";
  }

  function eventText(kind) {
    return EVENTS[kind] || kind;
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
    $("unlock").inert = !show;
    $("unlock").setAttribute("aria-hidden", show ? "false" : "true");
    $("workspace").hidden = show;
    $("workspace").inert = show;
    $("workspace").setAttribute("aria-hidden", show ? "true" : "false");
  }

  function setView(view) {
    const next = aliases[view] || view;
    if (!panels[next]) return;
    state.view = next;
    for (const [name, panel] of Object.entries(panels)) {
      const hide = name !== next;
      panel.hidden = hide;
      panel.inert = hide;
      panel.setAttribute("aria-hidden", hide ? "true" : "false");
    }
    for (const button of document.querySelectorAll("[data-view]")) {
      if (button.dataset.view === next) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (location.hash.replace("#", "") !== next) location.hash = next;
  }

  function fundingCopy(row, record) {
    const amount = Number(record?.intent?.amountAtomic || row.amountAtomic || 0);
    const usdc = state.balances.find((item) => item.symbol === "USDC");
    const have = usdc ? Number(usdc.balanceAtomic) : NaN;
    const mode = state.health?.fundingMode;
    const source =
      mode === "mock"
        ? "this local mock"
        : mode === "live-sim"
          ? "a simulated live quote"
          : mode === "live-quote"
            ? "a live quote"
            : "the funding coordinator";
    if (Number.isFinite(have) && have >= amount && amount > 0) {
      return `Wallet already holds enough ${assetLabel(row.assetMint)}. Approving should not need a swap.`;
    }
    if (Number.isFinite(have) && amount > have) {
      return `Wallet is short ${assetLabel(row.assetMint)}. Approving may buy only the missing amount via ${source}.`;
    }
    return `Approving uses ${source} to make sure the payment asset is in the wallet, then pays.`;
  }

  function parkedReason(row, record) {
    const events = record?.events || [];
    const last = [...events].reverse().find((event) => event.kind === "policy.approval_required") || events.at(-1);
    const code = last?.details?.reason;
    return reasonText(code, last ? eventText(last.kind) : row.lastEventKind);
  }

  function renderStance() {
    const health = state.health || {};
    const spend = state.spend || {};
    const used = money(spend.spentUsdMicrosLast24h ?? health.spentUsdMicrosLast24h ?? 0);
    const daily = money(spend.maxDailyUsdMicros ?? health.maxDailyUsdMicros ?? 0);
    const usdc = state.balances.find((row) => row.symbol === "USDC");
    const ready = usdc ? tokenAmount(usdc) : "wallet unknown";
    const mode = modeLabel(state.policy?.mode || health.policyMode || boot.policyMode);
    const rail = health.broadcastEnabled ? "Mainnet broadcast on" : "not broadcasting";
    const fund =
      health.fundingMode === "mock"
        ? "local mock"
        : health.fundingMode === "live-sim"
          ? "live sim"
          : health.fundingMode || "gateway";
    const notifySigned = health.notifySigned;
    const alerts = health.notifyConfigured
      ? notifySigned
        ? " · signed alerts"
        : " · alerts on"
      : "";
    $("stance").innerHTML = `Spent <strong>${esc(used)}</strong> of <strong>${esc(daily)}</strong> today · ${esc(ready)} ready · <strong>${esc(mode)}</strong> · ${esc(fund)}, ${esc(rail)}${esc(alerts)}`;
    $("observe-banner").hidden = (state.policy?.mode || health.policyMode) !== "observe";
    const waiting =
      state.nowItems.length || health.openLoopCount || health.parkedCount || 0;
    parkedCountEl.textContent = waiting ? String(waiting) : "";
  }

  function openLoopCopy(row, record) {
    if (row.state === "funding_submitted") {
      return "Funding paused after a plan or sign interrupt. Resume uses the same payment id and does not open a second swap.";
    }
    if (row.state === "funded") {
      return "The wallet holds the payment asset. Resume records pay for this same id.";
    }
    if (row.state === "payment_submitted") {
      return "Payment was submitted but not settled. Resume confirms the same payment; it will not mint a new one.";
    }
    if (row.state === "paid") {
      return "The merchant was paid. Resume marks the original resource as delivered.";
    }
    if (row.state === "fulfillment_failed") {
      return "Paid, but the resource was not marked delivered. Resume retries fulfill only.";
    }
    if (row.state === "approved") {
      return "Approved, but funding has not finished. Resume continues this same payment.";
    }
    return parkedReason(row, record);
  }

  function renderNow() {
    const root = $("decision-list");
    if (!state.nowItems.length) {
      root.innerHTML = `
        <div class="empty">
          <h2>No open payments</h2>
          <p>Parked approvals, interrupted funding, and unpaid settles appear here. Until then, agents only spend what Policy already allows.</p>
        </div>`;
      return;
    }
    root.innerHTML = state.nowItems
      .map((row) => {
        const record = state.detail[row.operationId];
        const intent = record?.intent || row;
        const amount = money(intent.amountUsdMicros || row.amountUsdMicros || row.amountAtomic);
        const access = (() => {
          try {
            return new URL(intent.resource).origin === intent.merchantOrigin
              ? pathOf(intent.resource)
              : intent.resource;
          } catch {
            return pathOf(intent.resource);
          }
        })();
        const parked = row.state === "approval_required";
        const pending = state.pending?.id === row.operationId;
        const confirm = pending
          ? `<div class="confirm-copy">${
              state.pending.act === "approve"
                ? "Approve will fund this payment and pay the merchant under the live policy. Observe is not a dry-run."
                : state.pending.act === "resume"
                  ? "Resume continues this same payment id — fund, pay, or fulfill the next unfinished step. It will not start a new payment."
                  : "Reject is final. This payment id cannot be reused later."
            }</div>
            <div class="actions">
              <button class="btn ${state.pending.act === "deny" ? "danger" : "primary"}" data-act="confirm" type="button">${
                state.pending.act === "approve"
                  ? "Confirm approve"
                  : state.pending.act === "resume"
                    ? "Confirm resume"
                    : "Confirm reject"
              }</button>
              <button class="btn ghost" data-act="cancel" type="button">Back</button>
            </div>`
          : parked
            ? `<div class="actions">
              <button class="btn primary" data-act="approve" type="button">Approve</button>
              <button class="btn danger" data-act="deny" type="button">Reject</button>
            </div>`
            : `<div class="actions">
              <button class="btn primary" data-act="resume" type="button">Resume</button>
            </div>`;
        return `
          <article class="brief" data-id="${esc(row.operationId)}">
            <p class="kicker">${esc(parked ? "Waiting for you" : STATES[row.state] || row.state)}</p>
            <p class="amount">${esc(amount)}</p>
            <p class="lead">${
              parked
                ? `An agent is requesting ${esc(amount)} to pay this merchant for ${esc(access)}.`
                : `This payment is still in the 402 → fund → pay loop for ${esc(access)}.`
            }</p>
            <dl class="facts">
              <dt>Merchant</dt><dd>${esc(intent.merchantOrigin)}</dd>
              <dt>Access</dt><dd>${esc(access)}</dd>
              <dt>Amount</dt><dd>${esc(amount)} ${esc(assetLabel(intent.assetMint))}</dd>
              <dt>Network</dt><dd>${esc(networkLabel(intent.network))}</dd>
              <dt>${parked ? "Why stopped" : "Where it is"}</dt><dd>${esc(
                parked ? parkedReason(row, record) : openLoopCopy(row, record)
              )}</dd>
              ${parked ? `<dt>If approved</dt><dd>${esc(fundingCopy(row, record))}</dd>` : ""}
            </dl>
            <details class="ref"><summary>Reference</summary><p class="id">${esc(row.operationId)}</p></details>
            <p class="meaning">${
              parked
                ? "Approve lets AgentTab complete this payment. Reject stops this payment only; the agent must start a new one."
                : "Resume finishes the original agent request on this id. It will not mint a second swap or x402 pay."
            }</p>
            ${confirm}
          </article>`;
      })
      .join("");
  }

  function renderLedger() {
    const root = $("ledger-list");
    if (!state.recent.length) {
      root.innerHTML = `
        <div class="empty">
          <h2>No payments yet</h2>
          <p>Parks, approvals, rejections, funding, and fulfilled pays will land here as a ledger — what the agent wanted, what AgentTab decided, and what money actually did.</p>
        </div>`;
      return;
    }
    root.innerHTML = state.recent
      .map((row) => {
        const open = state.detail[row.operationId];
        const skip = new Set([
          "funding.attempt_locked",
          "funding.plan_receipt",
          "funding.balances_applied",
        ]);
        // signer_failed / confirm_interrupted stay visible — those are the retry points.
        const events = (open?.events || [])
          .filter((event) => !skip.has(event.kind))
          .map(
            (event) =>
              `<li><time>${esc(when(event.at))}</time><span>${esc(eventText(event.kind))}${
                event.details?.reason ? ` — ${esc(reasonText(event.details.reason, event.details.reason))}` : ""
              }</span></li>`,
          )
          .join("");
        return `
          <article class="entry" data-id="${esc(row.operationId)}">
            <div class="state">${esc(STATES[row.state] || row.state)}</div>
            <div>
              <div>${esc(originHost(row.merchantOrigin))} · ${esc(pathOf(row.resource))}</div>
              <div class="sub">${esc(when(row.updatedAt))} · ${esc(networkLabel(row.network))}</div>
            </div>
            <div class="amount">${esc(money(row.amountUsdMicros || row.amountAtomic))}</div>
            ${open ? `<ol class="trail">${events || "<li>No events on this payment.</li>"}</ol>` : ""}
          </article>`;
      })
      .join("");
  }

  function renderPolicy() {
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
              `<span class="merchant">${esc(origin)}<button type="button" data-remove-origin="${esc(origin)}" aria-label="Remove ${esc(origin)}">×</button></span>`,
          )
          .join("")
      : `<span class="help">Add a merchant origin agents are allowed to pay.</span>`;
    $("max-payment").value = dollarsInput(policy.maxPaymentUsdMicros);
    $("max-daily").value = dollarsInput(policy.maxDailyUsdMicros);
    $("approve-above").value = dollarsInput(policy.requireApprovalAboveUsdMicros);
    $("policy-json").value = JSON.stringify(policy, null, 2);
  }

  function render() {
    renderStance();
    if (!state.pending) renderNow();
    renderLedger();
    renderPolicy();
  }

  async function loadDetails(rows) {
    const missing = rows
      .map((row) => row.operationId)
      .filter((id) => !state.detail[id])
      .slice(0, 10);
    await Promise.all(
      missing.map(async (id) => {
        try {
          state.detail[id] = await api(`/v1/executions/${encodeURIComponent(id)}`);
        } catch {
          /* summary still renders */
        }
      }),
    );
  }

  async function refresh() {
    try {
      const healthRes = await fetch("/health");
      state.health = await readJson(healthRes);
      const [policy, openLoop, recent, spend, balances] = await Promise.all([
        api("/v1/policy"),
        api("/v1/executions?reusable=1&limit=20"),
        api("/v1/executions?limit=20"),
        api("/v1/spend"),
        api("/v1/balances"),
      ]);
      showUnlock(false);
      state.policy = policy;
      state.nowItems = openLoop.executions || [];
      state.parked = state.nowItems.filter((row) => row.state === "approval_required");
      state.recent = recent.executions || [];
      state.spend = spend;
      state.balances = balances.balances || [];
      await loadDetails(state.nowItems);
      render();
      if (statusEl.classList.contains("bad")) setStatus("", "");
    } catch (error) {
      renderStance();
      if (needsToken() && /token|401|unauthorized/i.test(String(error.message))) {
        showUnlock(true);
      }
      setStatus("bad", error.message);
    }
  }

  async function savePolicy(next, done) {
    const body = await api("/v1/policy", { method: "PUT", body: JSON.stringify(next) });
    state.policy = body;
    renderPolicy();
    renderStance();
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
    await savePolicy({ ...state.policy, mode }, `Policy is now ${modeLabel(mode)}.`);
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
    await savePolicy({ ...state.policy, allowedMerchantOrigins: next }, `${origin} removed.`);
  }

  async function saveCaps(event) {
    event.preventDefault();
    if (!state.policy) return;
    try {
      const next = {
        ...state.policy,
        maxPaymentUsdMicros: toMicros($("max-payment").value),
        maxDailyUsdMicros: toMicros($("max-daily").value),
      };
      const above = $("approve-above").value.trim();
      if (above) next.requireApprovalAboveUsdMicros = toMicros(above);
      else delete next.requireApprovalAboveUsdMicros;
      await savePolicy(next, "Limits saved.");
    } catch (error) {
      setStatus("bad", error.message);
    }
  }

  async function saveJson(event) {
    event.preventDefault();
    try {
      await savePolicy(JSON.parse($("policy-json").value), "Policy JSON saved.");
    } catch (error) {
      setStatus("bad", error.message);
    }
  }

  async function approve(id) {
    const body = await api(`/v1/approvals/${encodeURIComponent(id)}`, {
      method: "POST",
      body: "{}",
    });
    state.pending = null;
    delete state.detail[id];
    await refresh();
    setStatus("ok", `Approved · ${STATES[body.record?.state] || body.record?.state || "funded"}`);
  }

  async function deny(id) {
    await api(`/v1/denials/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ reason: "operator_denied" }),
    });
    state.pending = null;
    delete state.detail[id];
    await refresh();
    setStatus("ok", "Rejected. That payment cannot be reused.");
  }

  async function resume(id) {
    const body = await api(`/v1/executions/${encodeURIComponent(id)}/resume`, {
      method: "POST",
      body: "{}",
    });
    state.pending = null;
    delete state.detail[id];
    await refresh();
    const step = body.step || body.outcome?.status || body.record?.state;
    setStatus("ok", `Resumed · ${STATES[body.record?.state] || step || "updated"}`);
  }

  async function ask(event) {
    event.preventDefault();
    const result = $("ask-result");
    try {
      const merchantOrigin = $("ask-origin").value.trim();
      const resource = $("ask-resource").value.trim();
      const amountUsdMicros = toMicros($("ask-usd").value);
      const mint =
        state.policy?.allowedPaymentAssets?.[0] ||
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
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
          assetMint: mint,
          amountAtomic: amountUsdMicros,
          amountUsdMicros,
          resource,
        }),
      });
      const kind = body.decision?.kind;
      const title =
        kind === "allow"
          ? "AgentTab would allow this"
          : kind === "approval_required"
            ? "This would wait on Now"
            : "AgentTab would deny this";
      const detail = reasonText(body.decision?.reason, body.decision?.message);
      const extra =
        kind === "allow"
          ? " If an agent requested this now, funding could proceed. This check did not move money."
          : kind === "approval_required"
            ? " You would see it on Now. Approving later still spends. This check did not."
            : ` ${body.hint || ""}`;
      result.hidden = false;
      result.innerHTML = `<h3>${esc(title)}</h3><p>${esc(detail)}${esc(extra)}</p>`;
    } catch (error) {
      result.hidden = false;
      result.innerHTML = `<h3>Could not check</h3><p>${esc(error.message)}</p>`;
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
  $("decision-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const card = button.closest("[data-id]");
    const id = card?.dataset.id;
    const row = state.nowItems.find((item) => item.operationId === id);
    if (!row) return;
    if (button.dataset.act === "approve") {
      state.pending = { id, act: "approve" };
      renderNow();
    } else if (button.dataset.act === "deny") {
      state.pending = { id, act: "deny" };
      renderNow();
    } else if (button.dataset.act === "resume") {
      state.pending = { id, act: "resume" };
      renderNow();
    } else if (button.dataset.act === "cancel") {
      state.pending = null;
      renderNow();
    } else if (button.dataset.act === "confirm") {
      if (state.pending?.act === "approve") approve(id);
      if (state.pending?.act === "deny") deny(id);
      if (state.pending?.act === "resume") resume(id);
    }
  });
  $("ledger-list").addEventListener("click", async (event) => {
    const card = event.target.closest("[data-id]");
    if (!card) return;
    const id = card.dataset.id;
    if (state.detail[id] && state.view === "ledger") {
      const alreadyOpen = card.querySelector(".trail");
      if (alreadyOpen) {
        delete state.detail[id];
        renderLedger();
        return;
      }
    }
    try {
      state.detail[id] = await api(`/v1/executions/${encodeURIComponent(id)}`);
      renderLedger();
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

  $("ask-usd").value = $("ask-usd").value || "2.50";
  tokenInput.value = sessionStorage.getItem("agenttab.admin") || "";
  const hash = aliases[location.hash.replace("#", "")] || location.hash.replace("#", "");
  setView(panels[hash] ? hash : "now");
  showUnlock(needsToken() && !tokenInput.value);
  refresh();
  setInterval(refresh, 5000);
})();

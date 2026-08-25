(() => {
  const $ = (id) => document.getElementById(id);
  const panel = $("panel");
  const statusEl = $("status");
  const runButton = $("run-request");

  const REQUESTS = {
    valuation: {
      result: "Wallet valuation can continue",
    },
    "price-check": {
      result: "SOL price check can continue",
    },
    "portfolio-refresh": {
      result: "Portfolio refresh can continue",
    },
  };

  const state = {
    busy: false,
    scenario: "partial",
    request: "valuation",
    row: null,
    detail: null,
    balances: [],
    health: null,
    demoControls: false,
  };

  const USDC_DECIMALS = 6;

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function moneyFromAtomic(atomic, decimals = USDC_DECIMALS) {
    const n = Number(atomic || 0) / 10 ** decimals;
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function usdcBalance() {
    const row = state.balances.find((b) => (b.symbol || "").toUpperCase() === "USDC");
    return row?.balanceAtomic ?? "0";
  }

  function findEvent(detail, kind) {
    return (detail?.events || []).find((event) => event.kind === kind);
  }

  function requestId(intent) {
    const taskId = intent?.taskId || "";
    return Object.keys(REQUESTS).find((id) => taskId.startsWith(`${id}-`)) || "valuation";
  }

  async function readJson(res) {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  async function api(path, init = {}) {
    const headers = { ...(init.headers || {}) };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(path, { ...init, headers });
    const body = await readJson(res);
    if (!res.ok) {
      throw new Error(body.message || body.error || `${res.status} ${path}`);
    }
    return body;
  }

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function loopNumbers(row, detail) {
    const intent = detail?.intent || row?.intent || {};
    const asked = BigInt(intent.amountAtomic || "0");
    const liveHold = BigInt(usdcBalance());
    const submitted = findEvent(detail, "funding.submitted");
    const notRequired = findEvent(detail, "funding.not_required");
    let deficit;
    let hold;

    if (submitted?.details?.deficitAtomic !== undefined) {
      deficit = BigInt(submitted.details.deficitAtomic);
      hold = asked > deficit ? asked - deficit : 0n;
    } else if (notRequired) {
      deficit = 0n;
      hold = asked;
    } else {
      hold = liveHold;
      deficit = asked > hold ? asked - hold : 0n;
    }

    const fulfilled = findEvent(detail, "resource.fulfilled");
    return {
      asked: asked.toString(),
      hold: hold.toString(),
      deficit: deficit.toString(),
      alreadyHeld: deficit === 0n,
      purpose: intent.taskContext?.purpose || "Estimate my wallet's USD value",
      resource: intent.resource || "",
      requestId: requestId(intent),
      responseHash: fulfilled?.details?.responseHash || "",
      state: row?.state || detail?.state || "unknown",
    };
  }

  function beats(loop) {
    const st = loop.state;
    const items = [
      { id: "request", label: "Request" },
      { id: "challenge", label: "x402 asks" },
      { id: "dflow", label: loop.alreadyHeld ? "No swap" : "DFlow" },
      { id: "pay", label: "x402 pay" },
      { id: "result", label: "Result" },
    ];
    let active = "request";
    if (st === "discovered") active = "challenge";
    else if (st === "approval_required") active = loop.alreadyHeld ? "pay" : "dflow";
    else if (["approved", "funding_submitted"].includes(st)) active = "dflow";
    else if (["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(st)) active = "pay";
    else if (st === "fulfilled") active = "result";
    const activeIdx = items.findIndex((item) => item.id === active);
    return items.map((item, index) => ({
      ...item,
      cls: index < activeIdx ? "is-done" : index === activeIdx ? (st === "fulfilled" ? "is-done" : "is-active") : "",
    }));
  }

  function primaryLabel(loop) {
    if (loop.state === "approval_required") {
      return loop.alreadyHeld
        ? `Pay ${moneyFromAtomic(loop.asked)} and continue`
        : `Buy ${moneyFromAtomic(loop.deficit)} and continue`;
    }
    if (["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(loop.state)) {
      return "Continue the original request";
    }
    return null;
  }

  function stateLabel(st) {
    if (st === "approval_required") return "Waiting for you";
    if (["approved", "funding_submitted"].includes(st)) return "Acquiring USDC";
    if (["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(st)) return "Paying & continuing";
    if (st === "fulfilled") return "Request complete";
    return st.replaceAll("_", " ");
  }

  function resourcePath(resource) {
    try {
      return new URL(resource).pathname;
    } catch {
      return resource || "—";
    }
  }

  function renderControls() {
    document.querySelectorAll("[data-request]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.request === state.request ? "true" : "false");
    });
    document.querySelectorAll("[data-scenario]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.scenario === state.scenario ? "true" : "false");
    });
    runButton.disabled = state.busy;
  }

  function render() {
    renderControls();

    if (!state.row) {
      panel.innerHTML = `<p class="demo-empty">No request is active. Choose a paid task and run it.</p>`;
      return;
    }

    const loop = loopNumbers(state.row, state.detail);
    const path = beats(loop)
      .map((beat) => `<li class="${beat.cls}">${esc(beat.label)}</li>`)
      .join("");
    const label = primaryLabel(loop);
    const done = loop.state === "fulfilled";
    const result = REQUESTS[loop.requestId]?.result || "Original task can continue";
    const story = done
      ? loop.alreadyHeld
        ? `The wallet already covered the ${moneyFromAtomic(loop.asked)} x402 ask. AgentTab paid it and continued the same request without a DFlow swap.`
        : `AgentTab acquired only ${moneyFromAtomic(loop.deficit)} through DFlow, paid the ${moneyFromAtomic(loop.asked)} x402 ask, and continued the same request.`
      : loop.alreadyHeld
        ? `The wallet already holds enough USDC. AgentTab will pay the merchant and continue; no DFlow swap is needed.`
        : `The wallet has ${moneyFromAtomic(loop.hold)} of the ${moneyFromAtomic(loop.asked)} x402 ask. AgentTab will acquire only the missing ${moneyFromAtomic(loop.deficit)}.`;

    panel.innerHTML = `
      <div class="demo-execution-head">
        <div><span>Active request</span><strong>${esc(loop.purpose)}</strong></div>
        <span class="demo-state ${done ? "is-done" : ""}">${esc(stateLabel(loop.state))}</span>
      </div>
      <div class="demo-equation">
        <div class="demo-metric"><span>Wallet holds</span><strong>${esc(moneyFromAtomic(loop.hold))}</strong><small>USDC before the request</small></div>
        <span aria-hidden="true">→</span>
        <div class="demo-metric"><span>Request needs</span><strong>${esc(moneyFromAtomic(loop.asked))}</strong><small>x402 ask</small></div>
        <span aria-hidden="true">=</span>
        <div class="demo-metric ${loop.alreadyHeld ? "is-ok" : "is-deficit"}"><span>${loop.alreadyHeld ? "DFlow swap" : "DFlow buys"}</span><strong>${esc(moneyFromAtomic(loop.deficit))}</strong><small>${loop.alreadyHeld ? "not required" : "exact deficit"}</small></div>
      </div>
      <ol class="demo-path" aria-label="Request, x402 challenge, DFlow, payment, result">${path}</ol>
      <p class="demo-story">${esc(story)}</p>
      ${
        label
          ? `<button type="button" class="demo-btn demo-btn-primary" id="primary" ${state.busy ? "disabled" : ""}>${esc(label)} <span aria-hidden="true">→</span></button>`
          : done
            ? `<div class="demo-result"><span>Result delivered</span><strong>${esc(result)}</strong><p>The payment barrier is complete and the original agent task is unblocked.</p></div>`
            : ""
      }
      <details class="demo-details">
        <summary>See what happened technically</summary>
        <div class="demo-tech-grid">
          <div><span>Paid resource</span><code>${esc(resourcePath(loop.resource))}</code></div>
          <div><span>Payment</span><code>${esc(moneyFromAtomic(loop.asked))} USDC via x402</code></div>
          <div><span>DFlow</span><code>${loop.alreadyHeld ? "Not required" : `${esc(moneyFromAtomic(loop.deficit))} exact-deficit mock`}</code></div>
          <div><span>Response proof</span><code>${esc(loop.responseHash || (done ? "fulfilled" : "pending"))}</code></div>
        </div>
      </details>
    `;

    const primary = $("primary");
    if (primary) primary.addEventListener("click", () => actPrimary(loop));
  }

  async function actPrimary(loop) {
    if (state.busy || !state.row) return;
    state.busy = true;
    setStatus("AgentTab is completing the local mock loop…");
    render();
    try {
      const id = state.row.operationId;
      if (loop.state === "approval_required") {
        const body = await api(`/v1/approvals/${encodeURIComponent(id)}`, {
          method: "POST",
          body: "{}",
        });
        const funded =
          body.record?.state === "funded" ||
          body.outcome?.status === "funded" ||
          body.outcome?.status === "already_funded";
        if (funded) {
          await api(`/v1/executions/${encodeURIComponent(id)}/resume`, {
            method: "POST",
            body: "{}",
          });
        }
      } else if (["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(loop.state)) {
        await api(`/v1/executions/${encodeURIComponent(id)}/resume`, {
          method: "POST",
          body: "{}",
        });
      }
      let detail = await api(`/v1/executions/${encodeURIComponent(id)}`);
      if (detail.state === "paid" || detail.state === "fulfillment_failed") {
        await api(`/v1/executions/${encodeURIComponent(id)}/resume`, {
          method: "POST",
          body: "{}",
        });
        detail = await api(`/v1/executions/${encodeURIComponent(id)}`);
      }
      state.detail = detail;
      state.row = { ...state.row, state: detail.state, intent: detail.intent };
      setStatus(detail.state === "fulfilled" ? "Done — the original request continued." : `State: ${detail.state}`);
      await refreshBalances();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      state.busy = false;
      render();
    }
  }

  async function refreshBalances() {
    const body = await api("/v1/balances");
    state.balances = Array.isArray(body) ? body : body.balances || [];
  }

  async function refresh() {
    try {
      state.health = await api("/health");
      state.demoControls = state.health?.demoControls === true;
      const badge = $("mode-badge");
      if (badge && state.health?.fundingMode) {
        badge.textContent =
          state.health.fundingMode === "mock"
            ? "Local DFlow mock — no chain"
            : `Funding mode: ${state.health.fundingMode}`;
      }
      await refreshBalances();
      const open = await api("/v1/executions?reusable=1&limit=5");
      const rows = open.executions || open.items || [];
      const active =
        rows.find((row) => row.state === "approval_required") ||
        rows.find((row) => ["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(row.state)) ||
        rows[0] ||
        null;
      if (active) {
        state.row = active;
        state.detail = await api(`/v1/executions/${encodeURIComponent(active.operationId)}`);
      } else if (state.row?.state !== "fulfilled") {
        state.row = null;
        state.detail = null;
      }
      render();
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  async function runRequest() {
    if (!state.demoControls) {
      setStatus("Interactive controls need the demo stack (pnpm demo:stack / Railway).");
      return;
    }
    state.busy = true;
    setStatus("Starting your request…");
    renderControls();
    try {
      const body = await api("/v1/demo/scenario", {
        method: "POST",
        body: JSON.stringify({ scenario: state.scenario, request: state.request }),
      });
      setStatus(body.message || "Your request is ready.");
      await refresh();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      state.busy = false;
      render();
    }
  }

  $("requests").addEventListener("click", (event) => {
    const button = event.target.closest("[data-request]");
    if (!button || state.busy) return;
    state.request = button.dataset.request;
    setStatus("Ready — run the request to apply your choices.");
    renderControls();
  });

  $("scenarios").addEventListener("click", (event) => {
    const button = event.target.closest("[data-scenario]");
    if (!button || state.busy) return;
    state.scenario = button.dataset.scenario;
    setStatus("Ready — run the request to apply your choices.");
    renderControls();
  });

  runButton.addEventListener("click", () => {
    if (!state.busy) runRequest();
  });

  refresh();
  setInterval(() => {
    if (!state.busy && !document.querySelector(".demo-details[open]")) refresh();
  }, 4000);
})();

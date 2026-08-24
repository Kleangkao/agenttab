(() => {
  const $ = (id) => document.getElementById(id);
  const panel = $("panel");
  const statusEl = $("status");
  const walletHint = $("wallet-hint");

  const state = {
    busy: false,
    scenario: "partial",
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
    const asked = intent.amountAtomic || "0";
    const hold = usdcBalance();
    const askedN = BigInt(asked || "0");
    const holdN = BigInt(hold || "0");
    const deficit = askedN > holdN ? askedN - holdN : 0n;
    return {
      asked,
      hold,
      deficit: deficit.toString(),
      alreadyHeld: deficit === 0n,
      purpose: intent.taskContext?.purpose || "Estimate my wallet's USD value",
      resource: intent.resource || "",
      state: row?.state || detail?.state || "unknown",
    };
  }

  function beats(loop) {
    const st = loop.state;
    const items = [
      { id: "need", label: "Need resource" },
      { id: "short", label: "Short USDC" },
      { id: "buy", label: "Buy deficit" },
      { id: "pay", label: "Pay x402" },
      { id: "done", label: "Continue" },
    ];
    let active = "need";
    if (st === "approval_required") active = loop.alreadyHeld ? "pay" : "buy";
    else if (["approved", "funding_submitted", "funded"].includes(st)) active = "buy";
    else if (["payment_submitted", "paid"].includes(st)) active = "pay";
    else if (st === "fulfilled") active = "done";
    const activeIdx = items.findIndex((x) => x.id === active);
    return items.map((item, i) => ({
      ...item,
      cls: i < activeIdx ? "is-done" : i === activeIdx ? "is-active" : "",
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

  function render() {
    const chips = document.querySelectorAll("[data-scenario]");
    chips.forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.scenario === state.scenario ? "true" : "false");
    });

    if (!state.row) {
      panel.innerHTML = `<p class="demo-empty">No agent request waiting. Pick a scenario to park one.</p>`;
      return;
    }

    const loop = loopNumbers(state.row, state.detail);
    $("agent-intent").textContent = loop.purpose;
    const path = beats(loop)
      .map((b) => `<li class="${b.cls}">${esc(b.label)}</li>`)
      .join("");
    const label = primaryLabel(loop);
    const done = loop.state === "fulfilled";
    const story = done
      ? "The agent received the resource after AgentTab bought only the missing USDC and paid the merchant."
      : loop.alreadyHeld
        ? "Wallet already holds enough USDC. Approve to pay the merchant and continue the agent."
        : `Wallet holds ${moneyFromAtomic(loop.hold)} but the merchant asks ${moneyFromAtomic(loop.asked)}. AgentTab buys only the deficit.`;

    panel.innerHTML = `
      ${done ? `<p class="demo-done">Agent received the resource</p>` : ""}
      <div class="demo-compare">
        <div class="demo-metric"><span>Wallet holds</span><strong>${esc(moneyFromAtomic(loop.hold))}</strong></div>
        <div class="demo-arrow" aria-hidden="true">→</div>
        <div class="demo-metric"><span>Merchant asks</span><strong>${esc(moneyFromAtomic(loop.asked))}</strong></div>
      </div>
      <div class="demo-metric ${loop.alreadyHeld ? "is-ok" : "is-deficit"}" style="margin-bottom:1rem">
        <span>Exact deficit</span>
        <strong>${esc(moneyFromAtomic(loop.deficit))}</strong>
      </div>
      <ul class="demo-path">${path}</ul>
      <p class="demo-story">${esc(story)}</p>
      ${
        label
          ? `<button type="button" class="demo-btn demo-btn-primary" id="primary" ${state.busy ? "disabled" : ""}>${esc(label)}</button>`
          : done
            ? `<p class="demo-hint">Auto-reseed will park the next request shortly, or pick a scenario now.</p>`
            : ""
      }
    `;

    const primary = $("primary");
    if (primary) {
      primary.addEventListener("click", () => actPrimary(loop));
    }
  }

  async function actPrimary(loop) {
    if (state.busy || !state.row) return;
    state.busy = true;
    setStatus("Running mock settle…");
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
      } else if (
        ["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(loop.state)
      ) {
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
      state.row = {
        ...state.row,
        state: detail.state,
        intent: detail.intent,
      };
      setStatus(detail.state === "fulfilled" ? "Done — mock loop complete." : `State: ${detail.state}`);
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
    walletHint.textContent = `USDC on wallet: ${moneyFromAtomic(usdcBalance())}`;
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
      const parked =
        rows.find((r) => r.state === "approval_required") ||
        rows.find((r) =>
          ["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(r.state)
        ) ||
        rows[0] ||
        null;
      state.row = parked;
      if (parked) {
        state.detail = await api(`/v1/executions/${encodeURIComponent(parked.operationId)}`);
      } else {
        state.detail = null;
      }
      render();
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  async function applyScenario(id) {
    if (!state.demoControls) {
      setStatus("Scenario controls need the demo stack (pnpm demo:stack / Railway).");
      return;
    }
    state.busy = true;
    setStatus(`Loading scenario: ${id}…`);
    try {
      const body = await api("/v1/demo/scenario", {
        method: "POST",
        body: JSON.stringify({ scenario: id }),
      });
      state.scenario = id;
      setStatus(body.message || `Scenario ${id} ready.`);
      await refresh();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      state.busy = false;
      render();
    }
  }

  async function topup() {
    if (!state.demoControls) {
      setStatus("Add USDC needs the demo stack (pnpm demo:stack / Railway).");
      return;
    }
    state.busy = true;
    setStatus("Adding $1 USDC…");
    try {
      const body = await api("/v1/demo/topup", {
        method: "POST",
        body: JSON.stringify({ usdcAtomic: "1000000" }),
      });
      setStatus(body.message || "Added $1 USDC and re-parked.");
      await refresh();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      state.busy = false;
      render();
    }
  }

  $("scenarios").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-scenario]");
    if (!btn || state.busy) return;
    applyScenario(btn.dataset.scenario);
  });
  $("topup").addEventListener("click", () => {
    if (!state.busy) topup();
  });

  refresh();
  setInterval(() => {
    if (!state.busy) refresh();
  }, 4000);
})();

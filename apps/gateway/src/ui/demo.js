(() => {
  const $ = (id) => document.getElementById(id);
  const panel = $("panel");
  const statusEl = $("status");
  const runButton = $("run-request");

  const REQUESTS = {
    subscription: {
      result: "The subscription is paid for another month",
      delivered: "The provider took the renewal, so the plan stays active.",
    },
    "agentic-ai": {
      result: "The agentic AI service is paid",
      delivered: "The AI service your agent needed responded, so your task could finish.",
    },
  };

  const t = (key, english, vars) =>
    window.ATI18N ? window.ATI18N.t(key, english, vars) : english;

  /**
   * The public host is one shared gateway, so several visitors can have a card
   * parked at once. This id tags the card this browser started, so a reset from
   * someone else never takes it away and this page never adopts theirs.
   */
  function demoSessionId() {
    const key = "agenttab.demoSession";
    try {
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
      const fresh = (crypto.randomUUID?.() || String(Date.now())).replaceAll("-", "");
      sessionStorage.setItem(key, fresh);
      return fresh;
    } catch {
      // Private modes can throw on access; a per-load id is still better than none.
      return (crypto.randomUUID?.() || String(Date.now())).replaceAll("-", "");
    }
  }

  const state = {
    busy: false,
    sessionId: demoSessionId(),
    /** operationId of the card this browser started, once it has run one. */
    ownedOperationId: null,
    /** Wallet the active card was seeded with, and the card it belongs to. */
    startingUsdcAtomic: null,
    startingFor: null,
    // The public stack auto-parks a fresh card seconds after a loop finishes.
    // Without this, the visitor's own result is swapped out before they read it.
    holdResult: false,
    scenario: "partial",
    request: "subscription",
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

  function solFromAtomic(atomic) {
    const n = Number(atomic || 0) / 1e9;
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
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
    return Object.keys(REQUESTS).find((id) => taskId.startsWith(`${id}-`)) || "subscription";
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
      // Before funding, the shared mock wallet may already hold another
      // visitor's scenario. This card's own starting wallet is the truth.
      hold =
        state.startingFor === (row?.operationId ?? null) &&
        state.startingUsdcAtomic !== null
          ? BigInt(state.startingUsdcAtomic)
          : liveHold;
      deficit = asked > hold ? asked - hold : 0n;
    }

    const funded = findEvent(detail, "funding.confirmed");
    const fulfilled = findEvent(detail, "resource.fulfilled");
    return {
      solInAtomic: funded?.details?.inputAmountAtomic ?? submitted?.details?.inputAmountAtomic ?? "",
      asked: asked.toString(),
      hold: hold.toString(),
      deficit: deficit.toString(),
      alreadyHeld: deficit === 0n,
      purpose: intent.taskContext?.purpose || "Pay a monthly subscription",
      resource: intent.resource || "",
      requestId: requestId(intent),
      responseHash: fulfilled?.details?.responseHash || "",
      state: row?.state || detail?.state || "unknown",
    };
  }

  function beats(loop) {
    const st = loop.state;
    const items = [
      { id: "request", label: t("d.beat.request", "Request") },
      { id: "challenge", label: t("d.beat.challenge", "Payment needed") },
      {
        id: "dflow",
        label: loop.alreadyHeld
          ? t("d.beat.cover.none", "Nothing to cover")
          : t("d.beat.cover", "Covered"),
      },
      { id: "pay", label: t("d.beat.pay", "Paid") },
      { id: "result", label: t("d.beat.result", "Result") },
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
        ? t("d.btn.pay", `Pay ${moneyFromAtomic(loop.asked)} and continue`, {
            ask: moneyFromAtomic(loop.asked),
          })
        : t("d.btn.cover", `Cover the ${moneyFromAtomic(loop.deficit)} gap and continue`, {
            gap: moneyFromAtomic(loop.deficit),
          });
    }
    if (["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(loop.state)) {
      return t("d.btn.continue", "Continue the original request");
    }
    return null;
  }

  function stateLabel(st) {
    if (st === "approval_required") return t("d.state.waiting", "Waiting for you");
    if (["approved", "funding_submitted"].includes(st)) return t("d.state.covering", "Covering the gap");
    if (["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(st))
      return t("d.state.paying", "Paying & continuing");
    if (st === "fulfilled") return t("d.state.done", "Request completed");
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
      panel.innerHTML = `<p class="demo-empty">${esc(t("d.empty.none", "No request is active. Choose a task and run it."))}</p>`;
      return;
    }

    if (state.row.state === "approval_required" && state.row.parkedExpired === true) {
      panel.innerHTML = `<p class="demo-empty">${esc(t("d.empty.expired", "This request waited too long to be approved, so it can no longer be paid. Run a new one above."))}</p>`;
      return;
    }

    if (state.row.state === "denied") {
      panel.innerHTML = `<p class="demo-empty">${esc(t("d.empty.reset", "This request was reset on the shared demo host. Run a new one above."))}</p>`;
      return;
    }

    const loop = loopNumbers(state.row, state.detail);
    const path = beats(loop)
      .map((beat) => `<li class="${beat.cls}">${esc(beat.label)}</li>`)
      .join("");
    const label = primaryLabel(loop);
    const done = loop.state === "fulfilled";
    const request = REQUESTS[loop.requestId] || {};
    const result = t(
      `d.result.${loop.requestId}`,
      request.result || "Your request is ready",
    );
    const delivered = t(
      `d.result.${loop.requestId}.sub`,
      request.delivered || "The paid service responded, so your task can finish.",
    );
    const money = {
      ask: moneyFromAtomic(loop.asked),
      hold: moneyFromAtomic(loop.hold),
      gap: moneyFromAtomic(loop.deficit),
    };
    const story = done
      ? loop.alreadyHeld
        ? t(
            "d.story.done.ok",
            `The wallet already had the ${money.ask} this task costs, so AgentTab paid and kept going.`,
            money,
          )
        : t(
            "d.story.done.short",
            `AgentTab covered only the missing ${money.gap}, paid the ${money.ask} this task costs, and your request carried on.`,
            money,
          )
      : loop.alreadyHeld
        ? t(
            "d.story.ok",
            "The wallet already has enough to pay for this task. AgentTab will pay and continue - there is no gap to cover.",
            money,
          )
        : t(
            "d.story.short",
            `The wallet has ${money.hold} of the ${money.ask} this task costs. AgentTab will swap the SOL it holds to cover only the missing ${money.gap}.`,
            money,
          );

    panel.innerHTML = `
      <div class="demo-execution-head">
        <div><span>${esc(t("d.active", "Active request"))}</span><strong>${esc(t(`d.purpose.${loop.requestId}`, loop.purpose))}</strong></div>
        <span class="demo-state ${done ? "is-done" : ""}">${esc(stateLabel(loop.state))}</span>
      </div>
      <div class="demo-equation">
        <div class="demo-metric"><span>${esc(t("d.eq.has", "Wallet has"))}</span><strong>${esc(money.hold)}</strong><small>${esc(t("d.eq.has.sub", "before this task"))}</small></div>
        <span aria-hidden="true">→</span>
        <div class="demo-metric"><span>${esc(t("d.eq.needs", "Service requires"))}</span><strong>${esc(money.ask)}</strong><small>${esc(t("d.eq.needs.sub", "to run this task"))}</small></div>
        <span aria-hidden="true">=</span>
        <div class="demo-metric ${loop.alreadyHeld ? "is-ok" : "is-deficit"}"><span>${esc(t("d.eq.covers", "AgentTab covers"))}</span><strong>${esc(money.gap)}</strong><small>${esc(loop.alreadyHeld ? t("d.eq.covers.none", "nothing to cover") : t("d.eq.covers.sub", "only what is missing"))}</small></div>
      </div>
      <ol class="demo-path" aria-label="Request, payment needed, covered, paid, result">${path}</ol>
      <p class="demo-story">${esc(story)}</p>
      ${
        label
          ? `<button type="button" class="demo-btn demo-btn-primary" id="primary" ${state.busy ? "disabled" : ""}>${esc(label)} <span aria-hidden="true">→</span></button>
             <p class="demo-btn-note">${esc(t("d.powered", "Powered by DFlow"))}</p>`
          : done
            ? `<div class="demo-result"><span>${esc(t("d.done.label", "Request completed"))}</span><strong>${esc(result)}</strong><p>${esc(delivered)}</p></div>`
            : ""
      }
      <details class="demo-details">
        <summary>${esc(t("d.tech.summary", "Behind the scenes"))}</summary>
        <div class="demo-tech-grid">
          <div><span>${esc(t("d.tech.swap", "DFlow swap"))}</span><code>${
            loop.alreadyHeld
              ? esc(t("d.tech.swap.none", "Not required, the wallet already holds USDC"))
              : `${loop.solInAtomic ? `${esc(solFromAtomic(loop.solInAtomic))} SOL → ` : ""}${esc(money.gap)} USDC${esc(t("d.tech.swap.exact", " (exact deficit)"))}`
          }</code></div>
          <div><span>${esc(t("d.tech.pay", "x402 payment"))}</span><code>${esc(money.ask)} USDC${esc(t("d.tech.pay.to", " to the provider"))}</code></div>
          <div><span>${esc(t("d.tech.api", "Paid API endpoint"))}</span><code>${esc(resourcePath(loop.resource))}</code></div>
          <div><span>${esc(t("d.tech.proof", "Response proof"))}</span><code>${esc(loop.responseHash || (done ? t("d.tech.done", "fulfilled") : t("d.tech.pending", "pending")))}</code></div>
        </div>
      </details>
    `;

    const primary = $("primary");
    if (primary) primary.addEventListener("click", () => actPrimary(loop));
  }

  async function actPrimary(loop) {
    if (state.busy || !state.row) return;
    state.busy = true;
    setStatus(t("d.status.covering", "AgentTab is covering the gap…"));
    render();
    try {
      const id = state.row.operationId;
      if (loop.state === "approval_required") {
        // Shared demo host: this route restores the card's own starting wallet
        // and approves it in one step, so another visitor's scenario cannot
        // rewrite the gap being covered. Falls back to the plain approval when
        // the host does not know the card (a restart drops the mapping).
        const body = await api("/v1/demo/approve", {
          method: "POST",
          body: JSON.stringify({ operationId: id, sessionId: state.sessionId }),
        }).catch(() =>
          api(`/v1/approvals/${encodeURIComponent(id)}`, {
            method: "POST",
            body: "{}",
          }),
        );
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
      if (detail.state === "fulfilled") state.holdResult = true;
      setStatus(
        detail.state === "fulfilled"
          ? t("d.status.done", "Your request completed")
          : t("d.status.state", `State: ${detail.state}`, { state: detail.state }),
      );
      await refreshBalances();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      state.busy = false;
      render();
    }
  }

  /** The wallet this card was seeded with; null when the host cannot say. */
  async function loadCardStart(operationId) {
    if (state.startingFor === operationId) return;
    try {
      const body = await api(`/v1/demo/card/${encodeURIComponent(operationId)}`);
      state.startingUsdcAtomic = body.startingUsdcAtomic ?? null;
    } catch {
      state.startingUsdcAtomic = null;
    }
    state.startingFor = operationId;
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
            ? t("d.mode.mock", "Safe demo, no real funds")
            : `Funding mode: ${state.health.fundingMode}`;
      }
      await refreshBalances();
      // Their result stays up until they choose to run another request.
      if (state.holdResult && state.row?.state === "fulfilled") {
        render();
        return;
      }
      const open = await api("/v1/executions?reusable=1&limit=5");
      const rows = open.executions || open.items || [];
      const mine = state.ownedOperationId
        ? rows.find((row) => row.operationId === state.ownedOperationId) || null
        : null;
      // Before this visitor runs anything, the auto-seeded card is theirs to
      // look at. After that, only their own card drives this page.
      const active =
        mine ||
        (state.ownedOperationId
          ? null
          : rows.find(
              (row) => row.state === "approval_required" && row.parkedExpired !== true,
            ) ||
            rows.find((row) =>
              ["funded", "payment_submitted", "paid", "fulfillment_failed"].includes(row.state),
            ) ||
            rows[0] ||
            null);
      if (active) {
        state.row = active;
        state.detail = await api(`/v1/executions/${encodeURIComponent(active.operationId)}`);
        await loadCardStart(active.operationId);
      } else if (state.ownedOperationId) {
        // Left the open list: fulfilled, or reset by the host. Show its ending.
        const detail = await api(
          `/v1/executions/${encodeURIComponent(state.ownedOperationId)}`,
        );
        state.detail = detail;
        state.row = {
          operationId: state.ownedOperationId,
          state: detail.state,
          intent: detail.intent,
        };
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
      setStatus(
        t(
          "d.status.needstack",
          "Interactive controls need the demo stack (pnpm demo:stack / Railway).",
        ),
      );
      return;
    }
    state.busy = true;
    state.holdResult = false;
    setStatus(t("d.status.starting", "Starting your request…"));
    renderControls();
    try {
      const body = await api("/v1/demo/scenario", {
        method: "POST",
        body: JSON.stringify({
          scenario: state.scenario,
          request: state.request,
          sessionId: state.sessionId,
        }),
      });
      state.ownedOperationId = body.operationId || null;
      setStatus(t("d.status.ready", body.message || "Your request is ready."));
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
    setStatus(t("d.status.apply", "Run the request to apply your choices"));
    renderControls();
  });

  $("scenarios").addEventListener("click", (event) => {
    const button = event.target.closest("[data-scenario]");
    if (!button || state.busy) return;
    state.scenario = button.dataset.scenario;
    setStatus(t("d.status.apply", "Run the request to apply your choices"));
    renderControls();
  });

  runButton.addEventListener("click", () => {
    if (!state.busy) runRequest();
  });

  // The panel is built in JS, so the switch has to redraw it, not just the DOM.
  window.ATI18N?.onChange(() => render());

  refresh();
  setInterval(() => {
    if (!state.busy && !document.querySelector(".demo-details[open]")) refresh();
  }, 4000);
})();

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
    "payment.discovered": "Agent hit a paid resource",
    "policy.approval_required": "AgentTab paused the 402 for you",
    "approval.granted": "You approved",
    "approval.denied": "You rejected",
    "funding.submitted": "Buying only the exact deficit",
    "funding.attempt_locked": "Funding attempt locked",
    "funding.plan_receipt": "Funding plan received",
    "funding.signer_failed": "Funding paused; same payment can retry",
    "funding.confirm_interrupted": "Funding needs confirmation; same payment can retry",
    "funding.balances_applied": "Wallet balances updated",
    "funding.confirmed": "Deficit acquired — wallet can pay the 402",
    "funding.not_required": "Wallet already held the payment asset",
    "payment.submitted": "Paying the 402",
    "payment.settled": "402 paid",
    "payment.token_issued": "Local payment token issued",
    "payment.attempt_failed": "Payment attempt failed; same payment can retry",
    "resource.fulfilled": "Original request continued",
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

  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const WSOL = "So11111111111111111111111111111111111111112";

  function assetLabel(mint) {
    if (mint === USDC) return "USDC";
    if (mint === WSOL) return "SOL";
    return mint ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : "payment asset";
  }

  function fundingHow() {
    const mode = state.health?.fundingMode;
    if (mode === "mock") {
      return {
        short: "local mock",
        acquire: "local DFlow mock",
        honest: "local DFlow mock — no chain, not broadcasting",
      };
    }
    if (mode === "live-sim") {
      return {
        short: "DFlow sim",
        acquire: "DFlow simulated send",
        honest: "DFlow live quote, simulated send — not broadcasting unless enabled",
      };
    }
    if (mode === "live-quote") {
      return {
        short: "DFlow quote",
        acquire: "DFlow live quote",
        honest: "DFlow live quote — plan only, not broadcasting",
      };
    }
    if (mode === "devnet-mint") {
      return {
        short: "Devnet mint",
        acquire: "Devnet mint stand-in",
        honest: "Devnet mint stand-in — not DFlow",
      };
    }
    return {
      short: mode || "gateway",
      acquire: "funding coordinator",
      honest: mode || "gateway",
    };
  }

  function railFor(network) {
    const fund = fundingHow();
    const net = networkLabel(network);
    const live = Boolean(state.health?.broadcastEnabled);
    if (network === "solana:mainnet") {
      return live
        ? `${net} · ${fund.short} · live broadcast`
        : `${net} · ${fund.short} · not broadcasting`;
    }
    if (network === "solana:devnet") return `${net} · ${fund.honest}`;
    return fund.honest;
  }

  function formatAssetAmount(atomic, mint) {
    const n = Number(atomic);
    const symbol = assetLabel(mint);
    if (!Number.isFinite(n)) return `${atomic ?? "—"} ${symbol}`;
    if (mint === USDC || symbol === "USDC") return `${money(String(Math.round(n)))} ${symbol}`;
    const dec = mint === WSOL || symbol === "SOL" ? 9 : 6;
    const ui = n / 10 ** dec;
    return `${ui.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`;
  }

  function walletLine() {
    if (!state.balances.length) return "wallet unknown";
    return (
      state.balances
        .map((row) => tokenAmount(row))
        .filter((text) => !/^0(\.0+)?\s/.test(text) || /USDC/i.test(text))
        .join(" · ") || "empty wallet"
    );
  }

  function pickFundingRow(paymentMint) {
    const allowed = state.policy?.allowedFundingAssets || [WSOL];
    const ranked = [
      ...allowed.filter((mint) => mint === WSOL),
      ...allowed.filter((mint) => mint !== WSOL),
    ];
    for (const mint of ranked) {
      if (mint === paymentMint) continue;
      const row = state.balances.find((item) => item.mint === mint);
      if (row && Number(row.balanceAtomic) > 0) return row;
    }
    return null;
  }

  function findEvent(record, kind) {
    return (record?.events || []).find((event) => event.kind === kind);
  }

  function findLastEvent(record, kinds) {
    const set = new Set(kinds);
    return [...(record?.events || [])].reverse().find((event) => set.has(event.kind));
  }

  function accessPath(intent, row) {
    const resource = intent?.resource || row?.resource;
    const origin = intent?.merchantOrigin || row?.merchantOrigin;
    try {
      return new URL(resource).origin === origin ? pathOf(resource) : resource;
    } catch {
      return pathOf(resource);
    }
  }

  function clip(text, n = 22) {
    const value = String(text || "");
    return value.length > n ? `${value.slice(0, n - 1)}…` : value;
  }

  function idleLoopSteps() {
    const fund = fundingHow();
    return [
      { id: "need", label: "Need", detail: "paid resource", status: "todo" },
      { id: "challenge", label: "x402", detail: "asked asset", status: "todo" },
      { id: "wallet", label: "Wallet", detail: "wrong or short", status: "todo" },
      { id: "deficit", label: "Deficit", detail: "exact missing", status: "todo" },
      { id: "acquire", label: "DFlow", detail: fund.short, status: "todo" },
      { id: "pay", label: "Pay", detail: "settle 402", status: "todo" },
      { id: "continue", label: "Continue", detail: "retry request", status: "todo" },
    ];
  }

  function renderLoopStrip(steps) {
    return `<ol class="loop-strip" aria-label="Need, x402, wallet, deficit, DFlow, pay, continue">${steps
      .map(
        (step) =>
          `<li class="${esc(step.status)}"><span>${esc(step.label)}</span><small>${esc(step.detail)}</small></li>`,
      )
      .join("")}</ol>`;
  }

  function loopModel(row, record) {
    const intent = record?.intent || row;
    const mint = intent.assetMint;
    const asked = Number(intent.amountAtomic || row.amountAtomic || 0);
    const heldRow = state.balances.find((item) => item.mint === mint);
    const liveHeld = heldRow ? Number(heldRow.balanceAtomic) : NaN;
    const submitted = findLastEvent(record, ["funding.submitted", "funding.attempt_locked"]);
    const confirmed = findEvent(record, "funding.confirmed");
    const notRequired = findEvent(record, "funding.not_required");
    const paySubmitted = findEvent(record, "payment.submitted");
    const settled = findLastEvent(record, ["payment.settled", "payment.token_issued"]);
    const fulfilled = findEvent(record, "resource.fulfilled");
    const fulfillFail = findEvent(record, "resource.fulfillment_failed");
    const source = pickFundingRow(mint);
    const st = row.state;
    const inflight = ["discovered", "approval_required", "approved", "funding_submitted"].includes(st);
    let deficit;
    let deficitKnown = true;
    if (notRequired) deficit = 0;
    else if (submitted?.details?.deficitAtomic != null) {
      deficit = Number(submitted.details.deficitAtomic);
    } else if (confirmed?.details?.outputAmountAtomic != null) {
      deficit = Number(confirmed.details.outputAmountAtomic);
    } else if (inflight && Number.isFinite(liveHeld) && asked > 0) {
      deficit = Math.max(0, asked - liveHeld);
    } else {
      deficit = 0;
      deficitKnown = Boolean(notRequired);
    }
    const alreadyHeld = Boolean(notRequired) || (deficitKnown && deficit <= 0);
    const fund = fundingHow();
    const access = accessPath(intent, row);
    const halted = st === "denied" || st === "failed";
    let current = "need";
    if (fulfilled || st === "fulfilled") current = "continue";
    else if (st === "paid" || st === "fulfillment_failed" || fulfillFail) current = "continue";
    else if (st === "payment_submitted" || settled || paySubmitted) current = "pay";
    else if (st === "funded") current = "pay";
    else if (st === "funding_submitted" || confirmed) current = "acquire";
    else if (st === "approved") current = alreadyHeld ? "pay" : "acquire";
    else if (st === "approval_required" || st === "discovered") current = alreadyHeld ? "pay" : "deficit";
    const order = ["need", "challenge", "wallet", "deficit", "acquire", "pay", "continue"];
    const currentIdx = order.indexOf(current);
    const statusOf = (id) => {
      const idx = order.indexOf(id);
      if (fulfilled && id === "continue") return "done";
      if (id === "acquire" && alreadyHeld && currentIdx >= order.indexOf("pay")) return "skip";
      if (id === "acquire" && alreadyHeld && (st === "approval_required" || st === "discovered")) {
        return "skip";
      }
      if (halted && idx === currentIdx) return "halt";
      if (idx < currentIdx) return "done";
      if (idx === currentIdx) {
        if (st === "approval_required" && id === "pay") return "wait";
        return "now";
      }
      if (st === "approval_required" && id === "acquire" && !alreadyHeld) return "wait";
      return "todo";
    };
    const inputMint = submitted?.details?.inputMint || confirmed?.details?.inputMint || source?.mint;
    const fromLabel = inputMint
      ? source && source.mint === inputMint
        ? tokenAmount(source)
        : assetLabel(inputMint)
      : "no allowed funding asset";
    const steps = [
      { id: "need", label: "Need", detail: clip(access, 20) || "resource", status: statusOf("need") },
      { id: "challenge", label: "x402", detail: formatAssetAmount(asked, mint), status: statusOf("challenge") },
      {
        id: "wallet",
        label: "Wallet",
        detail: Number.isFinite(liveHeld) ? formatAssetAmount(liveHeld, mint) : "unknown",
        status: statusOf("wallet"),
      },
      {
        id: "deficit",
        label: "Deficit",
        detail: !deficitKnown && !inflight ? "—" : alreadyHeld ? "none" : formatAssetAmount(deficit, mint),
        status: statusOf("deficit"),
      },
      {
        id: "acquire",
        label: "DFlow",
        detail: alreadyHeld ? "not needed" : confirmed ? "acquired" : fund.short,
        status: statusOf("acquire"),
      },
      {
        id: "pay",
        label: "Pay",
        detail: settled ? "paid" : paySubmitted ? "submitted" : st === "funded" ? "ready" : "402",
        status: statusOf("pay"),
      },
      {
        id: "continue",
        label: "Continue",
        detail: fulfilled ? "delivered" : fulfillFail ? "retry fulfill" : "retry",
        status: statusOf("continue"),
      },
    ];
    const heroAtomic = alreadyHeld || fulfilled || st === "fulfilled" || ["paid", "payment_submitted", "funded", "denied", "failed", "fulfillment_failed"].includes(st)
      ? asked
      : deficit;
    const hero =
      mint === USDC ? money(String(Math.round(heroAtomic || 0))) : formatAssetAmount(heroAtomic, mint);
    let kicker = STATES[st] || st;
    let amountLabel = `${assetLabel(mint)} x402 amount`;
    if (st === "denied") {
      kicker = "Rejected";
      amountLabel = "this 402 will not be paid";
    } else if (st === "failed") {
      kicker = "Failed";
      amountLabel = "this 402 stopped before the original request continued";
    } else if (fulfilled || st === "fulfilled") {
      kicker = "Original request continued";
      amountLabel = "402 paid · resource delivered";
    } else if (st === "fulfillment_failed") {
      kicker = "Paid — resource not delivered";
      amountLabel = "retry fulfill on the same id";
    } else if (st === "paid") {
      kicker = "Paid — deliver the resource";
      amountLabel = "original request can continue";
    } else if (st === "payment_submitted") {
      kicker = "Paying the 402";
      amountLabel = "same payment id — no second pay";
    } else if (st === "funded") {
      kicker = "Ready to pay the 402";
      amountLabel = "payment asset is in the wallet";
    } else if (st === "funding_submitted") {
      kicker = "Acquiring the exact deficit";
      amountLabel = `buy only ${formatAssetAmount(deficit, mint)} via ${fund.acquire}`;
    } else if (alreadyHeld) {
      kicker = st === "approval_required" ? "Wallet already holds the asset" : kicker;
      amountLabel = "x402 amount — no swap needed";
    } else if (st === "approval_required") {
      kicker = "Short the payment asset";
      amountLabel = `exact ${assetLabel(mint)} deficit — buy only this, then pay the 402`;
    }
    let stepNow = openLoopCopy(row, record);
    if (st === "approval_required" && !alreadyHeld) {
      stepNow = `Waiting for you before ${fund.acquire} buys ${formatAssetAmount(deficit, mint)} from ${fromLabel}. Then AgentTab pays the 402 and retries the original request.`;
    } else if (st === "approval_required" && alreadyHeld) {
      stepNow = `Wallet already holds ${formatAssetAmount(asked, mint)}. Approving pays the 402 and retries the original request — no swap.`;
    } else if (st === "funding_submitted") {
      stepNow = `Funding paused on this same id. Resume acquires only the remaining deficit via ${fund.acquire}.`;
    } else if (st === "funded") {
      stepNow = "Deficit is in the wallet. Resume pays this 402; it will not mint a second payment.";
    } else if (st === "payment_submitted") {
      stepNow = "Payment was submitted. Resume confirms the same 402; it will not pay twice.";
    } else if (st === "paid") {
      stepNow = "Merchant was paid. Resume marks the original resource as delivered so the agent can continue.";
    } else if (st === "fulfillment_failed") {
      stepNow = "Paid, but the resource was not marked delivered. Resume retries fulfill only.";
    } else if (fulfilled || st === "fulfilled") {
      stepNow = "The original request continued after the 402 was paid.";
    }
    return {
      intent,
      mint,
      asked,
      deficit,
      alreadyHeld,
      access,
      hero,
      kicker,
      amountLabel,
      lead: `The agent needs ${access || "this resource"}. The merchant's x402 asked for ${formatAssetAmount(asked, mint)}. Wallet holds ${walletLine()}.`,
      stepNow,
      steps,
      rail: railFor(intent.network || row.network),
      fund,
    };
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
    const mode = modeLabel(state.policy?.mode || health.policyMode || boot.policyMode);
    const fund = fundingHow();
    const notifySigned = health.notifySigned;
    const alerts = health.notifyConfigured
      ? notifySigned
        ? " · signed alerts"
        : " · alerts on"
      : "";
    $("stance").innerHTML = `${esc(fund.honest)} · ${esc(walletLine())} · <strong>${esc(mode)}</strong> · spent <strong>${esc(used)}</strong> of <strong>${esc(daily)}</strong> today${esc(alerts)}`;
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
      const fund = fundingHow();
      root.innerHTML = `
        <div class="empty">
          <h2>No 402 in flight</h2>
          <p>When an agent hits a paid resource and the wallet is short the asked asset, AgentTab computes the exact deficit, acquires only that amount, pays the 402, and retries the original request. That loop appears here.</p>
          ${renderLoopStrip(idleLoopSteps())}
          <p class="meaning">Until then, agents only spend what Policy already allows.</p>
        </div>`;
      return;
    }
    root.innerHTML = state.nowItems
      .map((row) => {
        const record = state.detail[row.operationId];
        const loop = loopModel(row, record);
        const intent = loop.intent;
        const amount = money(intent.amountUsdMicros || row.amountUsdMicros || row.amountAtomic);
        const parked = row.state === "approval_required";
        const pending = state.pending?.id === row.operationId;
        const confirm = pending
          ? `<div class="confirm-copy">${
              state.pending.act === "approve"
                ? loop.alreadyHeld
                  ? "Approve pays this 402 from the asset already in the wallet, then retries the original request. No swap. Observe is not a dry-run."
                  : `Approve buys only ${loop.steps.find((step) => step.id === "deficit")?.detail || "the exact deficit"} via ${loop.fund.acquire}, pays this 402, and retries the original request. Observe is not a dry-run.`
                : state.pending.act === "resume"
                  ? "Resume continues this same 402 — acquire, pay, or deliver the next unfinished step. It will not start a second payment."
                  : "Reject is final. This 402 will not be funded or paid, and the id cannot be reused."
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
            <p class="kicker">${esc(loop.kicker)}</p>
            <p class="amount">${esc(loop.hero)}</p>
            <p class="amount-label">${esc(loop.amountLabel)}</p>
            <p class="lead">${esc(loop.lead)}</p>
            ${renderLoopStrip(loop.steps)}
            <p class="step-now">${esc(loop.stepNow)}</p>
            ${
              parked
                ? `<p class="meaning">${esc(parkedReason(row, record))}</p>`
                : ""
            }
            ${confirm}
            <dl class="facts">
              <dt>Rail</dt><dd>${esc(loop.rail)}</dd>
              <dt>Merchant</dt><dd>${esc(intent.merchantOrigin)}</dd>
              <dt>Access</dt><dd>${esc(loop.access)}</dd>
              <dt>x402</dt><dd>${esc(amount)} ${esc(assetLabel(intent.assetMint))}</dd>
            </dl>
            <details class="ref"><summary>Reference</summary><p class="id">${esc(row.operationId)}</p></details>
          </article>`;
      })
      .join("");
  }

  function renderLedger() {
    const root = $("ledger-list");
    if (!state.recent.length) {
      root.innerHTML = `
        <div class="empty">
          <h2>No 402s yet</h2>
          <p>Each row is one original request: the asset the merchant asked for, the exact deficit AgentTab bought, whether the 402 paid, and whether the agent continued.</p>
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
        const loop = loopModel(row, open || row);
        const loopLine = loop.alreadyHeld
          ? `x402 ${formatAssetAmount(loop.asked, loop.mint)} · no swap · ${loop.fund.short}`
          : loop.deficit > 0
            ? `x402 asked ${formatAssetAmount(loop.asked, loop.mint)} · deficit ${formatAssetAmount(loop.deficit, loop.mint)} · ${loop.fund.short}`
            : `x402 asked ${formatAssetAmount(loop.asked, loop.mint)} · ${loop.fund.short}`;
        return `
          <article class="entry" data-id="${esc(row.operationId)}">
            <div class="state">${esc(loop.kicker)}</div>
            <div>
              <div>${esc(originHost(row.merchantOrigin))} · ${esc(pathOf(row.resource))}</div>
              <div class="sub">${esc(loopLine)}</div>
              <div class="sub">${esc(when(row.updatedAt))} · ${esc(loop.rail)}</div>
            </div>
            <div class="amount">${esc(loop.hero)}</div>
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
      await loadDetails([...state.nowItems, ...state.recent]);
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

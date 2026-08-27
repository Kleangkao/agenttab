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
    spotlightId: null,
    busy: false,
    ledgerFilter: "all",
    ledgerFilterTouched: false,
    openDetails: new Set(),
    openTrail: new Set(),
  };

  const DEMO_LEDGER_CAP = 4;

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
    "policy.denied": "Live policy refused this payment",
    "funding.submitted": "Buying only the exact deficit",
    "funding.attempt_locked": "Funding attempt locked",
    "funding.plan_receipt": "Funding plan received",
    "funding.failed": "Funding failed",
    "funding.no_candidate": "No allowed funding asset available",
    "funding.signer_failed": "Funding paused; same payment can retry",
    "funding.confirm_interrupted": "Funding needs confirmation; same payment can retry",
    "funding.balances_applied": "Wallet balances updated",
    "funding.confirmed": "Deficit acquired — wallet can pay the 402",
    "funding.not_required": "Wallet already held the payment asset",
    "payment.submitted": "Paying the 402",
    "payment.settled": "Merchant was paid",
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
    parked_approval_expired: "This parked approval expired. It cannot be funded.",
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

  function tokenUi(row) {
    const atomic = Number(row.balanceAtomic);
    if (!Number.isFinite(atomic)) return String(row.balanceAtomic ?? "—");
    const decimals = row.symbol === "SOL" ? 9 : 6;
    return (atomic / 10 ** decimals).toLocaleString(undefined, {
      maximumFractionDigits: 4,
    });
  }

  /** A local demo merchant reads as an address; give it a name instead. */
  function merchantName(origin) {
    const host = originHost(origin);
    return host === "127.0.0.1:8791" || host === "localhost:8791"
      ? "Local demo merchant"
      : host;
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
  const MAINNET_DFLOW_TX =
    "https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg";
  const MAINNET_X402_TX =
    "https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR";

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
        badge: "LOCAL MOCK",
        badgeClass: "mock",
      };
    }
    if (mode === "live-sim") {
      const live = Boolean(state.health?.broadcastEnabled);
      return {
        short: "DFlow sim",
        acquire: "DFlow simulated send",
        honest: live
          ? "DFlow live sim — broadcasting enabled"
          : "DFlow live quote, simulated send — not broadcasting unless enabled",
        badge: live ? "MAINNET LIVE" : "DFLOW SIM",
        badgeClass: live ? "live" : "sim",
      };
    }
    if (mode === "live-quote") {
      return {
        short: "DFlow quote",
        acquire: "DFlow live quote",
        honest: "DFlow live quote — plan only, not broadcasting",
        badge: "DFLOW QUOTE",
        badgeClass: "sim",
      };
    }
    if (mode === "devnet-mint") {
      return {
        short: "Devnet mint",
        acquire: "Devnet mint stand-in",
        honest: "Devnet mint stand-in — not DFlow",
        badge: "DEVNET",
        badgeClass: "devnet",
      };
    }
    return {
      short: mode || "gateway",
      acquire: "funding coordinator",
      honest: mode || "gateway",
      badge: (mode || "GATEWAY").toUpperCase(),
      badgeClass: "sim",
    };
  }

  function isDemoMode() {
    return state.health?.fundingMode === "mock";
  }

  /** Expired parked approvals cannot be funded, so they are not "waiting on you". */
  function isWaitingOnYou(row) {
    return row.state === "approval_required" && row.parkedExpired !== true;
  }

  function demoSummary(loop, row) {
    // The endpoint belongs in Technical details; here, name the agent's task.
    const task = loop.taskPurpose || "the request";
    if (row.state === "fulfilled" || loop.result) {
      return `${task} completed after AgentTab covered the missing amount and paid the merchant.`;
    }
    if (row.state === "approval_required" && !loop.alreadyHeld) {
      return `Wallet is short ${loop.deficitLabel}. Approve once — AgentTab covers only that, pays the merchant, and the request continues.`;
    }
    if (row.state === "approval_required" && loop.alreadyHeld) {
      return `Wallet already has ${loop.askedLabel}. Approve to pay the merchant and continue.`;
    }
    return loop.stepNow;
  }

  function isOnChainSignature(signature) {
    if (!signature || typeof signature !== "string") return false;
    if (
      signature.startsWith("pending-") ||
      signature.startsWith("sim-fund-") ||
      signature.startsWith("local-signed-nobroadcast-") ||
      signature.startsWith("resumed-") ||
      signature.startsWith("local-")
    ) {
      return false;
    }
    return /^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(signature);
  }

  function explorerTxUrl(network, signature) {
    if (!isOnChainSignature(signature)) return null;
    const base = `https://solscan.io/tx/${encodeURIComponent(signature)}`;
    if (network === "solana:devnet") return `${base}?cluster=devnet`;
    if (network === "solana:mainnet" || network === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") {
      return base;
    }
    return null;
  }

  function chainProofFromRecord(record, row) {
    const network = record?.intent?.network || row?.network;
    const events = record?.events || [];
    const funding = events.find((event) => event.kind === "funding.confirmed");
    const payment = events.find((event) => event.kind === "payment.settled");
    const token = events.find((event) => event.kind === "payment.token_issued");
    const fundingSig = funding?.details?.signature;
    const paymentSig =
      payment?.details?.transaction ||
      payment?.details?.settlementId ||
      token?.details?.settlementId;
    return {
      network,
      funding: {
        signature: fundingSig,
        url: explorerTxUrl(network, fundingSig),
        label: "DFlow exact-deficit",
      },
      payment: {
        signature: paymentSig,
        url: explorerTxUrl(network, paymentSig),
        label: payment ? "x402 pay" : token ? "local payment token" : "x402 pay",
        local: Boolean(token && !payment),
      },
    };
  }

  function renderChainProof(record, row) {
    const proof = chainProofFromRecord(record, row);
    const parts = [];
    if (proof.funding.url) {
      parts.push(
        `<a href="${esc(proof.funding.url)}" target="_blank" rel="noopener">${esc(proof.funding.label)}</a>`,
      );
    } else if (proof.funding.signature && !isOnChainSignature(proof.funding.signature)) {
      parts.push(`${esc(proof.funding.label)} (mock)`);
    }
    if (proof.payment.url) {
      parts.push(
        `<a href="${esc(proof.payment.url)}" target="_blank" rel="noopener">${esc(proof.payment.label)}</a>`,
      );
    } else if (proof.payment.local) {
      parts.push("local HMAC pay");
    } else if (proof.payment.signature && !isOnChainSignature(proof.payment.signature)) {
      parts.push(`${esc(proof.payment.label)} (mock)`);
    }
    if (!parts.length) return "";
    return `<p class="chain-proof"><strong>Proof:</strong> ${parts.join(" → ")}</p>`;
  }

  function renderModeBadge() {
    const badge = $("mode-badge");
    if (!badge) return;
    const fund = fundingHow();
    badge.textContent = fund.badge;
    badge.className = `mode-badge ${fund.badgeClass}`;
    badge.title = fund.honest;
    const note = $("mode-note");
    if (note) note.textContent = fund.honest;
  }

  function renderJudgeStats() {
    const root = $("judge-stats");
    if (!root) return;
    const health = state.health || {};
    const spend = state.spend || {};
    const waiting = state.nowItems.filter(isWaitingOnYou).length;
    const mode = modeLabel(state.policy?.mode || health.policyMode || boot.policyMode);
    const wallet =
      state.balances
        .map(
          (row) =>
            `<div class="rail-stat"><span>${esc(row.symbol || assetLabel(row.mint))}</span><strong>${esc(tokenUi(row))}</strong></div>`,
        )
        .join("") || `<div class="rail-stat"><span>balances</span><strong>—</strong></div>`;
    root.hidden = false;
    // Mock spend is not real spend, and a public demo accumulates it across
    // visitors. Showing a cap there reads as "this demo is running out".
    if (isDemoMode()) {
      root.innerHTML = `
        <div class="rail-block">
          <h2>Wallet</h2>
          ${wallet}
        </div>
        <div class="rail-block">
          <h2>Policy</h2>
          <div class="rail-stat"><span>Mode</span><strong>${esc(mode)}</strong></div>
          <div class="rail-stat"><span>Waiting on you</span><strong>${waiting || "0"}</strong></div>
        </div>`;
      return;
    }
    const used = spend.spentUsdMicrosLast24h ?? health.spentUsdMicrosLast24h ?? 0;
    const reserved = spend.reservedUsdMicros ?? health.reservedUsdMicros ?? 0;
    const daily = spend.maxDailyUsdMicros ?? health.maxDailyUsdMicros ?? 0;
    root.innerHTML = `
      <div class="rail-block">
        <h2>Wallet</h2>
        ${wallet}
      </div>
      <div class="rail-block">
        <h2>Spend</h2>
        <div class="rail-stat"><span>Spent today</span><strong>${esc(money(used))}</strong></div>
        <div class="rail-stat"><span>Held in flight</span><strong>${esc(money(reserved))}</strong></div>
        <div class="rail-stat"><span>Daily cap</span><strong>${esc(money(daily))}</strong></div>
        <div class="rail-stat"><span>Waiting on you</span><strong>${waiting || "0"}</strong></div>
      </div>`;
  }

  function renderJudgeLanding() {
    const fund = fundingHow();
    return `
      <section class="judge-proof">
        <h3>Already proven on Solana Mainnet</h3>
        <p>This screen does not spend on Mainnet. The same loop already settled on-chain:</p>
        <p class="judge-links">
          <a href="${MAINNET_DFLOW_TX}" target="_blank" rel="noopener">Exact-deficit DFlow tx</a>
          <span aria-hidden="true">→</span>
          <a href="${MAINNET_X402_TX}" target="_blank" rel="noopener">x402 pay tx</a>
          <span aria-hidden="true">→</span>
          original request continued
        </p>
        <p class="judge-hint">Local: run <code>pnpm demo:stack</code>.</p>
      </section>`;
  }

  function verdictFor(rows) {
    // Live waiting wins over expired so the banner matches "Waiting on you".
    const waiting = rows.find(isWaitingOnYou);
    if (waiting) {
      const record = state.detail[waiting.operationId];
      const alreadyHeld = record ? loopModel(waiting, record).alreadyHeld : false;
      if (alreadyHeld) {
        return {
          tone: "",
          state: "Ready to pay",
          line: "The wallet already holds the exact asset the merchant asked for.",
          why: "DFlow is not invoked here: AgentTab swaps only when the payment asset is missing.",
        };
      }
      return {
        tone: "",
        state: "Action required",
        line: "An agent hit a paid API. The wallet is short the exact asset the merchant asked for.",
        why: "DFlow is required here: without the exact-deficit swap, the agent stops at insufficient funds.",
      };
    }
    const expired = rows.find(
      (row) => row.state === "approval_required" && row.parkedExpired === true,
    );
    if (expired) {
      return {
        tone: "is-halt",
        state: "Expired",
        line: "This approval sat past its time limit, so it can no longer be funded.",
        why: "AgentTab expires parked approvals rather than paying on stale intent. Reject it, or start a new request.",
      };
    }
    if (rows.some((row) => row.state === "denied" || row.state === "failed")) {
      return {
        tone: "is-halt",
        state: "Stopped",
        line: "This payment will not be funded, so the agent does not continue.",
        why: "AgentTab fails closed when the payment falls outside the operator's policy.",
      };
    }
    if (rows.some((row) => row.state !== "fulfilled")) {
      return {
        tone: "",
        state: "Running",
        line: "Buying only the deficit, then paying the merchant and continuing the same request.",
        why: "The DFlow acquisition remains bound to this payment and its exact deficit.",
      };
    }
    if (rows.length) {
      return {
        tone: "is-done",
        state: "Done",
        line: "The agent got what it asked for. One request, one payment, no swap UI.",
        why: "One audit trail ties the DFlow action, x402 payment, and fulfilled response together.",
      };
    }
    return {
      tone: "",
      state: "Idle",
      line: "Waiting for an agent to hit a paid resource.",
      why: "If the requested payment asset is missing, AgentTab will acquire only the exact deficit.",
    };
  }

  function renderVerdict(rows) {
    const root = $("verdict");
    if (!root) return;
    const verdict = verdictFor(rows);
    root.innerHTML = `
      <section class="verdict ${esc(verdict.tone)}">
        <span class="verdict-state">${esc(verdict.state)}</span>
        <p class="verdict-line">${esc(verdict.line)}</p>
        <p class="verdict-why">${esc(verdict.why)}</p>
      </section>`;
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

  function idleStoryBeats() {
    const fund = fundingHow();
    return [
      { id: "resource", label: "Paid request", title: "Agent needs a paid resource", detail: "The original HTTP request", status: "todo" },
      { id: "asked", label: "Merchant asks", title: "Merchant asks for a specific asset", detail: "x402 names the exact token and amount", status: "todo" },
      { id: "missing", label: "Wallet short", title: "Wallet is missing that asset", detail: "Enough value, wrong or short balance", status: "todo" },
      { id: "buy", label: "Buy deficit", title: "Buy only the exact deficit", detail: fund.honest, status: "todo" },
      { id: "finish", label: "Pay & continue", title: "Pay and continue the original request", detail: "Same resource, no second payment", status: "todo" },
    ];
  }

  function renderStory(beats) {
    const active =
      beats.find((beat) => ["now", "wait", "halt"].includes(beat.status)) ||
      [...beats].reverse().find((beat) => beat.status === "done") ||
      beats[0];
    const nodes = beats
      .map(
        (beat, index) =>
          `<li class="flow-node ${esc(beat.status)}" title="${esc(beat.title)}"><span class="node-dot" aria-hidden="true">${index + 1}</span><span class="node-label">${esc(beat.label || beat.title)}</span></li>`,
      )
      .join("");
    return `<div class="flow">
      <ol class="flow-track" aria-label="Paid resource, missing asset, exact deficit, pay, continue">${nodes}</ol>
      <p class="flow-detail"><strong>${esc(active.title)}</strong> · ${esc(active.detail)}</p>
    </div>`;
  }

  /** The hero: held → asked → deficit. One number cannot show "exact deficit". */
  function renderDeficit(loop) {
    const held = `<div class="deficit-term"><span class="deficit-value">${esc(loop.heldLabel)}</span><span class="deficit-key">wallet holds</span></div>`;
    if (loop.alreadyHeld) {
      return `<div class="deficit">${held}
        <span class="deficit-op" aria-hidden="true">→</span>
        <div class="deficit-term is-buy"><span class="deficit-value">${esc(loop.askedLabel)}</span><span class="deficit-key">x402 ask · no DFlow buy</span></div>
      </div>`;
    }
    return `<div class="deficit">${held}
      <span class="deficit-op" aria-hidden="true">→</span>
      <div class="deficit-term"><span class="deficit-value">${esc(loop.askedLabel)}</span><span class="deficit-key">x402 ask</span></div>
      <span class="deficit-op" aria-hidden="true">=</span>
      <div class="deficit-term is-buy"><span class="deficit-value">${esc(loop.deficitLabel)}</span><span class="deficit-key">exact deficit</span></div>
    </div>`;
  }

  function loopModel(row, record) {
    const intent = record?.intent || row;
    const taskPurpose = intent?.taskContext?.purpose;
    const taskStepLabel = intent?.taskContext?.stepLabel;
    const mint = intent.assetMint;
    const asked = Number(intent.amountAtomic || row.amountAtomic || 0);
    const heldRow = state.balances.find((item) => item.mint === mint);
    const liveHeld = heldRow ? Number(heldRow.balanceAtomic) : NaN;
    const submitted = findLastEvent(record, ["funding.submitted", "funding.attempt_locked"]);
    const confirmed = findEvent(record, "funding.confirmed");
    const planReceipt = findEvent(record, "funding.plan_receipt");
    const notRequired = findEvent(record, "funding.not_required");
    const fulfilled = findEvent(record, "resource.fulfilled");
    const source = pickFundingRow(mint);
    const st = row.state;
    const inflight = ["discovered", "approval_required", "approved", "funding_submitted"].includes(st);
    const historicalDeficit =
      submitted?.details?.deficitAtomic ??
      confirmed?.details?.outputAmountAtomic ??
      planReceipt?.details?.outputAmountAtomic;
    let deficit = 0;
    let deficitKnown = false;
    if (notRequired) {
      deficit = 0;
      deficitKnown = true;
    } else if (historicalDeficit != null && historicalDeficit !== "") {
      deficit = Number(historicalDeficit);
      deficitKnown = Number.isFinite(deficit);
    } else if (inflight && Number.isFinite(liveHeld) && asked > 0) {
      deficit = Math.max(0, asked - liveHeld);
      deficitKnown = true;
    }
    // A later live balance must not rewrite a completed DFlow buy into
    // "bought none". alreadyHeld is audit `funding.not_required`, or an
    // in-flight wallet that already covers the ask before any buy.
    const alreadyHeld =
      Boolean(notRequired) || (deficitKnown && deficit <= 0 && historicalDeficit == null);
    const fund = fundingHow();
    const access = accessPath(intent, row);
    const halted = st === "denied" || st === "failed";
    const inputMint = submitted?.details?.inputMint || confirmed?.details?.inputMint || source?.mint;
    const fromLabel = inputMint
      ? source && source.mint === inputMint
        ? tokenAmount(source)
        : assetLabel(inputMint)
      : "no allowed funding asset";
    const askedLabel = formatAssetAmount(asked, mint);
    const deficitLabel = alreadyHeld
      ? "none"
      : deficitKnown
        ? formatAssetAmount(deficit, mint)
        : "the exact deficit";
    const heldLabel = Number.isFinite(liveHeld) ? formatAssetAmount(liveHeld, mint) : "unknown";
    const beatOrder = ["resource", "asked", "missing", "buy", "finish"];
    let currentBeat = "resource";
    if (fulfilled || st === "fulfilled" || st === "paid" || st === "fulfillment_failed") currentBeat = "finish";
    else if (st === "funded" || st === "payment_submitted") currentBeat = "finish";
    else if (st === "funding_submitted" || confirmed) currentBeat = "buy";
    else if (st === "approved") currentBeat = alreadyHeld ? "finish" : "buy";
    else if (st === "approval_required" || st === "discovered") currentBeat = alreadyHeld ? "finish" : "missing";
    const currentBeatIdx = beatOrder.indexOf(currentBeat);
    const beatStatus = (id) => {
      const idx = beatOrder.indexOf(id);
      if ((fulfilled || st === "fulfilled") && id === "finish") return "done";
      if (id === "buy" && alreadyHeld && currentBeatIdx >= beatOrder.indexOf("finish")) return "skip";
      if (id === "buy" && alreadyHeld && (st === "approval_required" || st === "discovered")) return "skip";
      if (halted && idx === currentBeatIdx) return "halt";
      if (idx < currentBeatIdx) return "done";
      if (idx === currentBeatIdx) {
        if (st === "approval_required") return "wait";
        return "now";
      }
      if (st === "approval_required" && id === "buy" && !alreadyHeld) return "wait";
      return "todo";
    };
    const beats = [
      {
        id: "resource",
        label: "Paid request",
        title: "Agent needs a paid resource",
        detail: access || "the original request",
        status: beatStatus("resource"),
      },
      {
        id: "asked",
        label: "Merchant asks",
        title: "Merchant asked for this asset",
        detail: `${askedLabel} via x402`,
        status: beatStatus("asked"),
      },
      {
        id: "missing",
        label: alreadyHeld ? "Already held" : "Wallet short",
        title:
          fulfilled || st === "fulfilled" || st === "paid"
            ? alreadyHeld
              ? "Wallet already held that asset"
              : "Wallet was missing that asset"
            : alreadyHeld
              ? "Wallet already holds that asset"
              : "Wallet is missing that asset",
        detail:
          fulfilled || st === "fulfilled"
            ? alreadyHeld
              ? `${askedLabel} was already in the wallet`
              : `Was short ${deficitLabel}; AgentTab bought only that`
            : alreadyHeld
              ? `${heldLabel} — no buy needed`
              : `${heldLabel} held · ${deficitLabel} missing`,
        status: beatStatus("missing"),
      },
      {
        id: "buy",
        label: alreadyHeld ? "No buy" : "Buy deficit",
        title: alreadyHeld ? "No DFlow buy" : "Buy only the exact deficit",
        detail: alreadyHeld
          ? "Skip — pay from the balance already in the wallet"
          : confirmed
            ? `Acquired ${deficitLabel} via ${fund.acquire}`
            : `${deficitLabel} via ${fund.honest}`,
        status: beatStatus("buy"),
      },
      {
        id: "finish",
        label: "Pay & continue",
        title:
          fulfilled || st === "fulfilled"
            ? "Original request continued"
            : "Pay the merchant and continue the original request",
        detail:
          fulfilled || st === "fulfilled"
            ? `Agent received ${access || "the resource"}`
            : `Pay ${askedLabel}, then retry ${access || "the same request"}`,
        status: beatStatus("finish"),
      },
    ];
    const heroAtomic = alreadyHeld || fulfilled || st === "fulfilled" || ["paid", "payment_submitted", "funded", "denied", "failed", "fulfillment_failed"].includes(st)
      ? asked
      : deficit;
    const hero =
      mint === USDC ? money(String(Math.round(heroAtomic || 0))) : formatAssetAmount(heroAtomic, mint);
    const result = fulfilled || st === "fulfilled" ? access || "resource delivered" : "";
    let kicker = STATES[st] || st;
    let amountLabel = `${assetLabel(mint)} asked by the merchant`;
    if (st === "denied") {
      const last = record?.events?.at(-1);
      const policyAfterApprove =
        last?.kind === "policy.denied" && last.details?.afterApproval === true;
      kicker = policyAfterApprove
        ? "Policy denied this after approval"
        : last?.kind === "policy.denied"
          ? "Rejected by policy"
          : "Rejected";
      amountLabel = policyAfterApprove
        ? "approval does not override a hard policy denial"
        : "this request will not be paid";
    } else if (st === "failed") {
      kicker = "Funding failed";
      amountLabel = "policy allowed this; funding did not finish";
    } else if (fulfilled || st === "fulfilled") {
      kicker = "Completed";
      amountLabel = alreadyHeld
        ? `paid ${askedLabel} · original request continued`
        : `bought ${deficitLabel} · paid ${askedLabel} · original request continued`;
    } else if (st === "fulfillment_failed") {
      kicker = "Paid — resource not delivered";
      amountLabel = "continue the same request — do not pay again";
    } else if (st === "paid") {
      kicker = "Merchant was paid";
      amountLabel = "continue the original request";
    } else if (st === "payment_submitted") {
      kicker = "Paying the merchant";
      amountLabel = "same payment — no second pay";
    } else if (st === "funded") {
      kicker = "Missing asset is in the wallet";
      amountLabel = "ready to pay the merchant and continue";
    } else if (st === "funding_submitted") {
      kicker = "Buying only the missing amount";
      amountLabel = `${deficitLabel} via ${fund.acquire}`;
    } else if (alreadyHeld) {
      kicker = st === "approval_required" ? "Wallet can pay — waiting for you" : kicker;
      amountLabel = "no DFlow buy — pay and continue";
    } else if (st === "approval_required") {
      kicker = row.parkedExpired ? "Parked approval expired" : "Action required";
      amountLabel = row.parkedExpired
        ? "this request can no longer be funded"
        : `${deficitLabel} missing — buy only this, then continue`;
    }
    let stepNow = openLoopCopy(row, record);
    if (st === "approval_required" && row.parkedExpired) {
      stepNow = `This parked approval expired after the policy TTL. It cannot be funded. Reject it, or wait for a new request.`;
    } else if (st === "approval_required" && !alreadyHeld) {
      stepNow = `The agent cannot fetch ${access || "this resource"} until the wallet holds ${askedLabel}. AgentTab will buy only ${deficitLabel} from ${fromLabel} via ${fund.honest}, pay the merchant, and retry the same request.`;
    } else if (st === "approval_required" && alreadyHeld) {
      stepNow = `Wallet already holds ${askedLabel}. Confirming pays the merchant and retries ${access || "the original request"} — no DFlow buy.`;
    } else if (st === "funding_submitted") {
      stepNow = `Buying ${deficitLabel} paused on this same request. Continue acquires only the remaining deficit via ${fund.acquire}.`;
    } else if (st === "funded") {
      stepNow = `${deficitLabel} is in the wallet. Continue pays ${askedLabel} and retries ${access || "the original request"} — it will not buy or pay twice.`;
    } else if (st === "payment_submitted") {
      stepNow = `Payment was submitted. Continue confirms the same pay and retries ${access || "the original request"}.`;
    } else if (st === "paid") {
      stepNow = `Merchant was paid ${askedLabel}. Continue marks ${access || "the resource"} delivered so the agent can proceed.`;
    } else if (st === "fulfillment_failed") {
      stepNow = `Paid, but ${access || "the resource"} was not marked delivered. Continue retries delivery only.`;
    } else if (st === "denied") {
      const last = record?.events?.at(-1);
      stepNow =
        last?.kind === "policy.denied" && last.details?.afterApproval === true
          ? `Live policy denied this after you approved (${reasonText(last.details?.reason, last.details?.reason || "hard denial")}). This id will not fund.`
          : last?.kind === "policy.denied"
            ? `Live policy denied this payment (${reasonText(last.details?.reason, last.details?.reason || "hard denial")}).`
            : "You rejected this payment. It will not be funded or paid.";
    } else if (st === "failed") {
      stepNow = `Funding failed before the original request continued. Policy had allowed this payment; the buy did not finish.`;
    } else if (fulfilled || st === "fulfilled") {
      stepNow = `The agent got ${access || "the resource"} after AgentTab ${alreadyHeld ? "paid" : `bought ${deficitLabel} and paid`} ${askedLabel}.`;
    }

    if (taskPurpose) {
      stepNow = `Agent task: ${taskPurpose}${taskStepLabel ? ` · ${taskStepLabel}` : ""}. ${stepNow}`;
    }
    return {
      intent,
      mint,
      asked,
      deficit,
      alreadyHeld,
      access,
      askedLabel,
      deficitLabel,
      heldLabel,
      fromLabel,
      hero,
      result,
      kicker,
      amountLabel,
      lead: "",
      taskPurpose,
      taskStepLabel,
      stepNow,
      beats,
      rail: railFor(intent.network || row.network),
      fund,
    };
  }

  function modeLabel(mode) {
    if (mode === "autopay") return "Auto-pay within limits";
    if (mode === "approve") return "Ask me every time";
    return "Monitor & allow";
  }

  function reasonText(code, fallback) {
    return REASONS[code] || fallback || "AgentTab stopped this payment for review.";
  }

  function eventText(kind) {
    return EVENTS[kind] || kind;
  }

  function notifyLine(record) {
    const rows = record?.notifyDeliveries;
    if (!rows || !rows.length) return "";
    const last = rows[rows.length - 1];
    const text = last.ok
      ? last.attempt > 1
        ? `Alert delivered on attempt ${last.attempt}`
        : "Alert delivered"
      : `Alert not delivered after ${last.attempt} attempt${last.attempt === 1 ? "" : "s"}`;
    return `<p class="sub">${esc(text)}</p>`;
  }

  function notifyTrail(record) {
    const rows = record?.notifyDeliveries || [];
    return rows
      .map((row) => {
        const result = row.ok
          ? "delivered"
          : row.error
            ? row.error
            : row.status
              ? `HTTP ${row.status}`
              : "failed";
        return `<li><time>${esc(when(row.at))}</time><span>Notify ${esc(row.event)} attempt ${row.attempt}: ${esc(result)}</span></li>`;
      })
      .join("");
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
      throw new Error(body.message || body.error || `${res.status} ${path}`);
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
    const reservedRaw = spend.reservedUsdMicros ?? health.reservedUsdMicros ?? 0;
    const reserved = money(reservedRaw);
    const daily = money(spend.maxDailyUsdMicros ?? health.maxDailyUsdMicros ?? 0);
    const mode = modeLabel(state.policy?.mode || health.policyMode || boot.policyMode);
    const notifySigned = health.notifySigned;
    const alerts = health.notifyConfigured
      ? notifySigned
        ? " · signed alerts"
        : " · alerts on"
      : "";
    const held =
      Number(reservedRaw) > 0
        ? ` · <strong>${esc(reserved)}</strong> held in flight`
        : "";
    $("stance").innerHTML = `<strong>${esc(mode)}</strong> · spent <strong>${esc(used)}</strong>${held} of <strong>${esc(daily)}</strong> today${esc(alerts)}`;
    renderModeBadge();
    renderJudgeStats();
    $("observe-banner").hidden = (state.policy?.mode || health.policyMode) !== "observe";
    const waiting =
      state.nowItems.filter(isWaitingOnYou).length || health.parkedCount || 0;
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

  function primaryLabel(row, loop) {
    if (row.state === "approval_required") {
      return loop.alreadyHeld
        ? `Pay ${loop.askedLabel} and continue`
        : `Buy ${loop.deficitLabel} and continue`;
    }
    if (row.state === "funded" || row.state === "payment_submitted") {
      return "Pay and continue the original request";
    }
    if (row.state === "paid" || row.state === "fulfillment_failed") {
      return "Continue the original request";
    }
    if (row.state === "funding_submitted" || row.state === "approved") {
      return "Finish buying the missing amount";
    }
    return "Continue this request";
  }

  function renderNow() {
    const root = $("decision-list");
    renderVerdict(state.nowItems);
    if (!state.nowItems.length) {
      root.innerHTML = `
        <div class="empty">
          <h2>No agent is blocked on a paid resource</h2>
          <p>When an agent hits a paid resource and the wallet is short the asked asset, that request appears here: exact deficit, DFlow buy, x402 pay, original task continues.</p>
          <p class="meaning">Until then, agents only spend what Policy already allows.</p>
        </div>
        ${renderStory(idleStoryBeats())}
        ${renderJudgeLanding()}`;
      return;
    }
    root.innerHTML =
      state.nowItems
        .map((row) => {
          const record = state.detail[row.operationId];
          const loop = loopModel(row, record);
          const parked = row.state === "approval_required";
          const done = row.state === "fulfilled";
          const halted = row.state === "denied" || row.state === "failed";
          const pending = state.pending?.id === row.operationId;
          const confirm = pending
            ? `<div class="confirm-copy">${
                state.pending.act === "approve"
                  ? loop.alreadyHeld
                    ? `This pays the merchant ${loop.askedLabel} from the wallet and retries ${loop.access || "the original request"}. No DFlow buy. Observe is not a dry-run.`
                    : `This buys only ${loop.deficitLabel} via ${loop.fund.honest}; then it pays the merchant ${loop.askedLabel} and retries ${loop.access || "the original request"}. Observe is not a dry-run.`
                  : state.pending.act === "resume"
                    ? `This continues the same request — buy, pay, or deliver the next unfinished step. It will not start a second payment.`
                    : "Reject is final. This request will not be funded or paid, and the id cannot be reused."
              }</div>
              <div class="actions">
                <button class="btn ${state.pending.act === "deny" ? "btn-danger" : "btn-primary"}" data-act="confirm" type="button">${
                  state.pending.act === "approve"
                    ? loop.alreadyHeld
                      ? "Confirm — pay and continue"
                      : "Confirm — buy and continue"
                    : state.pending.act === "resume"
                      ? "Confirm — continue this request"
                      : "Confirm reject"
                }</button>
                <button class="btn btn-ghost" data-act="cancel" type="button">Back</button>
              </div>`
            : done
              ? ""
              : parked && row.parkedExpired
                ? `<div class="actions">
                <button class="btn btn-danger" data-act="deny" type="button">Reject expired</button>
                <a class="btn btn-ghost" href="/demo">Run a new request</a>
              </div>`
                : parked
                  ? `<div class="actions">
                <button class="btn btn-primary" data-act="approve" type="button">${esc(primaryLabel(row, loop))}</button>
                <button class="btn btn-danger" data-act="deny" type="button">Reject</button>
              </div>`
                  : `<div class="actions">
                <button class="btn btn-primary" data-act="resume" type="button">${esc(primaryLabel(row, loop))}</button>
              </div>`;
          const summary = isDemoMode() ? demoSummary(loop, row) : loop.stepNow;
          return `
          <article class="card${done ? " is-success" : halted ? " is-halt" : ""}" data-id="${esc(row.operationId)}">
            <div class="card-top">
              <p class="card-kicker">${esc(loop.kicker)}</p>
              <span class="card-tag">${esc(loop.fund.badge)} · ${esc(merchantName(loop.intent.merchantOrigin))}</span>
            </div>
            ${
              done
                ? `<p class="card-result">${esc(loop.result)}</p>${renderChainProof(record, row)}`
                : renderDeficit(loop)
            }
            ${renderStory(loop.beats)}
            <p class="card-summary">${esc(summary)}</p>
            ${confirm}
            ${done && isDemoMode() ? `<p class="card-summary">Next scenario loading…</p>` : ""}
            <details class="card-ref"${state.openDetails.has(row.operationId) ? " open" : ""}><summary>Technical details</summary>${
              loop.access ? `<p class="sub">Endpoint <code>${esc(loop.access)}</code></p>` : ""
            }<p class="id">${esc(row.operationId)}</p>${
              (record && record.agentId) || row.agentId
                ? `<p class="sub">Agent ${esc((record && record.agentId) || row.agentId)}</p>`
                : ""
            }<p class="card-meta">${esc(loop.rail)}</p>${
              parked ? `<p class="sub">${esc(parkedReason(row, record))}</p>` : ""
            }${notifyLine(record)}</details>
          </article>`;
        })
        .join("") + renderJudgeLanding();
  }

  const LEDGER_FILTERS = [
    { id: "all", label: "All" },
    { id: "completed", label: "Completed" },
    { id: "needs-approval", label: "Needs approval" },
    { id: "rejected", label: "Rejected" },
  ];

  function ledgerGroup(row) {
    if (row.state === "fulfilled") return "completed";
    if (row.state === "approval_required") return "needs-approval";
    if (row.state === "denied" || row.state === "failed") return "rejected";
    return "in-progress";
  }

  function renderLedgerFilters(counts) {
    return `<div class="ledger-filters" role="group" aria-label="Filter requests">${LEDGER_FILTERS.map(
      (filter) =>
        `<button type="button" class="ledger-filter" data-filter="${filter.id}" aria-pressed="${
          state.ledgerFilter === filter.id ? "true" : "false"
        }">${esc(filter.label)}<span>${filter.id === "all" ? counts.all : counts[filter.id] || 0}</span></button>`,
    ).join("")}</div>`;
  }

  /** One line per request: what was asked for, then how it ended. */
  function ledgerTitle(row, loop) {
    return loop.taskPurpose || pathOf(row.resource) || "Paid request";
  }

  /** Demo Ledger defaults to Completed so Rejected noise does not dominate. */
  function activeLedgerFilter(counts) {
    if (state.ledgerFilterTouched) return state.ledgerFilter;
    if (isDemoMode() && (counts.completed || 0) > 0) return "completed";
    return state.ledgerFilter;
  }

  function renderLedger() {
    const root = $("ledger-list");
    if (!state.recent.length) {
      root.innerHTML = `
        <div class="empty">
          <h2>No requests yet</h2>
          <p>Each row is one request: what the agent asked for, how much AgentTab covered, and whether the task finished.</p>
        </div>`;
      return;
    }
    const counts = state.recent.reduce(
      (acc, row) => {
        const group = ledgerGroup(row);
        acc[group] = (acc[group] || 0) + 1;
        acc.all += 1;
        return acc;
      },
      { all: 0 },
    );
    const filter = activeLedgerFilter(counts);
    // Keep the pressed button in sync with the effective default.
    if (!state.ledgerFilterTouched && filter !== state.ledgerFilter) {
      state.ledgerFilter = filter;
    }
    let rows =
      filter === "all"
        ? state.recent
        : state.recent.filter((row) => ledgerGroup(row) === filter);
    if (isDemoMode()) rows = rows.slice(0, DEMO_LEDGER_CAP);
    if (!rows.length) {
      root.innerHTML = `${renderLedgerFilters(counts)}
        <div class="empty">
          <h2>Nothing in this view</h2>
          <p>No request matches that filter yet.</p>
        </div>`;
      return;
    }
    root.innerHTML = renderLedgerFilters(counts) + rows
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
        const chainProof =
          row.state === "fulfilled" ? renderChainProof(open || row, row) : "";
        const expanded = state.openTrail.has(row.operationId) && Boolean(open);
        const tone =
          row.state === "fulfilled"
            ? " is-success"
            : row.state === "denied" || row.state === "failed"
              ? " is-halt"
              : " is-open";
        return `
          <article class="entry${tone}" data-id="${esc(row.operationId)}" role="button" tabindex="0" aria-expanded="${expanded ? "true" : "false"}">
            <div>
              <div class="entry-title">${esc(ledgerTitle(row, loop))}</div>
              <div class="sub">${esc(merchantName(row.merchantOrigin))}</div>
              ${chainProof}
            </div>
            <div class="entry-status"><span class="state">${esc(loop.kicker)}</span></div>
            <div class="amount">${esc(loop.hero)}</div>
            ${
              expanded
                ? `<div class="entry-detail">
                    <p class="sub">${esc(pathOf(row.resource))}${
                      row.agentId ? ` · ${esc(row.agentId)}` : ""
                    }</p>
                    <p class="sub">${esc(when(row.updatedAt))}</p>
                    <p class="sub">${esc(loopLine)}</p>
                    <p class="sub">${esc(loop.rail)}</p>
                  </div>
                  <ol class="trail">${events || "<li>No events on this payment.</li>"}${notifyTrail(open)}</ol>`
                : ""
            }
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
              `<span class="merchant"><span class="merchant-id"><strong>${esc(
                merchantName(origin),
              )}</strong><small>${esc(origin)}</small></span><button type="button" data-remove-origin="${esc(
                origin,
              )}" aria-label="Remove ${esc(origin)}">×</button></span>`,
          )
          .join("")
      : `<span class="help">Add a merchant origin agents are allowed to pay.</span>`;
    $("max-payment").value = dollarsInput(policy.maxPaymentUsdMicros);
    $("max-daily").value = dollarsInput(policy.maxDailyUsdMicros);
    $("approve-above").value = dollarsInput(policy.requireApprovalAboveUsdMicros);
    // In "Ask me every time" the threshold has no meaning: everything stops.
    const askAlways = policy.mode === "approve";
    const above = $("approve-above");
    above.disabled = askAlways;
    above.placeholder = askAlways ? "" : "5.00";
    $("approve-above-note").textContent = askAlways
      ? "Every payment requires approval"
      : "";
    $("approve-above").closest(".field").classList.toggle("is-disabled", askAlways);
    $("policy-json").value = JSON.stringify(policy, null, 2);
  }

  function render() {
    renderStance();
    if (!state.pending) renderNow();
    renderLedger();
    renderPolicy();
  }

  function detailIsStale(row) {
    const cached = state.detail[row.operationId];
    if (!cached) return true;
    if (cached.state !== row.state) return true;
    if (cached.version !== row.version) return true;
    return false;
  }

  async function loadDetails(rows) {
    const stale = rows.filter(detailIsStale).slice(0, 10);
    await Promise.all(
      stale.map(async (row) => {
        try {
          const next = await api(`/v1/executions/${encodeURIComponent(row.operationId)}`);
          const cached = state.detail[row.operationId];
          if (!cached || (next.version ?? 0) >= (cached.version ?? 0)) {
            state.detail[row.operationId] = next;
          }
        } catch {
          /* keep last good audit record; summary still renders */
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
      state.recent = recent.executions || [];
      const open = openLoop.executions || [];
      // The stage shows one thing at a time: a finished loop stays visible only
      // until the next request is actionable, then it belongs to Ledger.
      if (open.length) state.spotlightId = null;
      const spotlight = open.length
        ? undefined
        : (state.spotlightId &&
            state.recent.find((row) => row.operationId === state.spotlightId)) ||
          state.recent.find((row) => row.state === "fulfilled");
      state.nowItems = spotlight ? [spotlight] : open;
      state.parked = state.nowItems.filter((row) => row.state === "approval_required");
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
        "Monitor & allow is not a dry-run. Matching payments can still fund and pay on Mainnet.",
      );
      if (!ok) return;
    }
    await savePolicy({ ...state.policy, mode }, `Policy saved — ${modeLabel(mode)}.`);
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
      await savePolicy(next, "Policy saved — spend limits updated.");
    } catch (error) {
      setStatus("bad", error.message);
    }
  }

  async function saveJson(event) {
    event.preventDefault();
    try {
      await savePolicy(JSON.parse($("policy-json").value), "Policy saved — JSON updated.");
    } catch (error) {
      setStatus("bad", error.message);
    }
  }

  async function approve(id) {
    state.busy = true;
    try {
      setStatus("", "Buying only the missing payment asset…");
      const body = await api(`/v1/approvals/${encodeURIComponent(id)}`, {
        method: "POST",
        body: "{}",
      });
      state.pending = null;
      delete state.detail[id];
      await refresh();
      const funded =
        body.record?.state === "funded" ||
        body.outcome?.status === "funded" ||
        body.outcome?.status === "already_funded";
      if (funded) {
        await finishRequest(id);
        return;
      }
      if (body.outcome?.status === "policy_denied" || body.record?.state === "denied") {
        setStatus(
          "bad",
          `Policy denied this after approval · ${reasonText(body.outcome?.policyReason, body.outcome?.reason)}`,
        );
        return;
      }
      if (body.record?.state === "failed") {
        setStatus("bad", `Funding failed · ${body.outcome?.reason || "the buy did not finish"}`);
        return;
      }
      setStatus("ok", `Approved · ${STATES[body.record?.state] || body.record?.state || "updated"}`);
    } catch (error) {
      state.pending = null;
      await refresh();
      setStatus("bad", error.message);
    } finally {
      state.busy = false;
    }
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

  async function resumeOnce(id) {
    return api(`/v1/executions/${encodeURIComponent(id)}/resume`, {
      method: "POST",
      body: "{}",
    });
  }

  async function finishRequest(id) {
    setStatus("", "Paying the merchant…");
    const paid = await resumeOnce(id);
    delete state.detail[id];
    await refresh();
    const afterPay = paid.record?.state || (await api(`/v1/executions/${encodeURIComponent(id)}`)).state;
    if (afterPay === "paid" || afterPay === "fulfillment_failed") {
      setStatus("", "Continuing the original request…");
      await resumeOnce(id);
      delete state.detail[id];
      await refresh();
    }
    state.spotlightId = id;
    delete state.detail[id];
    await refresh();
    const done = state.detail[id] || {};
    setStatus(
      "ok",
      done.state === "fulfilled"
        ? "Original request continued"
        : `Continued · ${STATES[done.state] || done.state || "updated"}`,
    );
  }

  async function resume(id) {
    state.busy = true;
    try {
      const row = state.nowItems.find((item) => item.operationId === id);
      state.pending = null;
      if (
        row &&
        (row.state === "funded" ||
          row.state === "payment_submitted" ||
          row.state === "paid" ||
          row.state === "fulfillment_failed")
      ) {
        await finishRequest(id);
        return;
      }
      setStatus("", "Continuing this request…");
      const body = await resumeOnce(id);
      delete state.detail[id];
      await refresh();
      const next = body.record?.state;
      if (next === "funded" || next === "paid") {
        await finishRequest(id);
        return;
      }
      if (next === "fulfilled") state.spotlightId = id;
      setStatus("ok", `Continued · ${STATES[next] || body.step || "updated"}`);
    } finally {
      state.busy = false;
    }
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
      if (isDemoMode()) {
        approve(id);
      } else {
        state.pending = { id, act: "approve" };
        renderNow();
      }
    } else if (button.dataset.act === "deny") {
      state.pending = { id, act: "deny" };
      renderNow();
    } else if (button.dataset.act === "resume") {
      if (isDemoMode()) {
        resume(id);
      } else {
        state.pending = { id, act: "resume" };
        renderNow();
      }
    } else if (button.dataset.act === "cancel") {
      state.pending = null;
      renderNow();
    } else if (button.dataset.act === "confirm") {
      if (state.pending?.act === "approve") approve(id);
      if (state.pending?.act === "deny") deny(id);
      if (state.pending?.act === "resume") resume(id);
    }
  });
  $("decision-list").addEventListener(
    "toggle",
    (event) => {
      const details = event.target;
      if (!details.classList || !details.classList.contains("card-ref")) return;
      const id = details.closest("[data-id]")?.dataset.id;
      if (!id) return;
      if (details.open) state.openDetails.add(id);
      else state.openDetails.delete(id);
    },
    true,
  );

  async function toggleTrail(id) {
    if (state.openTrail.has(id)) {
      state.openTrail.delete(id);
      renderLedger();
      return;
    }
    state.openTrail.add(id);
    try {
      if (!state.detail[id]) {
        state.detail[id] = await api(`/v1/executions/${encodeURIComponent(id)}`);
      }
      renderLedger();
    } catch (error) {
      setStatus("bad", error.message);
    }
  }

  $("ledger-list").addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    const filter = event.target.closest("[data-filter]");
    if (filter) {
      state.ledgerFilter = filter.dataset.filter;
      state.ledgerFilterTouched = true;
      renderLedger();
      return;
    }
    const card = event.target.closest("[data-id]");
    if (card) void toggleTrail(card.dataset.id);
  });
  $("ledger-list").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-id]");
    if (!card) return;
    event.preventDefault();
    void toggleTrail(card.dataset.id);
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
  setInterval(() => {
    if (!state.busy && !state.pending) refresh();
  }, 5000);
})();

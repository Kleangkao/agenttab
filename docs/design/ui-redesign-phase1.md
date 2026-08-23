# AgentTab `/ui` — Redesign Spec (Phase 1, design only)

Status: **design handoff — not implemented.** No code changes until explicitly approved.
Scope: `apps/gateway/src/ui/operator-page.ts`, `app.css`, `app.js` (+ `examples/remote-agent/src/stack-seed.ts` for the demo seed).

---

## 1. Critique summary — top 5

| # | Issue | Why it hurts the judge story |
|---|---|---|
| 1 | **The thesis only renders when nothing is happening.** `renderNow()` returns the judge landing (incl. "DFlow is required here…") *only* on the empty branch; the card branch omits it. | A judge landing on a live demo — the normal case — never reads why DFlow is required. The single most important sentence is hidden behind an empty state. |
| 2 | **The hero number is ambiguous and mis-colored.** `$4.00` in `--money` green, on a card whose kicker says "The agent is blocked". `heroAtomic` silently switches between *deficit* and *asked* with no change to the label. | Green reads as settled money. A blocked payment in success-green reads as "already paid". And one bare number cannot express "exact deficit" — that needs a comparison. |
| 3 | **Nine text blocks before the primary button.** kicker → hero → amount label → 5 pipeline rows → summary → long summary → parked reason → confirm copy. | Four different explanations of the same event compete. Nothing wins. Judges skim, find prose, and stop. |
| 4 | **Mode honesty is repeated 5x yet absent where it matters.** Badge, stance line, proof `<details>`, landing paragraph and `railFor()` all state the funding mode — but the *card's* rail is buried inside "Technical details". | Repetition trains the eye to ignore it, and the one place a judge is actually deciding has no visible LOCAL MOCK marker. |
| 5 | **It is a theme swap.** Teal→indigo gradient mark, gradient button, two radial body glows, pill nav, one `rgba(255,255,255,.08)` border on every surface, inside a 960px column. `--sans: "Inter", …` with **no font ever loaded**, so it ships as Segoe UI. | No elevation logic, no layout idea, no type system that reaches the browser. It reads as a dark-mode default — exactly the feedback already received. |

Secondary but real (fix while in there):

- `setInterval(refresh, 5000)` → `render()` → `renderNow()` rewrites `innerHTML`, so any open `<details>` collapses and focus is lost every 5 seconds mid-read.
- Ledger row collapse does not stick: deleting `state.detail[id]` marks it stale, `loadDetails()` re-fetches, and the trail re-expands on the next poll.
- `.entry` rows are clickable `<article>`s with no `role`, `tabindex`, or key handler. The merchant remove `x` is a ~14px target.
- The four stat tiles give three money figures equal weight to the story, and in a public mock "Spent today $12.00 / cap $20.00" reads as *the demo is running out*.

**What to keep, deliberately:** the `STATES` / `EVENTS` / `REASONS` maps, `loopModel()`'s refusal to let a late balance rewrite a completed buy, and the mock/live labeling discipline. That logic is the product's credibility. The redesign should *display* it better, not replace it.

---

## 2. Information architecture

Principle: **the rail states the system; the stage holds one thing.**

### Now — "one decision"
1. **Verdict strip** (always, including during a live card): one line of state + the DFlow-required sentence. This is the fix for critique #1.
2. **Decision card** — at most one expanded. Order inside:
   `state spine → kicker → deficit comparison (hero) → flow strip → one sentence → primary action → collapsed technical drawer`
3. **Flow strip** — the 5 beats as a horizontal connected sequence, active node expanded.
4. **Proof footer** — "Already proven on Solana Mainnet" + two tx links. Secondary, always present, never above the decision.

Removed from Now: the 4-tile metrics row (moves to the rail, suppressed in mock — §7), the duplicated `card-summary.long`, the standalone `parkedReason` paragraph (folded into the drawer).

### Ledger — "what already happened"
Dense scan table, not cards. One row = one original request:

`state spine | state | merchant · path | asked → deficit → paid | when | amount`

Row expands in place to the event trail. Expansion is **sticky** (§8, `state.openTrail`).

### Policy — "the rules that produced that"
Unchanged in substance, regrouped with the JSON drawer last:
1. When should AgentTab pay? (3 mode cards)
2. Who agents may pay (merchant chips + add)
3. Spend limits (3 fields) — *hidden in mock mode*, replaced by a mock notice
4. Would this be allowed? (preview) — keep, it is a genuinely good judge toy
5. Advanced policy JSON (`<details>`)

---

## 3. Desktop wireframe (>=1080px)

```
┌──────────────────┬───────────────────────────────────────────────────────────┐
│ RAIL 260px       │ STAGE  max 780px, centered in remaining space             │
│ ─────────────    │ ───────────────────────────────────────────────────────── │
│ ▌AT  AgentTab    │  VERDICT STRIP                                            │
│  Buy only the    │  ┌─────────────────────────────────────────────────────┐  │
│  missing payment │  │ ● BLOCKED   Agent hit a paid API and the wallet is   │  │
│  asset, then     │  │             short the exact asset it asked for.      │  │
│  finish the      │  │ DFlow is required here: without the exact-deficit    │  │
│  original req.   │  │ swap, the agent stops at insufficient funds.         │  │
│                  │  └─────────────────────────────────────────────────────┘  │
│ ┌──────────────┐ │                                                           │
│ │ LOCAL MOCK   │ │  DECISION CARD                                            │
│ └──────────────┘ │  ┌─────────────────────────────────────────────────────┐  │
│  no chain ·      │ ▌│ THE AGENT IS BLOCKED         #demo-now-a91f · mock  │  │
│  not broadcasting│ ▌│                                                     │  │
│                  │ ▌│   has          needs         buy only               │  │
│ ─────────────    │ ▌│  $2.60   →    $4.00    =     $1.40                  │  │
│ NOW          ①   │ ▌│  USDC held    x402 ask       exact deficit          │  │
│ LEDGER           │ ▌│                                                     │  │
│ POLICY           │ ▌│  ①──②──③──④──⑤                                      │  │
│ ─────────────    │ ▌│  ✓   ✓   ●   ○   ○    ← active node expands below   │  │
│ WALLET           │ ▌│  Wallet short · holds $2.60 of the $4.00 ask        │  │
│ 2.60 USDC        │ ▌│                                                     │  │
│ 5.0000 SOL       │ ▌│  Buy $1.40 from SOL, pay the merchant, then retry   │  │
│                  │ ▌│  /v1/market-snapshot. Nothing else moves.           │  │
│ POLICY           │ ▌│                                                     │  │
│ Ask you first    │ ▌│  ┌───────────────────────────┐ ┌────────┐           │  │
│                  │ ▌│  │ Buy $1.40 and continue  ▸ │ │ Reject │           │  │
│ SCENARIO 1 of 4  │ ▌│  └───────────────────────────┘ └────────┘           │  │
│                  │ ▌│  ▸ Technical details                                │  │
│ [mock: no spend  │  └─────────────────────────────────────────────────────┘  │
│  row rendered]   │                                                           │
│                  │  Already proven on Solana Mainnet                          │
│                  │  exact-deficit DFlow ↗ → x402 pay ↗ → request continued    │
└──────────────────┴───────────────────────────────────────────────────────────┘
```

Success state swaps the hero for `✓ /v1/market-snapshot delivered`, turns the spine green, marks all five nodes done, and shows the replay affordance (§7.4).

**Responsive:** below `960px` the rail becomes a sticky top bar (brand + badge left, tabs right; wallet/policy collapse to one line beneath). Below `720px` the flow strip goes vertical, the deficit comparison stacks, buttons go full width.

---

## 4. Design tokens

Drop-in replacement for the `:root` block in `app.css`. Every contrast ratio below is computed, not estimated.

```css
:root {
  color-scheme: dark;

  /* Planes — solid, not translucent. Elevation = lighter plane + one shadow. */
  --ink-900: #0B0D10;   /* page */
  --ink-800: #101318;   /* rail, ledger rows, inputs */
  --ink-700: #161A21;   /* stage card */
  --ink-600: #1D222B;   /* hover */
  --line:        #232935;
  --line-strong: #333B4A;

  /* Text */
  --text:   #E8EAEE;   /* 14.5:1 on --ink-700 */
  --text-2: #A2ABBA;   /*  7.5:1 */
  --text-3: #7E8898;   /*  4.9:1 — AA floor, body text only */

  /* Signal — one accent, used once per view */
  --signal:      #FFB020;   /* 9.5:1 on ink-700; ink-900 on signal = 10.6:1 */
  --signal-soft: rgba(255,176,32,0.10);
  --settle:      #3ECF8E;   /* 8.7:1 — terminal success ONLY */
  --settle-soft: rgba(62,207,142,0.10);
  --halt:        #FF6B6B;   /* 6.3:1 */
  --halt-soft:   rgba(255,107,107,0.10);
  --info:        #7AB0FF;   /* 7.9:1 — mainnet proof links */

  /* Amounts are ink, not green. Token name preserved: operator-console.test.ts
     asserts the served CSS contains "--money:". */
  --money: #E8EAEE;

  /* Type — the pair is functional: mono carries every amount, id and index. */
  --font-sans: "IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-mono: "IBM Plex Mono", "Cascadia Mono", ui-monospace, monospace;

  --t-display: 700 40px/1.05 var(--font-mono);   /* hero amounts, -0.02em */
  --t-h1:      600 24px/1.2  var(--font-sans);
  --t-h2:      600 17px/1.3  var(--font-sans);
  --t-body:    400 15px/1.55 var(--font-sans);
  --t-label:   500 13px/1.4  var(--font-sans);
  --t-micro:   600 11px/1.3  var(--font-mono);   /* uppercase, 0.08em */

  /* Space — 4-based, no arbitrary values */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-5: 20px; --s-6: 24px; --s-8: 32px; --s-10: 40px; --s-14: 56px;

  /* Radii — pills only on the mode badge. No pill spam. */
  --r-xs: 4px; --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-pill: 999px;

  /* Elevation — exactly two levels */
  --e-1: inset 0 1px 0 rgba(255,255,255,0.04);
  --e-2: inset 0 1px 0 rgba(255,255,255,0.05), 0 16px 40px -12px rgba(0,0,0,0.6);

  /* Motion */
  --dur-fast: 120ms; --dur-mid: 240ms;
  --ease: cubic-bezier(0.2, 0.6, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

**Typography decision.** IBM Plex Sans + IBM Plex Mono, loaded with `font-display: swap` and a full system fallback. Justification: Plex is engineered/institutional rather than startup-neutral (it is not Inter, and it is not a "designer" display face), and the mono is *load-bearing* — every amount, operation id, network label and step index renders mono with `font-variant-numeric: tabular-nums`. That is the visual signature of a settlement terminal, and it is functional rather than decorative. Tradeoff: one external request. If zero external dependencies matter more (air-gapped gateway), self-host two woff2 files under `/ui/` and add a route; the fallback stack keeps the page fully legible either way.

**Signature details** (cheap, distinctive, not gradient slop):

- **State spine** — a 2px left bar on every card and ledger row, colored `--signal` / `--settle` / `--halt`. Ties Now and Ledger into one language and makes the ledger scannable without reading.
- **Ruled rail** — the rail alone gets a faint `repeating-linear-gradient` hairline texture. Reads as ledger paper.
- **No gradients anywhere.** Primary button is flat `--signal` with `--ink-900` text. Brand mark is a flat amber square with a mono `AT`.

Deletions: both body radial glows, `linear-gradient(135deg, var(--accent), #6366f1)` on `.brand-mark` and `.btn-primary`, `--accent` / `--accent-dim`, the pill `.nav`.

---

## 5. Components → files

| Component | HTML shell (`operator-page.ts`) | Styles (`app.css`) | Behavior (`app.js`) |
|---|---|---|---|
| App shell (rail + stage) | replace `.app` / `.header` with `.shell > .rail + .stage` | `.shell` grid `260px 1fr`; `.rail`, `.stage` | — |
| Brand + tagline | `.brand` (tagline verbatim) | `.brand`, `.brand-mark` (flat) | — |
| Mode badge | keep `id="mode-badge"` | `.mode-badge` + `.mock/.sim/.devnet/.live` | `renderModeBadge()` **unchanged** |
| Rail nav | `[data-view]` buttons, keep `#parked-count` | `.rail-nav`, `[aria-current]` | existing `setView()` |
| Rail status | `<div id="judge-stats">` **moved into the rail** | `.rail-stat` | `renderJudgeStats()`, mock-aware (§7.5) |
| Verdict strip | new `<div id="verdict">` in stage | `.verdict`, `.verdict-why` | new `renderVerdict()` → calls `renderJudgeLanding()` |
| Judge landing | — | `.judge-*` reduced | `renderJudgeLanding()` **name preserved**, output condensed |
| Decision card | `#decision-list` (id preserved) | `.card`, `.card--blocked/--done/--halt`, spine | `renderNow()` |
| Deficit comparison | — | `.deficit`, `.deficit-term`, `.deficit-op` | new `renderDeficit(loop)` |
| Flow strip | — | `.flow`, `.flow-node`, `.flow-node.is-*` | `renderStory(beats)` — new markup, same call sites |
| Action bar | — | `.actions`, `.btn`, `.btn-primary/danger/ghost` | `primaryLabel()`, click handler shape preserved |
| Technical drawer | — | `.card-ref` | keeps `>Agent `, `notifyLine()`, rail line |
| Chain proof | `#proof` + landing | `.chain-proof`, `.proof-links` | `renderChainProof()` **unchanged** |
| Ledger table | `#ledger-list` | `.ledger`, `.entry` grid | `renderLedger()` + sticky `state.openTrail` |
| Policy blocks | existing panel ids | `.policy-section`, `.mode-card`, `.merchant` | `renderPolicy()` |
| Unlock | `#unlock` (keeps "Gateway token") | `.unlock-card` | unchanged |
| Status / stance | `#status`, `#stance`, `#observe-banner` | `.status`, `.stance` | `renderStance()` shortened |

---

## 6. UX copy deck

**Bold = locked, must ship byte-identical** (asserted by tests).

### Shell
| Slot | Copy |
|---|---|
| Brand tagline | **Buy only the missing payment asset, then finish the original request** |
| Mode badge | `LOCAL MOCK` / `DFLOW SIM` / `DFLOW QUOTE` / `DEVNET` / `MAINNET LIVE` (unchanged) |
| Badge tooltip | **local DFlow mock** — no chain, not broadcasting |
| Tabs | **Now** · **Ledger** · **Policy** |
| Footer | Reject is final. Preview never moves money. → `Machine contract` |

### Verdict strip
| State | Line 1 | Line 2 (constant) |
|---|---|---|
| Blocked | Agent hit a paid API. The wallet is short the exact asset the merchant asked for. | **DFlow is required here: without the exact-deficit swap, the agent stops at insufficient funds.** |
| Running | Buying only the deficit, then paying and continuing the same request. | *(same)* |
| Done | The agent got what it asked for. One request, one payment, no swap UI. | *(same)* |
| Idle | Waiting for an agent to hit a paid resource. | *(same)* |

### Decision card
| Slot | Copy |
|---|---|
| Kicker (parked) | **The agent is blocked** |
| Kicker (expired) | **Parked approval expired** |
| Kicker (denied after approve) | **Policy denied this after approval** |
| Kicker (failed) | **Funding failed** |
| Kicker (done) | The agent received the resource |
| Deficit terms | `has` / `needs` / `buy only` — sub-labels `USDC held` / `x402 ask` / `exact deficit` |
| Sentence (parked, short) | Buy `$1.40` from SOL, pay the merchant, then retry `/v1/market-snapshot`. Nothing else moves. |
| Sentence (parked, already held) | The wallet already holds `$4.00`. Pay the merchant and retry `/v1/market-snapshot` — no DFlow buy. |
| Sentence (done) | Bought `$1.40`, paid `$4.00`, and the original request continued. |
| Primary (short) | `Buy $1.40 and continue` |
| Primary (already held) | `Pay $4.00 and continue` |
| Primary (open loop) | `Continue this request` |
| Secondary | **Reject** |
| Expired | **Reject expired** |
| Confirm (non-mock) | **Confirm — buy and continue** / `Confirm — continue this request` / `Confirm reject` / `Back` |
| Drawer | `Technical details` |

### Flow strip — titles <=4 words, detail carries the specifics
| # | Title | Detail (example) |
|---|---|---|
| 1 | Paid request | `GET /v1/market-snapshot` |
| 2 | Merchant asks | `$4.00 USDC via x402` |
| 3 | Wallet short | `$2.60 held · $1.40 missing` |
| 4 | **Buy only the exact deficit** | `$1.40 via local DFlow mock` |
| 5 | Pay and continue | `Same request, no second payment` |

Step 4 when nothing is needed: title `No DFlow buy`, detail `Wallet already covers the ask`.

### Empty states
| Where | Copy |
|---|---|
| Now | **No agent is blocked** on a paid resource. / When an agent hits a paid API and the wallet is short the asked asset, the request lands here — exact deficit, DFlow buy, x402 pay, original task continues. |
| Ledger | No 402s yet. / Each row is one original request: what the merchant asked for, the exact deficit bought, whether it paid, and whether the agent continued. |
| Merchants | Add a merchant origin agents are allowed to pay. |

### Rail status
| Mode | Rows |
|---|---|
| Mock | `WALLET` (balances) · `POLICY` (mode) · `SCENARIO` (n of 4). **No spend row.** |
| Non-mock | `Spent today` · **Held in flight** · `Daily cap` · `Waiting on you` |

*Both casings are asserted:* `"Held in flight"` (stat label) **and** `"held in flight"` (stance line). Keep both.

### Proof
> **Already proven on Solana Mainnet** — the same loop already settled on-chain: `exact-deficit DFlow` → `x402 pay` → original request continued. No new Mainnet spend from this screen.

### Policy
`When should AgentTab pay?` → Watch / **Ask you first** / Pay within limits · `Who agents may pay` / **Allow merchant** · `Spend limits` / **Save limits** · `Would this be allowed?` → "Checks the live policy only. **This check did not move money**." · `Advanced policy JSON` · Banner: **Observe is not a dry-run**. Matching payments can still fund and pay.

---

## 7. Mock demo UX — replayable, not scripted

### 7.1 The seed is telling the wrong story
The wallet starts at **0 USDC** and the ask is **$4.00**, so the deficit *equals* the ask. In that scenario "exact deficit" is visually identical to "buy the whole amount" — the product's core claim cannot be seen on screen.

**Fix (highest-value change in this document):** seed the wallet with a *partial* balance. `$2.60 held → $4.00 asked → buy $1.40`. The hero comparison then proves the claim by itself, before anyone reads a word.

### 7.2 Scenario rotation
`stack-seed.ts` gains a small deterministic table; `seedNowIfEmpty` picks `SCENARIOS[n % 4]` where `n` is the count of prior demo operations. Repeatable for a rehearsed demo, varied for consecutive visitors.

| # | Purpose | Resource | Ask | Wallet USDC | Deficit |
|---|---|---|---|---|---|
| 1 | Estimate my wallet's USD value | `/v1/market-snapshot` | $4.00 | $2.60 | $1.40 |
| 2 | Check contract risk before signing | `/v1/contract-scan` | $1.25 | $0.00 | $1.25 |
| 3 | Pull the overnight liquidity report | `/v1/liquidity-report` | $7.50 | $6.15 | $1.35 |
| 4 | Verify this token's holder distribution | `/v1/holder-graph` | $0.85 | $0.85 | none — *already held* path |

Scenario 4 is deliberate: it exercises the `alreadyHeld` branch, proving AgentTab does **not** swap when it does not need to. That is a credibility beat, not filler.

### 7.3 One-click in mock
`isDemoMode()` already bypasses the approve confirm. Extend the same bypass to `resume`. **Keep `deny` two-step** — it is destructive and irreversible. Critically, the `state.pending` machinery stays in the source untouched: `operator-control.test.ts` asserts the literal lines `if (state.pending?.act === "approve") approve(id)` and its `deny` twin.

### 7.4 Replay without waiting awkwardly
On the success card in mock:

- immediately show `Next scenario loading…` with the state spine amber-pulsing;
- the existing 5s poll swaps the new card in — no new endpoint, no new state;
- if `reseedMs` is long, lower it (env, `stack.ts`) so the gap is ~8–10s rather than 15.

A true "Run it again" **button** needs a gateway seed route — out of scope for these three files. Flagged, not assumed.

### 7.5 Kill spend-cap friction in mock
When `fundingMode === "mock"`, `renderJudgeStats()` renders the *story* set (wallet, policy, scenario) and **no spend/cap row**. Accumulated public-demo spend stops reading as "this demo is nearly out of money", and no honesty is lost — mock spend is not real spend. The stance line keeps the honest figures for anyone who reads it, and non-mock modes are unchanged. Optionally raise the seeded `maxDailyUsdMicros` for the public host so the underlying cap cannot bite mid-demo.

Mainnet broadcast stays out of the public demo. Proof links remain secondary, below the decision.

---

## 8. Implementation checklist (surgical, file by file)

Do not start until approved. Work in this order; `pnpm --filter @agenttab/gateway build && pnpm demo:stack` after each file (`demo:stack` serves `dist/`, not `src/`).

### A. `apps/gateway/src/ui/operator-page.ts` — shell only
- [ ] Add `<link rel="preconnect">` + Google Fonts stylesheet for IBM Plex Sans/Mono in `<head>`.
- [ ] Replace `.app > .header + .metrics + .context-bar` with `.shell > .rail + .stage`.
- [ ] Rail holds: brand (**tagline verbatim**), `id="mode-badge"`, `[data-view]` nav with `id="parked-count"`, and `id="judge-stats"` (**both ids preserved — judge-stats simply relocates**).
- [ ] Stage holds: `id="verdict"` (new), `id="status"`, `id="observe-banner"`, `#unlock`, `#workspace` with `#panel-now > #decision-list`, `#panel-ledger`, `#panel-policy`.
- [ ] Keep `#proof` and its **`local DFlow mock`** + **`solscan.io/tx/`** literals in the shell HTML.
- [ ] Keep verbatim: `Gateway token`, `Allow merchant`, `Save limits`, `Observe is not a dry-run`, `Ask you first`, `/openapi.json`, `/ui/app.css`, `/ui/app.js`, `Now`, `Ledger`, `Policy`, and the `"adminRequired":true` boot JSON.

### B. `apps/gateway/src/ui/app.css` — rewrite of the visual layer
- [ ] Replace `:root` with the §4 tokens. **`--money:` must remain present** (asserted).
- [ ] Delete: both body radial gradients, `.brand-mark` gradient, `.btn-primary` gradient, `--accent*`, the pill `.nav`, the `.metrics` 4-col grid.
- [ ] Add: `.shell` grid, `.rail` (+ ruled texture), `.stage`, `.verdict`, `.deficit`, `.flow` (horizontal), state-spine modifiers, two-level elevation.
- [ ] `font-variant-numeric: tabular-nums` on every amount class.
- [ ] Keep a visible `:focus-visible` outline; switch its color to `--signal`.
- [ ] Minimum 24x24px hit area on `.merchant button`.
- [ ] Breakpoints: `960px` (rail → top bar), `720px` (flow vertical, deficit stacks, full-width buttons).
- [ ] Add the `prefers-reduced-motion` block.

### C. `apps/gateway/src/ui/app.js` — behavior deltas only
- [ ] **Do not rename** `renderJudgeLanding`, `renderModeBadge`, `renderChainProof`, `loopModel`, `detailIsStale`, `finishRequest`, `approve`, `deny`.
- [ ] `renderVerdict()` (new) renders the verdict strip on **every** Now state and calls `renderJudgeLanding()`, so the DFlow sentence is always on screen — fixes critique #1.
- [ ] `renderStory()` — new flow-strip markup, same signature and call sites. Keep the literals **`Buy only the exact deficit`** and **`the exact deficit`**.
- [ ] `renderDeficit(loop)` (new) — three-term comparison; `heroAtomic` logic unchanged.
- [ ] `renderNow()` — drop `card-summary.long` and the standalone `parkedReason` paragraph (fold into the drawer). Keep **`The agent is blocked`**, **`Waiting for you`**, **`Parked approval expired`**, **`Reject expired`**, **`Policy denied this after approval`**, **`Funding failed`**, **`No agent is blocked`**, `>Agent `, `notifyDeliveries`, `agentId`.
- [ ] `renderJudgeStats()` — mock branch (wallet / policy / scenario, no spend) vs non-mock branch. **`Held in flight`** must survive in the non-mock branch; **`held in flight`** must survive in `renderStance()`; `reservedUsdMicros` must stay referenced.
- [ ] Click handler: extend the `isDemoMode()` one-click path to `resume`. **Leave these source lines byte-identical:** `if (state.pending?.act === "approve") approve(id)` and its `deny` twin; keep `approve()` / `deny()` bodies matching their asserted regexes; keep **`Confirm — buy and continue`**.
- [ ] Fix the 5s-poll teardown: track open drawers in `state.openDetails` / `state.openTrail` and restore after `innerHTML`, or skip `renderNow()` while a `<details>` inside it has focus.
- [ ] Fix the ledger toggle: drive expansion from `state.openTrail` instead of deleting `state.detail[id]` (which `detailIsStale()` immediately re-fetches). Keep the `detailIsStale` and `historicalDeficit` identifiers.
- [ ] Ledger rows: `role="button"`, `tabindex="0"`, Enter/Space handler.
- [ ] Keep `Approve` / `Reject` / `Resume` as substrings somewhere in the file — today `Resume` survives **only** inside `openLoopCopy()`'s prose. If that prose is rewritten, the test breaks.
- [ ] Do not reintroduce `alreadyHeld || (!deficitKnown && !inflight) ? "none"` (explicit negative assertion).

### D. `examples/remote-agent/src/stack-seed.ts` — demo narrative
- [ ] Add the §7.2 `SCENARIOS` table; select deterministically by prior demo-op count.
- [ ] Seed `initialUsdcAtomic` per scenario so the deficit != the ask (§7.1).
- [ ] `resetDemoState` keeps resetting wallet + policy between loops.
- [ ] Update `examples/remote-agent/test/stack-seed.test.ts` if it pins `4000000`.
- [ ] Update `docs/DEMO.md` step 1 (currently "$4.00 USDC, wallet starts at 0 USDC / 5 SOL").

### E. Verify
```bash
pnpm --filter @agenttab/gateway build && pnpm --filter @agenttab/gateway test
```
- [ ] `operator-console.test.ts`, `operator-spend-visibility.test.ts`, `operator-control.test.ts` all green.
- [ ] `pnpm demo:stack` → `http://127.0.0.1:8787/ui` — mock badge visible, one-click approve completes, next scenario appears, deficit != ask.
- [ ] Keyboard-only pass: rail nav → primary action → drawer → ledger row.
- [ ] Check 1280 / 960 / 375 widths.

### Asserted-literal inventory (paste into review)
`--money:` · `/health` · `/openapi.json` · `/resume` · `/ui/app.css` · `/ui/app.js` · `/v1/approvals/` · `/v1/balances` · `/v1/denials/` · `/v1/executions/` · `/v1/executions?reusable=1` · `/v1/policy` · `/v1/preview` · `/v1/spend` · `>Agent ` · `AgentTab` · `Alert delivered` · `Allow merchant` · `Already proven on Solana Mainnet` · `Approve` · `Buy only the exact deficit` · `Buy only the missing payment asset, then finish the original request` · `Confirm — buy and continue` · `DFlow is required here: without the exact-deficit swap, the agent stops at insufficient funds.` · `Funding failed` · `Gateway token` · `Held in flight` · `held in flight` · `Ledger` · `Math.round(n * 1_000_000)` · `n / 1_000_000` · `No agent is blocked` · `Now` · `Observe is not a dry-run` · `Parked approval expired` · `Policy` · `Policy denied this after approval` · `Reject` · `Reject expired` · `Resume` · `Save limits` · `The agent is blocked` · `This check did not move money` · `Waiting for you` · `admin token required` · `agentId` · `detailIsStale` · `finishRequest` · `funding.plan_receipt` · `historicalDeficit` · `judge-stats` · `local DFlow mock` · `mode-badge` · `notifyDeliveries` · `notifySigned` · `original request` · `parkedExpired` · `policy.denied` · `policy_denied` · `renderChainProof` · `renderJudgeLanding` · `renderModeBadge` · `reservedUsdMicros` · `solscan.io/tx/` · `the exact deficit` · `none`

---

## Open questions (non-blocking)

1. **Fonts** — Google Fonts request, or self-host two woff2 files under `/ui/`? Assumed default: Google Fonts + system fallback.
2. **Replay button** — accept the auto-reseed swap (no new endpoint), or add a gateway seed route for a real "Run it again"? Assumed default: auto-swap only.
3. **Rail vs single column** — the rail is the structural bet of this redesign. If you would rather keep one centered column, say so now; it changes §3 and §5 substantially.

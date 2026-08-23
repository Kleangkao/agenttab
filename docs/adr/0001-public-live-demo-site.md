# ADR 0001 — Public live demo website

Status: Accepted  
Date: 2026-08-23  
Context: Demo Day without a laptop; want a URL that shows AgentTab and runs the live loop.

## Accepted defaults (2026-08-23)

1. **Host:** Railway (single Docker/`demo:stack` service). Fly remains a fine alternate; Railway wins on fewer first-deploy steps.
2. **Auth:** No admin token for this private-ish demo URL (brother + judges, low traffic). Accept shared-state vandalism risk because funding stays mock-only. Do not put Mainnet keys or broadcast gates on this host.
3. **Reseed:** Auto-reseed when no live `approval_required` card remains (interval check). Prefer unattended reliability over a manual Reset button.

## Implementation notes

- Code: `examples/remote-agent/src/stack-seed.ts` + `stack.ts` (loopback merchant, `AGENTTAB_STACK_RESEED_MS`)
- Container: `Dockerfile.demo-stack`
- Railway: `railway.toml`
- Judge docs: `docs/DEMO.md` (Public demo host)

## Decision drivers

1. Judges must understand thesis, run the loop, see Mainnet proof.
2. Operator cannot bring a laptop to Demo Day.
3. `/ui` is not a static marketing page — it is the gateway control plane.
4. `pnpm demo:stack` already is the product demo: gateway + merchant + seeded parked Now card (mock DFlow, no chain).

## Options considered

### A. Vercel static site only
Pitch copy + Solscan links + video. No live Approve.
- Pros: trivial, durable URL
- Cons: not a live demo; fails “run the loop” for judges who want to click

### B. Vercel frontend + remote gateway API
Split UI from control plane.
- Pros: pretty hostnames
- Cons: CORS, auth, two deploys, UI assumes same-origin `/v1/*`; high break risk

### C. Deploy `demo:stack` (or equivalent) as one public service (**chosen**)
One host serves `/ui` + APIs + merchant + auto-seed parked request. Mock funding only. Optional thin `/` landing on the same origin.
- Pros: matches local judge path; one URL; phone-browser ready; Docker/GHCR already exists
- Cons: need a long-running host (Railway/Fly/Render), public auth/token policy, reseeding after someone completes the demo

### D. Mainnet-armed public demo
- Rejected: spend risk, flaky Wi-Fi, wrong for judges

## Decision

Ship a **Public Demo Host** = productionized `demo:stack`:

- Host: Railway / Fly / Render (container), **not** Vercel for the control plane
- Fidelity: mock DFlow + local pay only; badge stays `LOCAL MOCK`
- Seed: park one `approval_required` Now card when empty (same as `seedNowIfEmpty`)
- Auth: require `AGENTTAB_ADMIN_TOKEN` for approve/deny/policy writes; share token only for Demo Day or use a short-lived demo token
- Proof: keep Solscan Mainnet links on `/ui` (historical, no new spend)
- Backup: 60–90s screen recording on phone if venue network fails
- Optional: tiny same-origin `/` pitch that links to `/ui` — or a separate Vercel brochure that only links to the demo host

## Consequences

- Demo Day URL is effectively `https://<demo-host>/ui` (plus unlock token if set).
- Product narrative stays honest: live click is mock; Mainnet is proof links.
- Reseed strategy required (restart, cron, or “Reset demo” that parks a new intent).
- Threat surface is public approve/deny — token + mock-only is mandatory.

## Non-goals

- Grafana
- Moving npm packages or Mainnet oneshot onto the public host
- Rebuilding `/ui` as a separate SPA

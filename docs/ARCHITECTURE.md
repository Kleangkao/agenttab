# Architecture

## Position in the stack

```text
Agent / demo client
      |
      v
@agenttab/fetch  (wraps official @x402/fetch + funding hook)
  or local HMAC demo client
      |
      v
apps/gateway orchestrator
      |
      +---- Policy engine (@agenttab/core)
      +---- Exact-deficit planner (@agenttab/dflow)
      +---- Idempotency + audit store (SQLite)
      +---- Balance providers (mock | RPC)
      +---- Funding adapters (mock | live-quote | live-sim | devnet-mint)
      +---- Signer boundary (simulated | local keypair, broadcast gated)
      |
      v
Funding tx (when needed) -> standard x402 payment -> resource retry -> audit
```

## Packages (implemented)

- `@agenttab/core`: product types, fail-closed policy, execution state machine, `paymentPolicySchema`.
- `@agenttab/dflow`: DFlow quote/order client and exact-deficit planner.
- `@agenttab/x402`: thin official `BeforePaymentCreation` funding hook (no wire reimplementation).
- `@agenttab/fetch`: drop-in agent SDK (`createAgentTabFetch` /
  `createAgentTabClient`) over `@x402/fetch` + AgentTab funding + audit.
- `apps/gateway`: control plane with persistence, funding modes, Mainnet helpers.
  - Durable SQLite: executions, events, spend ledger, **policy** (when `dbPath` is on disk).
  - Read-only audit: `GET /v1/executions?limit=&state=&requestHash=&reusable=`
    + `pnpm audit:recent` / `pnpm parked` (HTTP when `AGENTTAB_GATEWAY_URL` is set).
  - Read-only `POST /v1/preview` (policy only; no execution, no fund).
  - Operator console at `/ui` (`/ui/app.css`, `/ui/app.js`): Now (pending
    decisions), Ledger (execution lifecycle), Policy (stance, limits, preview).
  - Optional `AGENTTAB_ADMIN_TOKEN` gates operator reads/writes (policy, spend,
    balances, unfiltered lists, approve, deny).
  - Optional `AGENTTAB_AGENT_TOKEN` gates preview/fund/pay/fulfill/get-by-id
    and `requestHash` resume. Admin bearer is also accepted on those routes.
    `AGENTTAB_AGENT_TOKENS` maps extra named secrets → `agentId` on executions,
    spend, audit, and `/ui`. Single-token identity is `AGENTTAB_AGENT_ID`
    (default `agent`). Local demos leave tokens unset and stay unattributed.
  - `GET /health` includes `parkedCount` and rolling 24h spend; `GET /v1/spend` remains.
    Daily-cap reservation is synchronous (`tryReserveOperationSpend`) before
    funding I/O so overlapping in-flight funds cannot both clear the gateway
    cap or an applicable per-agent `maxDailyUsdMicrosByAgent` quota. Identity
    for that quota is the gateway-stamped bearer `agentId`, never the intent.
    Reservations occupy both applicable bounds; `/health` and `GET /v1/spend`
    report realized spend only after funding succeeds.
  - Optional `AGENTTAB_NOTIFY_URL` webhook on first park / approve / deny /
    interrupted. Bounded retry (3 attempts) inside a 300ms payment-path
    budget (overridable via `AGENTTAB_NOTIFY_BUDGET_MS` /
    `AGENTTAB_NOTIFY_ATTEMPT_TIMEOUT_MS`; defaults assume a local receiver);
    a hanging webhook is recorded as `timeout` and cannot stall
    park/approve/deny. Each attempt is durable in
    SQLite `notify_deliveries` and visible on `GET /v1/executions/:id` and
    `/ui`. `AGENTTAB_NOTIFY_SECRET` adds `x-agenttab-signature` (HMAC-SHA256).
    Notify failure never changes funding. `pnpm notify:sink` is a local receiver.
  - `GET /openapi.json` is the live HTTP contract (test-locked to Hono routes).
- `examples/*`: local HMAC demo, Devnet official x402, Mainnet gated path,
  plus `neutral-merchant` / `remote-agent` for remote HTTP adoption.
- `tools/*`: Devnet/Mainnet wallet setup, preflight, facilitator health, broadcast gate.

## Planned / not required for the core thesis

- A separate frontend app is not part of this repo. The operator surface is
  the gateway console at `/ui`, served from the same process as the control
  plane so Docker and `demo:stack` stay one product.

## Execution state machine

```text
discovered
  -> denied
  -> approval_required
  -> approved
       -> denied   (live policy hard-denied after human approval)
  -> funding_submitted
       -> denied   (hard-deny before a chain side-effect receipt)
  -> funded
  -> payment_submitted
  -> paid
  -> fulfilled

Any submitted state may move to failed, but never back to an earlier state.
`approved -> denied` is a terminal fail-closed path when current policy
would deny; it is not a rewind. Retries resume from the durable state using
the same idempotency key.
```

## Important design choice

The production-compatible path uses two independent settlements when the
payment asset is missing:

1. DFlow funding transaction into the agent wallet.
2. Standard x402 payment transaction through the merchant's facilitator.

This preserves compatibility with existing x402 merchants. A future custom
scheme may combine swap and settlement, but requiring merchant adoption would
weaken the initial product.

## Fidelity layers

| Layer | Funding | Payment | Broadcast |
|-------|---------|---------|-----------|
| Local hero / `pnpm demo:judge` | mock exact-deficit | local HMAC | never |
| `live-quote` / `live-sim` gateway | real DFlow quotes (+ sim) | local HMAC | never |
| Devnet | mint stand-in (custom tUSDC) | official x402 + facilitator | Devnet only |
| Mainnet dry-run | real DFlow + sim | payload build, no settle required | forced off |
| Mainnet armed oneshot | real DFlow | real x402 settle | triple-gated |

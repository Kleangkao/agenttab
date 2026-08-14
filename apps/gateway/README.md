# AgentTab gateway

Buyer-side policy, exact-deficit funding, approve/deny, and audit.

This package is **not on npm**. Run it from the repo or the public image
`ghcr.io/kleangkao/agenttab-gateway`.

```bash
pnpm demo:stack          # UI http://127.0.0.1:8787/ui
pnpm demo:adopt          # one-shot HTTP preview / approve / deny
# contract: http://127.0.0.1:8787/openapi.json
```

`POST /v1/preview` never funds. Approve still spends. Observe is not a dry-run.

## Operator CLIs

`pnpm policy:get|set|mode|allow|cap`, `pnpm parked`, `pnpm approve`, `pnpm deny`,
`pnpm preview`, `pnpm audit:recent`, `pnpm notify:sink`.

When `AGENTTAB_ADMIN_TOKEN` is set, operator reads/writes need
`Authorization: Bearer …`. When `AGENTTAB_AGENT_TOKEN` is set, preview / fund /
pay / fulfill need the agent bearer (admin also works). Several agents: set
`AGENTTAB_AGENT_TOKENS` on the gateway; each agent process keeps using
`AGENTTAB_AGENT_TOKEN` with its own secret. `GET /v1/executions` and
`pnpm audit:recent` include `agentId`.

## Notify

Delivery retries up to three times inside a 300ms payment-path budget.
A hanging webhook is recorded as `timeout`, not an HTTP status. Each
attempt is stored and shown on `/ui`, `GET /v1/executions/:id`
(`notifyDeliveries`), and `pnpm audit:recent` with `AUDIT_OPERATION_ID`.
Failure never reverses a park.

```bash
pnpm notify:sink
# other terminal:
# $env:AGENTTAB_NOTIFY_URL="http://127.0.0.1:8792/hook"
# $env:AGENTTAB_NOTIFY_SECRET="optional-hmac"
pnpm demo:stack
```

See [docs/ADOPT.md](../../docs/ADOPT.md).

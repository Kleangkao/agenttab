# AgentTab product brief

## The problem

x402 gives agents a standard way to discover and pay for an HTTP resource, but
the payer still needs enough of the exact asset requested by the merchant. An
agent wallet may have sufficient total value in SOL, BONK or another supported
Solana token while lacking the requested USDC balance. The request then stops
at `insufficient_funds` and requires a human to rebalance the wallet.

## Product thesis

An agent should be able to acquire a paid resource when it has enough approved
value, without receiving open-ended permission to trade or spend.

AgentTab turns a payment challenge into a bounded workflow:

1. Parse a standard payment challenge.
2. Bind it to the original HTTP request and merchant identity.
3. Evaluate a human-owned policy.
4. Use the requested asset directly when sufficient.
5. Otherwise acquire only the deficit through DFlow.
6. Complete the payment through the existing payment protocol.
7. Retry the exact original request.
8. Store an idempotent, append-only audit receipt.

## Initial customer

Developers operating local or hosted AI agents that call paid APIs, MCP tools,
data sources, inference services or other machine-accessible resources on
Solana.

## Initial integration

The first protocol adapter targets x402 exact payments on Solana. AgentTab is a
buyer-side wrapper, so an existing x402 merchant does not need to integrate an
AgentTab-specific payment scheme.

## Differentiation

- Pay from an approved portfolio, not only the requested token balance.
- Human-owned policies that fail closed when price or identity is uncertain.
- Acquire only the payment deficit rather than rebalancing the whole wallet.
- Link funding, payment and resource delivery in one auditable state machine.
- Bring-your-own signer: the SDK never requires raw private key access.
- Protocol adapters are separate from funding adapters.

## Product modes

### Observe

Same fail-closed human-approval loop as Approve. The only current difference is
that unknown USD parks for review (`approval_required`) instead of denying.
Approving still runs funding — observe is **not** estimate-only / dry-run.

### Approve

Prepare an execution plan and require a human approval for every payment
(`pnpm approve -- <operationId>` or `POST /v1/approvals/:id`). Parked
payments can also be rejected (`pnpm deny -- <operationId>` or
`POST /v1/denials/:id`) without funding.

### Autopay

Execute only when every policy condition passes. Any missing input becomes a
denial, not a permissive default.

## Non-goals for v1

- General-purpose portfolio rebalancing.
- Speculative trading or investment advice.
- Holding customer funds.
- Replacing x402 facilitators.
- Supporting arbitrary unknown tokens.
- Recurring merchant debit authority.
- Hiding price impact, slippage or network costs.

## Product-grade acceptance criteria

- The same payment intent cannot settle twice.
- A retry cannot silently increase the approved amount.
- Funding transactions must match a server-produced execution plan.
- Merchant, network, asset and amount are bound to the approval record.
- Private keys are supplied through a signer interface and never logged.
- Audit records connect the HTTP challenge, policy decision, DFlow order,
  payment settlement and fulfilled response.
- Autopay remains disabled when daily spend, USD value, token verification or
  merchant identity cannot be determined.

## Current maturity

- Local vertical slice and `pnpm demo:judge` prove the full audit path without funds.
- Devnet proves official x402 settle (funding via mint stand-in for custom tUSDC).
- Mainnet dry-run and gated oneshot prove real DFlow exact-deficit + x402 settle.
- Policy and spend caps survive gateway restarts when using an on-disk SQLite path.
- Read-only audit is available via `GET /v1/executions` and `pnpm audit:recent`
  (including the fulfilled Mainnet receipt DB under `.data/mainnet/`).
- When `AGENTTAB_ADMIN_TOKEN` is set, operator reads (policy/spend/balances/lists)
  use the same bearer as approve/deny. When `AGENTTAB_AGENT_TOKEN` is set,
  preview/fund/pay/fulfill and requestHash resume require that bearer (or admin).
- Operator product is the `/ui` console (Now / Ledger / Policy)
  plus HTTP + CLI (`policy:get|set|mode`, `approve`,
  `deny`, `parked`, `audit:recent`, `POST /v1/preview`, `GET /openapi.json`), seeded from `AGENTTAB_POLICY_PATH` /
  `AGENTTAB_POLICY_JSON` / `examples/policies/*`. See `docs/ADOPT.md`.
  Approve (and observe) return `AgentTabApprovalRequiredError` with
  `operationId` so agents can approve and retry the **same** operation, including
  across process restarts via gateway `requestHash` lookup. Deny is terminal
  for that id. `pnpm demo:adopt` proves the HTTP loop in one command.
- Gateway exposes `agenttab-*` binaries after build (`agenttab-gateway`,
  `agenttab-approve`, `agenttab-deny`, …) and ships them in
  `ghcr.io/kleangkao/agenttab-gateway`.
  Agent libraries are on npm; `@agenttab/fetch@0.1.2` includes preview and deny.
- Preview never funds. Observe is not a dry-run — approving still funds.


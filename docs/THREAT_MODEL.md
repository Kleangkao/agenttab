# Threat model

## Assets to protect

- Agent wallet funds and signer authority.
- Human-authored policy and approval records.
- Merchant identity and payment destination.
- Idempotency state and audit integrity.
- DFlow and RPC credentials.
- Paid resource responses that may contain private data.

## Primary threats

### Malicious payment challenge

A resource can return a challenge with an unexpected recipient, network,
asset, amount or expiry. AgentTab binds approvals to the normalized challenge
and denies merchants outside the allowlist.

### Approval used as a policy override

A parked payment can sit while policy or spend changes. Human approval is
not a universal override: `ensurePaymentAsset` re-evaluates the live policy,
including rolling daily spend, challenge expiry, and allowlists. Hard denials
become terminal `denied` with `policy.denied` and do not fund. Spend is
reserved synchronously against `maxDailyUsdMicros` before funding I/O, so
two overlapping in-flight funds cannot both pass a cap that only fits one.
Already `funded` or `paid` operations are not clawed back. Interrupted funding with
a **side-effect receipt** (chain state already mutated) still resumes even
if policy later denies. A plan-only interruption is only a quote: resume
re-evaluates live policy and fails closed.

### Retry double spend

Network failure after settlement can cause an agent to retry. Every flow uses a
stable idempotency key derived from the request, challenge and caller-supplied
operation ID. Settlement signatures are persisted before resource retry.

### Funding quote substitution

An attacker can replace a prepared DFlow transaction. The signer boundary must
verify the message against the approved execution plan before signing.

### Policy bypass through missing data

Unknown USD value, rolling spend, token verification or merchant identity
results in `deny` or `approval_required`; it never results in autopay.

### Approval as a universal override

A human approval satisfies `approval_required` and nothing else. Current
policy is re-evaluated before new spend: daily cap, merchant denylist,
expired challenge, and asset allowlists still fail closed. Spend is
committed when funding succeeds so later approvals see the rolling cap.
Already `funded` / `paid` operations are not clawed back; in-flight
`funding_submitted` resume is not aborted by a later tighten.

### Prompt injection

Merchant content and model output cannot modify policies. Policy changes use a
separate authenticated control plane and require a human action.

### Exposed gateway without agent auth

`POST /v1/fund` can spend under a live policy. When the process is reachable
beyond loopback, set `AGENTTAB_AGENT_TOKEN` (and `AGENTTAB_ADMIN_TOKEN` for
operator routes). Unset tokens keep the local-demo trust model.

### Key exfiltration

Core packages accept a signer interface. Raw keys are not accepted by public
orchestrator APIs and must never enter logs, traces or audit payloads.

### Dust and account-rent abuse

Funding tokens are allowlisted. Plans cap transaction fees, associated-token
account creation, route price impact and attempts per rolling window.

### Shared agent bearer

`AGENTTAB_AGENT_TOKEN` is one secret. Anyone who holds it can spend up to the
gateway policy. `AGENTTAB_AGENT_TOKENS` attributes executions and spend to a
named `agentId` so an operator can revoke one process, but it does **not**
split `maxDailyUsdMicros`. A compromised named token can still exhaust the
global daily cap. Per-agent quotas are out of scope until they have an
explicit policy schema and fail-closed interaction with the gateway cap.

### Operator notify is fail-open

`AGENTTAB_NOTIFY_URL` is an operator convenience, not a control-plane
guarantee. Park, fund, and deny proceed even when every webhook attempt
fails or times out. The notify sequence may add at most 300ms to a
payment-path operation by default (`AGENTTAB_NOTIFY_BUDGET_MS`); a webhook
that never responds is recorded as `timeout` on `notifyDeliveries`,
distinct from an HTTP 5xx. Treat that log, `/ui`, and `pnpm audit:recent`
as the source of truth for "was I told?", not receipt of the HTTP POST.

## Production blockers

- External security review of any hosted signer implementation.
- Funding quote substitution: live-sim/funding plans bind `transactionSha256` to
  the serialized wire bytes; signers refuse mismatches before signing.
- Durable transactional storage for idempotency and spend counters (SQLite;
  operation-keyed spend prevents double-counting a payment).
- Post-funding balance gate: on-chain funding cannot mark `funded` unless the
  refreshed payment-asset balance covers the required amount.
- Operational secret rotation and incident response.
- Compliance review for the intended deployment jurisdictions and merchants.


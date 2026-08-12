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


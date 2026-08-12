# Adopt AgentTab

Cold-start path for someone who wants to **control** AgentTab and keep using it —
not just run a Buildathon demo.

Today the supported product surface is:

1. Run the gateway (policy + funding + audit)
2. Wrap agent HTTP with `@agenttab/fetch`
3. Operate with policy / approve / audit CLIs

```text
policy JSON
  -> gateway
  -> createAgentTabClient({ gatewayBaseUrl })
  -> paid fetch
  -> (if needed) AgentTabApprovalRequiredError.operationId
  -> agenttab-approve / pnpm approve -- <same operationId>
  -> retry fetch with the SAME operationId
  -> agenttab-audit / pnpm audit:recent
```

## Prerequisites

- Node.js ≥ 22
- This repository: `git clone https://github.com/Kleangkao/agenttab.git`
- `pnpm install && pnpm --filter @agenttab/gateway build`

Until packages are published, run the gateway and CLIs from this repo:

```bash
pnpm demo:gateway          # or: pnpm --filter @agenttab/gateway exec agenttab-gateway
pnpm policy:get
pnpm policy:set -- examples/policies/approve.local.json
pnpm approve -- <operationId>
pnpm audit:recent
```

After `pnpm --filter @agenttab/gateway build`, the same binaries are available as
`agenttab-gateway`, `agenttab-policy-*`, `agenttab-approve`, `agenttab-audit`
via the package `bin` field.

## 1. Choose a policy

Edit merchant origins / caps / mode:

- [`examples/policies/autopay.local.json`](../examples/policies/autopay.local.json)
- [`examples/policies/approve.local.json`](../examples/policies/approve.local.json)
- [`examples/policies/observe.local.json`](../examples/policies/observe.local.json)

| Mode | Behavior |
|------|----------|
| `autopay` | Pay only when every policy check passes (fail-closed) |
| `approve` | Park at `approval_required` until a human approves that **operationId** |
| `observe` | Same park-then-approve loop as `approve`. Unknown USD parks instead of deny. **Approving still funds** — this is not a dry-run. |

## 2. Start the gateway

```bash
# PowerShell
$env:AGENTTAB_POLICY_PATH="examples/policies/approve.local.json"
$env:AGENTTAB_POLICY_REPLACE="1"
$env:MERCHANT_ORIGIN="http://127.0.0.1:8791"
$env:AGENTTAB_INITIAL_USDC_ATOMIC="0"
pnpm demo:gateway
```

- First boot: file seeds durable SQLite policy
- Later boots: SQLite wins unless `AGENTTAB_POLICY_REPLACE=1` or you `pnpm policy:set`

## 3. Start a merchant (no AgentTab imports)

```bash
pnpm demo:neutral-merchant
```

## 4. Wrap your agent (stable operationId)

```ts
import {
  createAgentTabClient,
  createLocalSmokeScheme,
  requestPaidResource,
  stablecoinAtomicAsUsdMicros
} from "@agenttab/fetch";

const resourceUrl = "http://127.0.0.1:8791/v1/market-snapshot";

const agent = createAgentTabClient({
  gatewayBaseUrl: "http://127.0.0.1:8787",
  // Local smoke only. Production: ExactSvmScheme(svmSigner) on your network.
  schemes: [{ network: "solana:local", client: createLocalSmokeScheme() }],
  getUsdValueMicros: async ({ amountAtomic }) =>
    stablecoinAtomicAsUsdMicros(amountAtomic)
});

// Naive fetch() retries reuse the parked operationId automatically.
// Or close the loop in one call:
const result = await requestPaidResource(agent, resourceUrl, { method: "GET" }, {
  onApprovalRequired: async (error) => {
    console.error(`Approval required: pnpm approve -- ${error.operationId}`);
    return "abort"; // or "approve" if this process may grant it
  }
});
```

Smoke without wiring your own snippet: `pnpm demo:remote-agent`.

## 5. Approve loop (same operationId)

1. Agent fetch throws `AgentTabApprovalRequiredError` with `error.operationId`
2. Operator: `pnpm approve -- <operationId>` (gateway funds under that id)
3. Agent retries the **same** request (same method + URL + body). The parked
   `operationId` is reused from memory **or** looked up on the gateway by
   `requestHash`, so a one-shot CLI can just be run again after approve
4. `pnpm audit:recent` (local SQLite, or `GET /v1/executions` when
   `AGENTTAB_GATEWAY_URL` is set and `AGENTTAB_DB_PATH` is not) or
   `agent.gateway?.getExecution(operationId)`

`requestPaidResource(..., { onApprovalRequired: () => "approve" })` does steps
2–3 in-process when the agent process is allowed to approve (tests, trusted ops).

A new `operationId` after approve starts a **new** execution that needs approval
again. That only happens if you pass a `createOperationId` that returns a fresh
id on every call, or if the previous execution already reached `fulfilled` /
`denied` / `failed`.

Live policy changes: `pnpm policy:set -- examples/policies/autopay.local.json`
(no restart). Optional `AGENTTAB_ADMIN_TOKEN` gates `PUT /v1/policy`.

## 6. Higher fidelity

| Goal | Command |
|------|---------|
| Automated remote smoke | `pnpm integration:remote` |
| Devnet + facilitator | `pnpm integration:devnet-remote` |
| Prior Mainnet receipt | `AGENTTAB_DB_PATH=.data/mainnet/gateway-mainnet.sqlite pnpm audit:recent` |
| Pack libraries locally (no publish) | `pnpm pack:check` |

No Mainnet spend without explicit human approval and the triple broadcast gates.

## What this is not

- Not an npm install story yet (clone https://github.com/Kleangkao/agenttab + pnpm workspace)
- Not a custodial signer or hosted SaaS
- Not a merchant SDK — merchants keep standard x402
- Not a web dashboard — HTTP + CLI is the operator surface

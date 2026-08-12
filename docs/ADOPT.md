# Adopt AgentTab

Cold-start path for someone who wants to **control** AgentTab and keep using it —
not just run a Buildathon demo.

Today the supported product surface is:

1. Run the gateway (policy + funding + audit) — clone, Docker, or compose
2. Wrap agent HTTP with `@agenttab/fetch`
3. Operate from `/ui`, HTTP (`/v1/preview`, policy, approve, audit), or CLIs
   (`pnpm preview -- examples/intents/preview.local.json` never funds)

```text
policy JSON
  -> gateway
  -> createAgentTabClient({ gatewayBaseUrl })
  -> paid fetch
  -> (if needed) AgentTabApprovalRequiredError.operationId
  -> agenttab-approve / pnpm approve -- <same operationId>
     or agenttab-deny / pnpm deny -- <same operationId>
  -> retry fetch with the SAME operationId (after approve only)
  -> agenttab-audit / pnpm audit:recent
```

## Prerequisites

Split the two roles:

| Role | What you install | Where |
|------|------------------|--------|
| **Agent process** | `@agenttab/fetch` (+ `@x402/*` scheme client) | Your app (`pnpm add …`) |
| **Operator / control plane** | Gateway image/UI + `agenttab-approve` / policy / audit CLIs | GHCR, `docker compose`, or this repo |

- Node.js ≥ 22
- Agent SDK (npm): `pnpm add @agenttab/fetch @x402/core @x402/fetch @x402/svm`
- Gateway/CLIs: `git clone https://github.com/Kleangkao/agenttab.git` then
  `pnpm install && pnpm --filter @agenttab/gateway build`

The gateway remains a workspace app (not on npm) until a later release.
A public image is on GHCR (`ghcr.io/kleangkao/agenttab-gateway`). It bakes
`examples/policies/approve.local.json` (merchant `8791`), serves `/ui`, and
ships the operator CLIs. `AGENTTAB_POLICY_JSON` can seed policy without a
mounted file. Set `AGENTTAB_ADMIN_TOKEN` before exposing the port.

```bash
docker pull ghcr.io/kleangkao/agenttab-gateway:latest
docker compose up --build
# or:
docker run --rm -p 8787:8787 \
  -e HOST=0.0.0.0 \
  -e AGENTTAB_ADMIN_TOKEN=change-me \
  -v agenttab-data:/data \
  ghcr.io/kleangkao/agenttab-gateway:latest
```

Open `http://127.0.0.1:8787/ui`. Preview is read-only; **approve still funds**.
Observe mode is not a dry-run.

Or build locally: `docker build -f apps/gateway/Dockerfile -t agenttab-gateway .`

From the **cloned repo** root:

```bash
pnpm demo:stack            # gateway :8787 + merchant :8791 in one process
# or: pnpm demo:gateway  and  pnpm demo:neutral-merchant
pnpm policy:get
pnpm policy:set -- examples/policies/approve.local.json
pnpm approve -- <operationId>
pnpm deny -- <operationId>
pnpm audit:recent
```

`pnpm demo:stack` prints the operator UI (`http://127.0.0.1:8787/ui`). Then
`pnpm demo:remote-agent` in a second terminal. Parked payments can be approved
or denied from `/ui`.

After `pnpm --filter @agenttab/gateway build`, the same binaries are available as
`agenttab-gateway`, `agenttab-policy-*`, `agenttab-approve`, `agenttab-deny`,
`agenttab-audit` via the package `bin` field.

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
2. Operator: `pnpm approve -- <operationId>` (gateway funds under that id),
   or `pnpm deny -- <operationId>` (terminal; that id will not fund)
3. Agent retries the **same** request (same method + URL + body). The parked
   `operationId` is reused from memory **or** looked up on the gateway by
   `requestHash`, so a one-shot CLI can just be run again after approve
4. `pnpm audit:recent` (local SQLite, or `GET /v1/executions` when
   `AGENTTAB_GATEWAY_URL` is set) or `agent.gateway?.getExecution(operationId)`

`requestPaidResource(..., { onApprovalRequired: () => "approve" })` does steps
2–3 in-process when the agent process is allowed to approve (tests, trusted ops).

A new `operationId` after approve starts a **new** execution that needs approval
again. That only happens if you pass a `createOperationId` that returns a fresh
id on every call, or if the previous execution already reached `fulfilled` /
`denied` / `failed`.

Live policy changes: `pnpm policy:set -- examples/policies/autopay.local.json`
(no restart), the operator UI, or `PUT /v1/policy`.
`AGENTTAB_ADMIN_TOKEN` gates policy writes, `POST /v1/approvals`, and
`POST /v1/denials`. `POST /v1/preview` / `agent.gateway?.preview(intent)`
evaluates policy without creating an execution or funding. Deny is terminal
for that `operationId`; a later fetch of the same URL starts a new execution.

Optional `AGENTTAB_NOTIFY_URL` receives a fail-open JSON POST on first park,
approve, and deny (`{ event, operationId, state, merchantOrigin, resource, … }`).
Preview never notifies.

## 6. Higher fidelity

| Goal | Command |
|------|---------|
| Automated remote smoke | `pnpm integration:remote` |
| Devnet + facilitator | `pnpm integration:devnet-remote` |
| Prior Mainnet receipt | `AGENTTAB_DB_PATH=.data/mainnet/gateway-mainnet.sqlite pnpm audit:recent` |
| Pack libraries locally (no publish) | `pnpm pack:check` |
| Publish dry-run (no registry write) | `pnpm release:dry` |

No Mainnet spend without explicit human approval and the triple broadcast gates.

## What this is not

- Not a hosted SaaS — you run the gateway locally (or your own host)
- Not a custodial signer or merchant SDK — merchants keep standard x402
- Operator surface is `/ui` + HTTP + CLI (same control plane; preview does not fund)
- Gateway is not on npm yet (GHCR image or clone); agent libraries are `@agenttab/*` on npm

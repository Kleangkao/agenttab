# AgentTab

[![CI](https://github.com/Kleangkao/agenttab/actions/workflows/ci.yml/badge.svg)](https://github.com/Kleangkao/agenttab/actions/workflows/ci.yml)

AgentTab is a buyer-side funding layer for agent-native payments on Solana.
It lets an agent pay a standard x402 challenge even when its wallet does not
already hold the requested asset.

The agent does not choose trades freely. A human-owned policy decides whether
the merchant, amount, funding asset, slippage and rolling spend are acceptable.
If approved, AgentTab uses DFlow to acquire only the payment deficit, completes
the standard payment, retries the original request and records an audit trail.

```text
HTTP request
  -> 402 challenge
  -> policy evaluation
  -> fund missing asset through DFlow
  -> standard x402 payment
  -> retry request
  -> fulfilled response + audit receipt
```

## Product boundary

AgentTab is not a new payment protocol, a trading bot, a custodian or an x402
facilitator. It is funding and policy middleware on the buyer side. Merchants
continue using standard x402.

See [PRODUCT.md](docs/PRODUCT.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md),
[THREAT_MODEL.md](docs/THREAT_MODEL.md), and **[ADOPT.md](docs/ADOPT.md)** for the
cold-start control path (policy file → remote agent → approve/audit CLI).

Source: [github.com/Kleangkao/agenttab](https://github.com/Kleangkao/agenttab).
Agent libraries are on npm (`@agenttab/fetch`, `@agenttab/core`, `@agenttab/x402`,
`@agenttab/dflow`). The gateway is run from this repo or
`ghcr.io/kleangkao/agenttab-gateway` (`docker compose up --build`; UI at `/ui`).

## Current status

Core thesis is implemented and proven at multiple fidelity layers:

| Path | What is real | Command |
|------|--------------|---------|
| **Judge / local** | Policy + exact-deficit funding + audit (mock DFlow, local HMAC pay) | `pnpm demo:judge` |
| **Local 3-terminal** | Same as judge, with HTTP gateway + paid API | `demo:gateway` / `paid-api` / `agent` |
| **Local adopt stack** | Gateway + merchant in one process; `/ui` + remote agent | `pnpm demo:stack` then `pnpm demo:remote-agent` |
| **Live DFlow quotes** | Real DFlow Trade API quotes, still no broadcast | `AGENTTAB_FUNDING_MODE=live-quote` |
| **Live DFlow sim** | Real order + `simulateTransaction`, still no broadcast | `AGENTTAB_FUNDING_MODE=live-sim` |
| **Devnet** | Official `@x402/*` + facilitator; funding via mint stand-in for custom tUSDC | `pnpm devnet:agent` |
| **Mainnet dry-run** | Real DFlow plan + sim + local sign; broadcast forced off | `pnpm mainnet:agent` |
| **Mainnet E2E** | Real DFlow fund + real x402 settle + fulfill (triple-gated) | `pnpm mainnet:oneshot` when armed |

Packages and apps:

- `@agenttab/core` policy engine and execution state machine
- `@agenttab/dflow` quote client and exact-deficit planner
- `@agenttab/x402` official pre-payment funding hook
- `@agenttab/fetch` drop-in agent `fetch` wrapper (policy → fund → x402 → audit)
  plus `createAgentTabClient` for remote gateway adoption
- `apps/gateway` HTTP control plane with SQLite audit/idempotency store and
  funding modes `mock` | `live-quote` | `live-sim` | `devnet-mint`
- Local / Devnet / Mainnet examples under `examples/`
- `examples/neutral-merchant` + `examples/remote-agent`: AgentTab-agnostic
  merchant + remote `@agenttab/fetch` agent (mock smoke and Devnet facilitator)
- Setup + safety tools under `tools/` (`mainnet:facilitators`, live broadcast gate)
- Durable policy + spend in on-disk SQLite; operator UI `/ui` plus CLIs:
  `pnpm policy:get|set`, `pnpm approve`, `pnpm audit:recent`
- Example policies under `examples/policies/`; start guide in `docs/ADOPT.md`

Do not send real Mainnet funds without an explicit budget approval and the
triple broadcast gates below.

## Fastest path to adopt (operators + developers)

Libraries are on npm (`@agenttab/fetch`, `@agenttab/core`, `@agenttab/x402`,
`@agenttab/dflow`). The gateway is clone-and-run from this repo or the public GHCR image
(`ghcr.io/kleangkao/agenttab-gateway`).

Follow **[docs/ADOPT.md](docs/ADOPT.md)**:

1. `pnpm add @agenttab/fetch@0.1.2` in the agent process
2. Start a gateway (`docker compose up --build` or clone this repo) and set policy
3. Point `createAgentTabClient({ gatewayBaseUrl })` at that gateway
4. Use `/ui`, `POST /v1/preview`, `pnpm policy:set`, `pnpm approve`, `pnpm deny`, `pnpm audit:recent`

## Fastest convincing demo (one command)

```bash
pnpm demo:judge
```

Prints the audit timeline for **402 → policy → exact-deficit fund → pay → fulfill**
in-process. No open ports, no chain, no funds. Use this for judges and CI.

Inspect the highest-fidelity Mainnet receipt (already fulfilled, no new spend):

```bash
AGENTTAB_DB_PATH=.data/mainnet/gateway-mainnet.sqlite pnpm audit:recent
```

Then point to higher fidelity live paths (still prefer no-spend):

- Devnet for real Solana x402 settlement (`pnpm devnet:setup` then `devnet:agent`)
- Mainnet dry-run for real DFlow simulation + broadcast refusal (`pnpm mainnet:agent`)

## Local hero demo (three terminals)

Terminal 1:

```bash
pnpm demo:gateway
```

Terminal 2:

```bash
pnpm demo:paid-api
```

Terminal 3:

```bash
pnpm demo:agent
```

### Live DFlow quotes (no funds, no API key)

```bash
# PowerShell
$env:AGENTTAB_FUNDING_MODE="live-quote"
pnpm demo:gateway
```

Then run `pnpm demo:paid-api` and `pnpm demo:agent` as usual. The gateway plans
the USDC deficit against live DFlow quotes; balances and signatures remain
simulated and nothing is broadcast.

### Live DFlow simulate (still no broadcast)

```bash
# PowerShell
$env:AGENTTAB_FUNDING_MODE="live-sim"
# optional: $env:SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
pnpm demo:gateway
```

Or run the network test: `pnpm --filter @agenttab/gateway test -- live-sim-network`.

### Solana Devnet (official @x402 + x402.org facilitator)

Uses disposable wallets under `.data/devnet/` (gitignored), a local test SPL mint
(because Circle's USDC faucet requires interactive captcha), and the no-key
test facilitator `https://x402.org/facilitator`.

```bash
pnpm devnet:setup
# terminal 1
pnpm devnet:paid-api
# terminal 2 — FORCE_DEFICIT=1 by default: drain → mint deficit → pay → fulfill
pnpm devnet:agent
# already-funded path:
# $env:FORCE_DEFICIT="0"; pnpm devnet:agent
```

Default Devnet demo forces an insufficient tUSDC balance, then
`DevnetMintFundingAdapter` mints the exact deficit on-chain (DFlow stand-in;
DFlow has no Devnet liquidity for the custom mint), then official x402
settlement completes via the facilitator. Audit must include `funding.confirmed`,
not only `funding.not_required`. No mainnet funds are used.

**Important:** the Devnet paid API must not embed `recentBlockhash` in the 402
challenge (`ExactSvmScheme()` without `rpcUrl`). Embedded blockhashes expire /
rotate during on-chain funding and cause settle failures. The client fetches a
fresh blockhash after the funding hook returns.

```bash
pnpm check
pnpm test
pnpm demo:judge
```

## Agent integration (`@agenttab/fetch`)

For a real agent (not the local HMAC demo), wrap paid HTTP once:

```bash
pnpm add @agenttab/fetch @x402/core @x402/fetch @x402/svm
```

Run a gateway from this repo (see [docs/ADOPT.md](docs/ADOPT.md)), then:

```ts
import {
  createAgentTabClient,
  requestPaidResource,
  stablecoinAtomicAsUsdMicros
} from "@agenttab/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const agent = createAgentTabClient({
  gatewayBaseUrl: "http://127.0.0.1:8787",
  schemes: [{ network: "solana:mainnet", client: new ExactSvmScheme(svmSigner) }],
  getUsdValueMicros: async ({ amountAtomic }) =>
    stablecoinAtomicAsUsdMicros(amountAtomic)
});

const result = await requestPaidResource(
  agent,
  "https://merchant.example/v1/resource",
  { method: "GET" },
  {
    onApprovalRequired: async (error) => {
      console.error(`pnpm approve -- ${error.operationId}`);
      return "abort";
    }
  }
);
```

See [`packages/fetch/README.md`](packages/fetch/README.md). Mainnet oneshot and
payment-only examples already use this surface.

### Remote adoption smoke (no chain)

Validates that an existing agent can adopt AgentTab over HTTP against a merchant
that does not import AgentTab:

```bash
pnpm integration:remote
```

### Devnet remote topology (real x402 facilitator)

Same external-style wiring with disposable Devnet wallets and facilitator settle:

```bash
pnpm integration:devnet-remote
```

Or three terminals:

```bash
# Terminal 1
$env:MERCHANT_ORIGIN="http://127.0.0.1:8791"
pnpm demo:gateway:devnet

# Terminal 2
pnpm demo:neutral-merchant:devnet

# Terminal 3
pnpm demo:remote-agent:devnet
```

Manual three-terminal variant (mock funding, force deficit):

```bash
# Terminal 1
$env:MERCHANT_ORIGIN="http://127.0.0.1:8791"
$env:AGENTTAB_INITIAL_USDC_ATOMIC="0"
pnpm demo:gateway

# Terminal 2
pnpm demo:neutral-merchant

# Terminal 3
pnpm demo:remote-agent
```

## Mainnet

Isolated wallets live under gitignored `.data/mainnet/`.

```bash
pnpm mainnet:setup
pnpm mainnet:facilitators   # read-only Dexter + PayAI /health + /supported
pnpm mainnet:preflight
pnpm mainnet:agent          # dry-run: live-sim + LocalKeypairSigner, broadcast off
pnpm mainnet:paid-api       # local merchant on :4022
pnpm mainnet:oneshot        # dry-run unless triple-gated
```

### Facilitators

| Facilitator | Role |
|-------------|------|
| Dexter (`https://x402.dexter.cash`) | Preferred when settle/sim is healthy; advertises Mainnet exact floor (~800 atomic) |
| PayAI (`https://facilitator.payai.network`) | Proven Mainnet settle backup; set `FACILITATOR_URL` |

`/health` + `/supported` being green does **not** prove settle works. Re-check
live verify/settle before any armed run. Merchant destination USDC ATA must
exist before the first payment (create once if missing).

### Broadcast gates

Broadcast requires all of:

1. `MAINNET_ONE_SHOT_MODE=broadcast`
2. `AGENTTAB_BROADCAST=1`
3. `AGENTTAB_MAINNET_EXECUTION_APPROVED=I_UNDERSTAND_THIS_WILL_SPEND_REAL_FUNDS`

Plus successful simulation, plan type `live-funding-plan`, and policy envelope
checks (`evaluateBroadcastGate` / live gate script). Standalone
`pnpm demo:gateway` refuses `AGENTTAB_BROADCAST=1`.

Do **not** arm broadcast without a fresh live gate and an explicit real-money
approval.

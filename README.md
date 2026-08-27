# AgentTab

[![CI](https://github.com/Kleangkao/agenttab/actions/workflows/ci.yml/badge.svg)](https://github.com/Kleangkao/agenttab/actions/workflows/ci.yml)

**Keep agents moving when payments fall short.**

When an agent hits an x402 paywall without the exact asset, AgentTab covers
only the deficit (via DFlow, under your policy), completes the payment, and
retries the same request. Merchants stay on standard x402.

```text
request → 402 → policy → fund deficit → pay → retry → audit
```

## What it is / isn't

AgentTab is buyer-side funding and policy middleware. It is **not** a new
payment protocol, trading bot, custodian, or x402 facilitator.

A human-owned policy decides merchant, amount, funding asset, slippage, and
rolling spend. If approved, AgentTab acquires **only the missing amount**,
pays, and continues — with an append-only audit trail.

## Try it

Judge path: **[docs/DEMO.md](docs/DEMO.md)**.

```bash
pnpm demo:stack
# open http://127.0.0.1:8787/ui  (local mock — confirm buy-and-continue)
```

One-command local audit (no browser, no chain):

```bash
pnpm demo:judge
```

Same loop already settled on Solana Mainnet (no new spend):

- [DFlow deficit tx](https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg)
- [x402 pay tx](https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR)
- Receipt: [docs/mainnet-receipt.md](docs/mainnet-receipt.md)

Do not arm Mainnet broadcast for a demo.

## Adopt

Libraries on npm: `@agenttab/fetch`, `@agenttab/core`, `@agenttab/x402`,
`@agenttab/dflow`. Gateway from this repo or `ghcr.io/kleangkao/agenttab-gateway`.

Full cold-start: **[docs/ADOPT.md](docs/ADOPT.md)**.

```bash
pnpm add @agenttab/fetch@0.1.2
# start gateway: docker compose up --build  (UI at /ui)
```

```ts
import { createAgentTabClient, requestPaidResource } from "@agenttab/fetch";

const agent = createAgentTabClient({
  gatewayBaseUrl: "http://127.0.0.1:8787",
  // schemes + getUsdValueMicros — see packages/fetch/README.md
});

const result = await requestPaidResource(
  agent,
  "https://merchant.example/v1/resource",
  { method: "GET" }
);
```

Operator CLIs: `pnpm policy:set|mode|allow|cap`, `pnpm parked`, `pnpm approve`,
`pnpm deny`, `pnpm audit:recent`.

## Docs

| Doc | For |
|-----|-----|
| [PRODUCT.md](docs/PRODUCT.md) | Problem, thesis, modes, non-goals |
| [DEMO.md](docs/DEMO.md) | Buildathon / local demo path |
| [ADOPT.md](docs/ADOPT.md) | Operator + agent cold start |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [THREAT_MODEL.md](docs/THREAT_MODEL.md) | Trust boundaries |

Deeper local / Devnet / Mainnet runs (three-terminal, live-quote, live-sim,
facilitators, broadcast gates) live in those docs and under `examples/`.

## Safety

Mainnet broadcast is **triple-gated** and off by default. Do not send real
funds without an explicit budget approval and a fresh live gate. Details:
[docs/ADOPT.md](docs/ADOPT.md) and the Mainnet sections in the repo docs.

# Remote agent template

An agent process that adopts AgentTab the way an external developer would:

- depends on `@agenttab/fetch` (not `@agenttab/gateway`)
- talks to a **remote** gateway over HTTP (`AGENTTAB_GATEWAY_URL`)
- pays a **neutral** x402 merchant that has no AgentTab knowledge

```text
remote-agent  --HTTP-->  AgentTab gateway  (policy / deficit funding / audit)
     |                           ^
     +-------- x402 pay ---------+----->  neutral-merchant
```

One-command proofs from the repo root: `pnpm demo:stack` (long-running UI) or
`pnpm demo:adopt` (preview / approve / deny). Optional `pnpm notify:sink` then
`AGENTTAB_NOTIFY_URL=http://127.0.0.1:8792/hook`.

## Local three-terminal run (no chain, no funds)

```bash
# Terminal 1 — gateway (mock funding). Allowlist the merchant origin.
$env:MERCHANT_ORIGIN="http://127.0.0.1:8791"
pnpm demo:gateway

# Terminal 2 — AgentTab-agnostic merchant
pnpm --filter @agenttab/example-neutral-merchant dev

# Terminal 3 — remote agent (smoke payment scheme)
pnpm --filter @agenttab/example-remote-agent demo
```

Or run the automated smoke (ephemeral ports, asserts `funding.confirmed` → pay → fulfill):

```bash
pnpm --filter @agenttab/example-remote-agent test
```

## Production-shaped wiring

Replace the smoke scheme with a real Solana signer:

```ts
import { createRemoteAgent } from "@agenttab/example-remote-agent";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const agent = createRemoteAgent({
  gatewayBaseUrl: process.env.AGENTTAB_GATEWAY_URL!,
  schemes: [{ network: "solana:mainnet", client: new ExactSvmScheme(svmSigner) }]
});

const response = await agent.fetch("https://merchant.example/v1/market-snapshot");
const meta = agent.getMeta(response);
const receipt = await agent.getExecution(meta!.operationId);
```

## Devnet (real facilitator)

```bash
pnpm integration:devnet-remote
```

Uses `createDevnetGatewayRuntime` (same factory as `pnpm demo:gateway:devnet`),
a facilitator-settled neutral merchant, and `ExactSvmScheme` through
`@agenttab/fetch`. No Mainnet spend.

No new Mainnet spend is required to validate this template; use the smoke path or
existing Devnet wallets only when you explicitly want on-chain settle.

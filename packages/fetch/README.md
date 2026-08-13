# `@agenttab/fetch`

Drop-in `fetch` wrapper for agents that need AgentTab policy + exact-deficit
funding in front of standard x402 payments.

```text
your agent
  -> createAgentTabFetch / createAgentTabClient
       -> 402 challenge
       -> AgentTab gateway (policy / DFlow deficit funding)
       -> official @x402/fetch payment + retry
       -> optional audit (pay + fulfill) on the gateway
```

## Install

```bash
pnpm add @agenttab/fetch @x402/core @x402/fetch @x402/svm
```

You still need a scheme client such as `@x402/svm` in the agent process
(bring-your-own signer). For the gateway and operator CLIs, clone
https://github.com/Kleangkao/agenttab (see `docs/ADOPT.md`).

## Minimal usage (remote gateway)

This is the primary adoption path for an existing agent process.
See also `docs/ADOPT.md` for policy files and operator CLIs.

```ts
import {
  createAgentTabClient,
  stablecoinAtomicAsUsdMicros
} from "@agenttab/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const agent = createAgentTabClient({
  gatewayBaseUrl: process.env.AGENTTAB_GATEWAY_URL!, // e.g. http://127.0.0.1:8787
  schemes: [
    {
      network: "solana:mainnet",
      client: new ExactSvmScheme(svmSigner)
    }
  ],
  getUsdValueMicros: async ({ amountAtomic }) =>
    stablecoinAtomicAsUsdMicros(amountAtomic)
});

const response = await agent.fetch("https://merchant.example/v1/market-snapshot");
const meta = agent.getMeta(response);
const receipt = await agent.getExecution(meta!.operationId);

// Operator helpers on the same client:
// await agent.gateway?.getPolicy();
// await agent.gateway?.putPolicy(nextPolicy);
// await agent.gateway?.preview(intent); // never funds
// await agent.gateway?.approve(meta!.operationId);
// await agent.gateway?.deny(meta!.operationId);
```

See `examples/remote-agent` + `examples/neutral-merchant` for a reusable
topology that does not embed the gateway in the agent process.

When policy parks a payment, funding throws `AgentTabApprovalRequiredError`.
When DFlow already planned but signing/confirm was interrupted, it throws
`AgentTabFundingInterruptedError`. The next `fetch` to the same
method+url+body reuses that `operationId` from in-process memory, or by asking
the gateway for a reusable execution with the same `requestHash`. A failed
lookup does not mint a new id. Prefer
`requestPaidResource(agent, url, init, { onApprovalRequired })` for the
in-process approve-and-retry loop (`"approve"` | `"deny"` | `"abort"`);
approve only retries the merchant after `funded` / `already_funded`.
If the same id is already paid, fetch retries the original request without a
new x402 payload and only throws `AgentTabAlreadyPaidError` when the merchant
still requires payment.
`requestPaidResource` retries an interrupted fund once on the same id.
Operators can `gateway.resume(operationId)` or use Resume on Now.
`createOperationId` always wins over reuse.
Mainnet USDC amounts default to USD micros (1:1); other mints need
`getUsdValueMicros`.

## Options worth knowing

- `gatewayHeaders` / `AGENTTAB_AGENT_TOKEN` — bearer for a hosted gateway that
  sets `AGENTTAB_AGENT_TOKEN`.
- `gatewayFetchImpl` — HTTP client used only for gateway fund/pay/fulfill.
  Keep it separate from `fetchImpl` when you intercept merchant traffic in tests.
- `createAgentTabClient` — paid fetch + `getExecution` / policy / preview / deny /
  `getSpend` / `getHealth` / `listParked` / `allowMerchantOrigin` / `setPolicyCaps`
  helpers.
  `gateway.preview(intent)` is read-only and never funds. `gateway.deny(id)` is terminal.
- Prefer `schemes` over reusing a shared `x402Client` (x402 appends hooks).
- `createLocalSmokeScheme()` is for local/CI only; production needs a real SVM signer.
- `AgentTabApprovalRequiredError` / `AgentTabFundingInterruptedError` /
  `AgentTabAlreadyPaidError` / `AgentTabFundingDeniedError` carry `operationId`.
  Use `isAgentTabRetryableFundingError` when funding should be retried;
  `already_paid` keeps the id so a second x402 pay cannot be minted.

## Embedded gateway (in-process coordinator)

```ts
const fetchPaid = createAgentTabFetch({
  coordinator: gateway.coordinator,
  audit: createGatewayAuditRecorder({ baseUrl: "http://127.0.0.1:8787" }),
  schemes: [{ network, client: new ExactSvmScheme(svmSigner) }]
});
```

## Design notes

- Merchants stay on standard x402; AgentTab is buyer-side only.
- Signing is bring-your-own via `schemes` / `x402Client` (never pass raw keys here).
- Request binding (`operationId`, `requestHash`, `merchantId`) is per-call via
  `AsyncLocalStorage`, so concurrent fetches stay isolated.
- After a successful paid response, audit defaults on when a gateway URL or
  `audit` recorder is provided.
- This package does **not** cover the local HMAC demo path.

# Changelog

## 0.1.0

Published to npm under the `@agenttab` org:

- [`@agenttab/core`](https://www.npmjs.com/package/@agenttab/core)
- [`@agenttab/dflow`](https://www.npmjs.com/package/@agenttab/dflow)
- [`@agenttab/x402`](https://www.npmjs.com/package/@agenttab/x402)
- [`@agenttab/fetch`](https://www.npmjs.com/package/@agenttab/fetch)

Public source: https://github.com/Kleangkao/agenttab
Gateway remains clone-and-run from the monorepo.

- Buyer-side policy + exact-deficit funding around standard x402 on Solana
- `@agenttab/fetch` wraps official `@x402/fetch` with sticky and gateway-backed
  `operationId` reuse for the approve → retry loop
- Gateway HTTP + CLI operator surface (`policy`, `approve`, `audit`)
- Proven locally (mock), on Devnet (facilitator), and on a gated Mainnet oneshot

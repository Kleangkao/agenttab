# Changelog

## 0.1.0

Local product snapshot before any public registry or remote.

- Buyer-side policy + exact-deficit funding around standard x402 on Solana
- `@agenttab/fetch` wraps official `@x402/fetch` with sticky and gateway-backed
  `operationId` reuse for the approve → retry loop
- Gateway HTTP + CLI operator surface (`policy`, `approve`, `audit`)
- Proven locally (mock), on Devnet (facilitator), and on a gated Mainnet oneshot

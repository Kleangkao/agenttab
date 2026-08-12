# Changelog

## 0.1.2-dev

- Optional `AGENTTAB_NOTIFY_URL` webhook on first park / approve / deny (fail-open)
- Operator deny: `POST /v1/denials/:id`, `pnpm deny`, `createGatewayClient().deny`, `/ui` Deny
- `GET /v1/spend` rolling 24h spend for the operator UI
- `pnpm demo:stack` starts gateway + neutral merchant in one process
- Operator control plane without a clone: GHCR image + `compose.yaml` + `/ui`
- Bake `/policy/approve.local.json` in the gateway image; `AGENTTAB_POLICY_JSON` env bootstrap
- `POST /v1/preview`, `pnpm preview`, and `createGatewayClient().preview` evaluate policy without funding
- `AGENTTAB_ADMIN_TOKEN` also gates `POST /v1/approvals`
- Operator CLIs use `AGENTTAB_GATEWAY_URL` even when `AGENTTAB_DB_PATH` is set (Docker)
- Image HEALTHCHECK + `gateway|approve|audit|policy-*` entrypoint
- Fix `pack:check` to read each package version (unblocks CI after fetch 0.1.1)
- Docs: npm install path for agents; gateway remains clone-and-run or GHCR
- Add Release workflow stub for future npm Trusted Publishing (dry-run by default)
- Short READMEs for `@agenttab/{core,dflow,x402}`
- Gateway Dockerfile + GHCR workflow (`ghcr.io/kleangkao/agenttab-gateway`)
- GHCR package is public; `latest` is published from `main` / version tags
- GitHub environment `npm` exists; Trusted Publishing (OIDC) is deferred (needs WebAuthn)
- Live npm releases use `pnpm release:publish` with a short-lived GAT, then revoke
- CI Release workflow is dry-run only (no standing `NPM_TOKEN` secret)

## 0.1.1

- `@agenttab/fetch`: refresh published README now that packages are on npm

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

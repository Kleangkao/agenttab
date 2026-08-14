# Changelog

## Unreleased

- Approval satisfies `approval_required` only. Live policy hard denials
  (daily cap, allowlists, challenge expiry) bind at approve/fund time,
  return `policy_denied`, and do not fund. Already funded/paid operations
  are not clawed back.
- Operator notify webhooks retry up to 3 times. Each attempt is stored and
  shown on `/ui` plus `GET /v1/executions/:id` (`notifyDeliveries`). Failure
  never reverses a park.
- Named agent identity: `AGENTTAB_AGENT_TOKENS` plus the existing
  `AGENTTAB_AGENT_TOKEN` stamp `agentId` on executions, spend, audit, and
  `/ui`. Unset tokens stay unattributed. Policy caps remain gateway-wide.
- Removed the empty `apps/dashboard/` placeholder. Operator UI stays
  `apps/gateway/src/ui`.
- Buildathon path: `docs/DEMO.md` plus a public Mainnet receipt with Solscan
  links for the already-fulfilled DFlow deficit + x402 pay. `/ui` and
  `pnpm demo:judge` state that the live path is a local mock and point at that
  proof. `pnpm demo:stack` parks one local Now request so `/ui` is not empty.
  No new Mainnet spend.
- Operator `/ui` tells the core-loop story on Now: agent blocked on a paid
  resource, wallet missing the asked asset, buy only the exact deficit,
  pay the merchant, original request continues. Confirming buys, pays, and
  continues on the same id. A finished request stays on Now so the ending
  is visible. Rail stays honest (local mock / Devnet / Mainnet).
- Core loop: retryable DFlow interrupts are `interrupted` (not `denied`), so
  fetch keeps the same `operationId` and re-signs the plan instead of minting
  a second swap. `requestPaidResource` only retries after `funded` /
  `already_funded`. Resume lookup fails closed. Mainnet USDC defaults to USD
  micros. A payment already submitted is `already_paid` — x402 will not
  create a second payload; fetch records `payment_submitted` before the
  merchant retry, then retries the original request without a new pay.
  Exact-deficit funding can use any allowed asset with a balance, not only SOL.
  Live RPC balance refresh also discovers other SPL accounts in the wallet.
- Core loop recovery: `requestPaidResource` retries an interrupted fund once;
  `POST /v1/executions/:id/resume` advances fund/pay/fulfill on the same id;
  `/health` reports `openLoopCount`; Now shows in-flight payments with Resume;
  notify webhooks also fire on `interrupted`. Now puts Approve / Resume
  above the fold so a paused loop can be continued without scrolling.
- Operator `/ui` is a control room (Now, Ledger, Policy): decision briefs,
  human lifecycle copy, dollar limits, unlock only when a token is required
- Operator `/ui` is a product console (Needs you, Activity, Rules, Ask) with
  human-readable USD, confirm-before-release, and `/ui/app.css` + `/ui/app.js`
- Operator UI shows merchant / µUSD / resource, Set mode, parked count, 5s refresh
- `GET /health` includes `parkedCount` and rolling 24h spend
- `GET /openapi.json` locked to live Hono routes
- `pnpm parked` / `pnpm policy:mode` / `pnpm policy:allow` / `pnpm policy:cap`
- Optional `AGENTTAB_AGENT_TOKEN` gates preview/fund/pay/fulfill. Local demos
  stay open; hosted Docker should set both admin and agent tokens.
- Operator UI shows a token hint on gated lists and reloads after the admin
  token is entered; health strip notes signed notify
- `pnpm notify:sink` local webhook; optional `AGENTTAB_NOTIFY_SECRET` HMAC
  (`x-agenttab-signature`)
- When `AGENTTAB_ADMIN_TOKEN` is set, operator reads (policy, spend, balances,
  unfiltered execution lists) require the same bearer token. Agent fund/pay/fulfill
  and `requestHash` resume stay open.
- Operator UI Save caps (payment / daily / approve-above) without rewriting JSON
- `pnpm demo:adopt` also checks `/openapi.json` and leftover parked count
- `AUDIT_REQUEST_HASH` on `pnpm audit:recent`
- Canonicalize http(s) merchant origins (trailing slash / default port) in policy
- `@agenttab/fetch` workspace: `getSpend()`, `getHealth()`, `listParked()`,
  `allowMerchantOrigin()`, `setPolicyCaps()` (unreleased until next fetch publish)
- `pnpm demo:adopt`: one-command HTTP proof of preview / approve / deny
- Optional `AGENTTAB_NOTIFY_URL` webhook on first park / approve / deny (fail-open)
- Operator deny: `POST /v1/denials/:id`, `pnpm deny`, `/ui` Deny
- `GET /v1/spend` rolling 24h spend for the operator UI
- `pnpm demo:stack` starts gateway + neutral merchant in one process
- Operator control plane without a clone: GHCR image + `compose.yaml` + `/ui`
- Bake `/policy/approve.local.json` in the gateway image; `AGENTTAB_POLICY_JSON` env bootstrap
- `AGENTTAB_ADMIN_TOKEN` also gates `POST /v1/approvals` and denials
- Operator CLIs use `AGENTTAB_GATEWAY_URL` even when `AGENTTAB_DB_PATH` is set (Docker)
- Image HEALTHCHECK + `gateway|approve|deny|audit|policy-*|preview` entrypoint
- Docs: npm install path for agents; gateway remains clone-and-run or GHCR
- Add Release workflow stub for future npm Trusted Publishing (dry-run by default)
- Short READMEs for `@agenttab/{core,dflow,x402}`
- Gateway Dockerfile + GHCR workflow (`ghcr.io/kleangkao/agenttab-gateway`)
- GHCR package is public; `latest` is published from `main` / version tags
- GitHub environment `npm` exists; Trusted Publishing (OIDC) is deferred (needs WebAuthn)
- Live npm releases use `pnpm release:publish` with a short-lived GAT, then revoke
  (local publish disables provenance; OIDC Trusted Publishing can re-enable it)
- CI Release workflow is dry-run only (no standing `NPM_TOKEN` secret)

## 0.1.2

- [`@agenttab/fetch@0.1.2`](https://www.npmjs.com/package/@agenttab/fetch): public SDK
  catches up to the live gateway — `preview()` (never funds), `deny()`,
  `onApprovalRequired: "deny"`, and `isAgentTabFundingDeniedError`.
  `@agenttab/{core,dflow,x402}` stay at 0.1.0.

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

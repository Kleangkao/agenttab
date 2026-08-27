# AgentTab — Buildathon demo

A judge should be able to do three things quickly: understand the thesis, run
the loop, and verify that real DFlow + x402 already settled on Solana Mainnet.
The local `/ui` is a safe mock of that same loop. It is not the limit of the
implementation.

## Thesis

x402 lets an agent pay for an HTTP resource, but only if the wallet already
holds the exact asset the merchant asked for. AgentTab is buyer-side policy +
exact-deficit funding around that standard 402:

1. Agent needs a paid resource.
2. Merchant asks for a specific asset (x402).
3. Wallet is missing or short that asset.
4. AgentTab buys **only the deficit** through DFlow.
5. Standard x402 payment succeeds.
6. The original request continues.
7. One append-only receipt ties the steps together.

AgentTab is not a new payment protocol, a trading bot, a custodian, or an x402
facilitator. Merchants keep standard x402.

## 2-minute live path (safe, no Mainnet spend)

From this repo:

```bash
pnpm demo:stack
```

**Present path (no slides):**

1. Open [http://127.0.0.1:8787/](http://127.0.0.1:8787/) — product showcase,
   outcome-first thesis, and the three-step DFlow loop.
2. Click **Try the interactive demo** →
   [http://127.0.0.1:8787/demo](http://127.0.0.1:8787/demo).
3. Choose a paid task ($1.25 / $4.00 / $5.00) and a starting wallet (short /
   empty / already covered), then click **Run this request**.
4. The execution surface shows what the wallet held, what x402 asked for, and
   the exact deficit derived by AgentTab. The user never chooses a swap amount.
5. Click **Buy $1.40 and continue** in the default path. The local mock acquires
   only the deficit, pays the merchant, retries the same resource, and renders
   the completed user result.
6. Expand **See what happened technically** for the resource, x402 amount,
   DFlow action, and response proof. The mock / Mainnet distinction remains visible.
7. Open **Operator console** ([/ui](http://127.0.0.1:8787/ui)) for Now, ledger,
   policy, and Mainnet proof.
8. Within ~15s the stack auto-reseeds a fresh Now card so the next visitor can
   repeat the loop.

The line under the stance / demo footer points at the already-settled Mainnet
DFlow + x402 transactions. This run is a **local DFlow mock — no chain, not
broadcasting**.

### Public demo host (no laptop)

Same stack, containerized for Railway (see `Dockerfile.demo-stack` +
`railway.toml` and `docs/adr/0001-public-live-demo-site.md`):

```bash
docker build -f Dockerfile.demo-stack -t agenttab-demo-stack .
docker run --rm -p 8787:8787 -e HOST=0.0.0.0 agenttab-demo-stack
```

### Railway deploy (push → live)

**Root cause when pushes stop updating live:** Railway lost GitHub App access to
`Kleangkao/agenttab` (Settings shows **GitHub Repo not found**). The old container
keeps running; new commits never build.

**Fix permanently (do both once):**

1. **GitHub App (required for native autodeploy)**  
   GitHub → Settings → Applications → Installed GitHub Apps → **Railway** →
   Configure → Repository access → ensure `Kleangkao/agenttab` is allowed.

2. **Reconnect Railway source + verify** (after step 1; requires `railway login` once):

```bash
railway service source connect \
  --repo Kleangkao/agenttab --branch main \
  --project 33763140-39d1-4c1f-abbf-f2ae549f6ea0 \
  --environment 8403a4df-962d-4026-ae7b-279b118123cb \
  --service 83a32496-e68d-41b4-8538-f85cd0aa3b3d

railway redeploy --from-source --yes \
  --project 33763140-39d1-4c1f-abbf-f2ae549f6ea0 \
  --environment 8403a4df-962d-4026-ae7b-279b118123cb \
  --service 83a32496-e68d-41b4-8538-f85cd0aa3b3d
```

3. **CI fallback (optional belt-and-suspenders)**  
   Railway → Project → Settings → **Tokens** → create token for `production`.  
   GitHub repo → Settings → Secrets → **`RAILWAY_TOKEN`**.  
   Then `.github/workflows/railway-deploy.yml` deploys on every push to `main`
   that touches the demo stack paths (same as `Dockerfile.demo-stack`).
   Without the secret the job logs a notice and passes: the GitHub App remains
   the live deploy path, so an unarmed fallback must not redden every commit.

**Emergency deploy without waiting for GitHub:** `railway up --ci` from repo root
(same `--project` / `--environment` / `--service` flags as above).

Open `/` on the public URL (Product → Interactive demo → Operator console).
Funding stays mock.
Merchant stays on container loopback; only the gateway port is exposed.

Optional one-command audit of the same loop with no browser:

```bash
pnpm demo:judge
```

Optional: run the *real* wallet-valuation task-agent through its payment
barrier in-process (no human approval; prints a stable JSON valuation report):

```bash
pnpm demo:task-agent
```

## What is mock vs already proven

| What you are looking at | Funding | Payment | Chain |
|-------------------------|---------|---------|-------|
| `/` landing + `/demo` + `/ui` via `pnpm demo:stack` | local DFlow mock | local HMAC / token | none |
| `/ui` via `pnpm demo:stack` | local DFlow mock | local HMAC / token | none |
| `pnpm demo:judge` | mock exact-deficit | local HMAC | none |
| Devnet agent | mint stand-in (not DFlow) | official x402 facilitator | Solana Devnet |
| Mainnet oneshot already run | **real DFlow** | **real x402 settle** | **Solana Mainnet** |

Do not treat the local mock as the product ceiling. Do not treat Devnet minting
as DFlow. Do not arm a new Mainnet broadcast for a demo.

## Mainnet proof (already fulfilled, no new spend)

On 2026-08-11 the same loop settled on Solana Mainnet as
`mainnet-one-shot-accde262-ec07-4bbb-8449-5fd03c738a25`.

The wallet held **5 atomic USDC** and the merchant asked for **1000 atomic
USDC** ($0.001). AgentTab bought only the **995 atomic deficit** from SOL via
DFlow, then paid 1000 atomic USDC through x402, then marked
`/v1/research` fulfilled.

| Step | On-chain fact | Explorer |
|------|---------------|----------|
| Exact-deficit DFlow | WSOL 13143 lamports → 999 atomic USDC; DFlow program `DF1ow4t…`; slot 438621419 | [Funding tx](https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg) |
| x402 pay | Buyer USDC 1004 → 4 atomic; merchant 1000 → 2000 atomic; slot 438621425 | [Payment tx](https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR) |
| Continue | Execution state `fulfilled`; response hash `sha256:e4a51a547a1e0a30a90c5ab25600afa3469a0ce1d2864ccefffd2b55292fe8d9` | Same operation id in the local Mainnet receipt DB |

Buyer (public): `JCVsKd4TMg1fvEs7rjf5YgLYbJfNC8Dwb4x1PchFkGM7`  
Merchant (public): `HSwkNxFzJQDhnNbmXr1dTvezgCvy13tK2szaK36mJ8kr`  
Network: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`  
Asset: Circle USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

Public receipt copy: [mainnet-receipt.md](mainnet-receipt.md).

If this machine still has the gitignored audit DB:

```bash
AGENTTAB_DB_PATH=.data/mainnet/gateway-mainnet.sqlite AUDIT_OPERATION_ID=mainnet-one-shot-accde262-ec07-4bbb-8449-5fd03c738a25 pnpm audit:recent
```

A clone of the public repo does **not** include that DB. The explorer links
above are the judge-visible proof.

## What this demo will not do

- Spend new Mainnet funds.
- Open a swap interface or let the agent pick a trade.
- Pretend Devnet minting is DFlow.
- Hide that `/ui` is a local mock.

Broadcast stays triple-gated (`MAINNET_ONE_SHOT_MODE=broadcast`,
`AGENTTAB_BROADCAST=1`,
`AGENTTAB_MAINNET_EXECUTION_APPROVED=I_UNDERSTAND_THIS_WILL_SPEND_REAL_FUNDS`).
Do not arm those for judging.

# Neutral x402 merchant

A third-party-style paid API with **zero AgentTab imports**.

It exposes `GET /v1/market-snapshot`, returns a standard x402
`PAYMENT-REQUIRED` challenge, and unlocks the resource after payment.

## Local smoke (`signature-present`)

```bash
pnpm --filter @agenttab/example-neutral-merchant dev
```

Accepts any `PAYMENT-SIGNATURE` header — useful for buyer-SDK CI without chain.

## Devnet facilitator settle

```bash
pnpm --filter @agenttab/example-neutral-merchant devnet
```

Uses official `@x402/hono` + `https://x402.org/facilitator` against disposable
Devnet merchant/mint artifacts under `.data/devnet/`. Still no AgentTab imports.

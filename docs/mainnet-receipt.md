# Mainnet receipt (public)

Read-only facts from the fulfilled oneshot
`mainnet-one-shot-accde262-ec07-4bbb-8449-5fd03c738a25` on 2026-08-11.
No private keys. No new spend. Verify the signatures on a block explorer.

## Loop

| Field | Value |
|-------|--------|
| State | `fulfilled` |
| Network | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Resource | `http://127.0.0.1:4022/v1/research` |
| Asked | 1000 atomic USDC ($0.001) |
| Wallet before fund | 5 atomic USDC |
| Exact deficit | 995 atomic USDC |
| DFlow input | 13143 lamports WSOL |
| DFlow output | 999 atomic USDC |
| x402 paid | 1000 atomic USDC |
| Buyer | `JCVsKd4TMg1fvEs7rjf5YgLYbJfNC8Dwb4x1PchFkGM7` |
| Merchant | `HSwkNxFzJQDhnNbmXr1dTvezgCvy13tK2szaK36mJ8kr` |

## On-chain

**DFlow exact-deficit fund** (slot 438621419, `err: null`, DFlow
`DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH`):

https://solscan.io/tx/3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg

**x402 pay** (slot 438621425, `err: null`; buyer USDC 1004→4 atomic, merchant
1000→2000 atomic):

https://solscan.io/tx/27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR

**Continue:** execution `resource.fulfilled` with
`sha256:e4a51a547a1e0a30a90c5ab25600afa3469a0ce1d2864ccefffd2b55292fe8d9`.

Audit timeline in the local DB (not shipped in git):
`payment.discovered` → `policy.allowed` → `funding.submitted` →
`funding.confirmed` → `payment.settled` → `resource.fulfilled`.

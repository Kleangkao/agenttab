# Glossary — public demo surface

| Term | Meaning |
|------|---------|
| **Pitch Site** | Static narrative page (thesis, why DFlow, Solscan proof, GitHub). May live on Vercel. Does not approve payments. |
| **Public Demo Host** | Long-running deployment of the judge stack (`demo:stack` shape): gateway + merchant + `/ui`. |
| **Operator Console (`/ui`)** | Same-origin control plane UI for Now / Ledger / Policy. Not a marketing SPA. |
| **Seeded Intent** | Pre-parked `approval_required` payment so Now is never empty for judges. |
| **Fidelity Mode** | Honesty label: `LOCAL MOCK` \| `DFLOW SIM` \| `DEVNET` \| `MAINNET LIVE`. Public demo stays `LOCAL MOCK`. |
| **Historical Mainnet Proof** | Already-settled Solscan txs shown as evidence; not a new live spend from the site. |
| **Demo Token** | Shared `AGENTTAB_ADMIN_TOKEN` (or short-lived equivalent) so random visitors cannot mutate policy quietly. |
| **Reseed** | After someone completes Buy-and-continue, park a fresh demo intent so the next visitor still has a Now card. |
| **Brochure Link** | Optional Vercel URL that only forwards humans to the Public Demo Host + proof docs. |

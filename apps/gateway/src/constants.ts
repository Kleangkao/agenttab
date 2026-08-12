/** Well-known Solana mint addresses used by the local demo. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export const LOCAL_NETWORK = "solana:local";
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const DEMO_WALLET = "AgentTabDemoWallet1111111111111111111111111";

/**
 * Valid Solana pubkey used only for DFlow live-sim (order + simulateTransaction).
 * Not a funded wallet — simulation may report insufficient funds; that is expected.
 * Never used for broadcast.
 */
export const LIVE_SIM_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

/** Default research payment: 1 USDC (6 decimals). */
export const DEMO_PAYMENT_AMOUNT_ATOMIC = "1000000";
export const DEMO_PAYMENT_USD_MICROS = "1000000";

/** Smallest practical Mainnet USDC payment above Dexter live floor (minPaymentAmountAtomic=800). */
export const MAINNET_MIN_TEST_PAYMENT_ATOMIC = "1000";
export const MAINNET_MIN_TEST_PAYMENT_USD_MICROS = "1000";
/** Live Dexter GET /supported Mainnet exact floor (re-check before funded runs). */
export const DEXTER_MAINNET_MIN_PAYMENT_ATOMIC = "800";
export const DEXTER_FACILITATOR_URL = "https://x402.dexter.cash";
export const PAYAI_FACILITATOR_URL = "https://facilitator.payai.network";
export const DEFAULT_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

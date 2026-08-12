/**
 * Facilitator-settled neutral merchant for Solana Devnet.
 * Zero AgentTab imports — standard @x402/hono + x402.org facilitator.
 */
process.env.ACCEPT_MODE = process.env.ACCEPT_MODE ?? "facilitator";
await import("./main.js");

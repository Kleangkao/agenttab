import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { paymentPolicySchema, type PaymentPolicy } from "@agenttab/core";
import { createGatewayRuntime, type GatewayRuntime, type GatewayRuntimeOptions } from "./app.js";
import { DevnetMintFundingAdapter } from "./funding/devnet-mint.js";
import { MockBalanceProvider } from "./funding/mock-balances.js";
import { WSOL_MINT } from "./constants.js";

/** Solana Devnet CAIP-2 (official x402). */
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const GATEWAY_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = resolve(GATEWAY_PACKAGE_ROOT, "../..");

export interface DevnetGatewayPaths {
  dataDir: string;
  buyerKeypair: Keypair;
  buyerAddress: string;
  mint: PublicKey;
}

export function resolveDevnetDataDir(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) {
    return resolve(explicit);
  }
  if (process.env.AGENTTAB_DEVNET_DATA_DIR) {
    return resolve(process.env.AGENTTAB_DEVNET_DATA_DIR);
  }

  const candidates = [
    resolve(process.cwd(), ".data/devnet"),
    resolve(process.cwd(), "../../.data/devnet"),
    resolve(REPO_ROOT, ".data/devnet")
  ];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "buyer.json"))) {
      return candidate;
    }
  }
  return resolve(REPO_ROOT, ".data/devnet");
}

export function loadDevnetGatewayPaths(dataDir = resolveDevnetDataDir()): DevnetGatewayPaths {
  const requireFile = (name: string): string => {
    const path = resolve(dataDir, name);
    if (!existsSync(path)) {
      throw new Error(`Missing Devnet artifact ${path}. Run pnpm devnet:setup first.`);
    }
    return path;
  };

  const buyerKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(requireFile("buyer.json"), "utf8")) as number[])
  );
  const buyerAddress = readFileSync(requireFile("buyer.address.txt"), "utf8").trim();
  if (buyerAddress !== buyerKeypair.publicKey.toBase58()) {
    throw new Error(
      `buyer.json pubkey ${buyerKeypair.publicKey.toBase58()} does not match buyer.address.txt ${buyerAddress}`
    );
  }
  const mint = new PublicKey(readFileSync(requireFile("test-usdc-mint.txt"), "utf8").trim());
  return { dataDir, buyerKeypair, buyerAddress, mint };
}

export async function readSplBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    return (await getAccount(connection, ata, "confirmed")).amount;
  } catch {
    return 0n;
  }
}

export function createDevnetPolicy(input: {
  merchantOrigin: string;
  mint: string;
  maxPaymentUsdMicros?: string;
  maxDailyUsdMicros?: string;
}): PaymentPolicy {
  return paymentPolicySchema.parse({
    mode: "autopay",
    allowedMerchantOrigins: [input.merchantOrigin],
    allowedNetworks: [SOLANA_DEVNET],
    allowedPaymentAssets: [input.mint],
    allowedFundingAssets: [WSOL_MINT, input.mint],
    requireVerifiedFundingAssets: true,
    maxPaymentUsdMicros: input.maxPaymentUsdMicros ?? "5000000",
    maxDailyUsdMicros: input.maxDailyUsdMicros ?? "20000000",
    maxSlippageBps: 50,
    maxPriceImpactPct: 1
  });
}

export interface CreateDevnetGatewayRuntimeOptions {
  merchantOrigin: string;
  dataDir?: string;
  rpcUrl?: string;
  dbPath?: string;
  /** Override mock payment-asset balance (defaults to on-chain SPL balance). */
  paymentBalanceAtomic?: string;
  /** Override mock SOL balance used as funding candidate. */
  solBalanceAtomic?: string;
  policy?: PaymentPolicy;
  adminToken?: string;
}

/**
 * Standalone-compatible Devnet gateway runtime.
 *
 * Uses the disposable mint stand-in for exact-deficit funding (DFlow has no
 * Devnet liquidity for the custom test mint) and SimulatedSigner (mint already
 * landed on-chain inside DevnetMintFundingAdapter.planExactDeficit).
 */
export async function createDevnetGatewayRuntime(
  options: CreateDevnetGatewayRuntimeOptions
): Promise<GatewayRuntime & { paths: DevnetGatewayPaths; connection: Connection }> {
  const paths = loadDevnetGatewayPaths(options.dataDir);
  const rpcUrl = options.rpcUrl ?? process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const onChainPayment =
    options.paymentBalanceAtomic ??
    (await readSplBalance(connection, paths.buyerKeypair.publicKey, paths.mint)).toString();
  const onChainSol =
    options.solBalanceAtomic ??
    (await connection.getBalance(paths.buyerKeypair.publicKey)).toString();

  const balances = new MockBalanceProvider([
    {
      mint: paths.mint.toBase58(),
      symbol: "tUSDC",
      balanceAtomic: onChainPayment,
      verified: true
    },
    {
      mint: WSOL_MINT,
      symbol: "SOL",
      balanceAtomic: onChainSol,
      verified: true
    }
  ]);

  const adapter = new DevnetMintFundingAdapter({
    connection,
    mintAuthority: paths.buyerKeypair,
    paymentMint: paths.mint,
    recipient: paths.buyerKeypair.publicKey
  });

  const policy =
    options.policy ??
    createDevnetPolicy({
      merchantOrigin: options.merchantOrigin,
      mint: paths.mint.toBase58()
    });

  const runtimeOptions: GatewayRuntimeOptions = {
    dbPath: options.dbPath ?? resolve(paths.dataDir, "gateway-devnet-remote.sqlite"),
    merchantOrigin: options.merchantOrigin,
    policy,
    wallet: paths.buyerAddress,
    balances,
    fundingMode: "devnet-mint",
    dflowAdapter: adapter,
    broadcastEnabled: false,
    ...(options.adminToken === undefined ? {} : { adminToken: options.adminToken })
  };

  const runtime = createGatewayRuntime(runtimeOptions);
  return { ...runtime, paths, connection };
}

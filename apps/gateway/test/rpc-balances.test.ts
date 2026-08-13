import { describe, expect, it } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { RpcBalanceProvider } from "../src/funding/rpc-balances.js";
import { USDC_MINT, WSOL_MINT } from "../src/constants.js";

const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const OWNER = new PublicKey("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");

describe("RpcBalanceProvider", () => {
  it("discovers extra SPL balances so a wrong-asset wallet is visible", async () => {
    const connection = {
      getBalance: async () => 2_000_000,
      getParsedTokenAccountsByOwner: async () => ({
        value: [
          {
            account: {
              data: {
                parsed: {
                  info: {
                    mint: USDT_MINT,
                    tokenAmount: { amount: "5000000" }
                  }
                }
              }
            }
          }
        ]
      })
    } as unknown as Connection;

    const balances = new RpcBalanceProvider({
      connection,
      owner: OWNER,
      splMints: [{ mint: USDC_MINT, symbol: "USDC" }]
    });
    const listed = await balances.refresh();
    expect(listed.find((row) => row.mint === WSOL_MINT)?.balanceAtomic).toBe("2000000");
    expect(listed.find((row) => row.mint === USDT_MINT)).toMatchObject({
      mint: USDT_MINT,
      balanceAtomic: "5000000",
      verified: true
    });
  });
});

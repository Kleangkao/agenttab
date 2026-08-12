import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  decodePhantomPrivateKeyBase58,
  keypairFromPhantomPrivateKey,
  loadPhantomCredentialsFromEnv,
  parseEnvLocal,
  writeMainnetBuyerKeypair
} from "./phantom-import-lib.js";

describe("phantom import helpers", () => {
  it("decodes a Phantom base58 export into a 64-byte secret key", () => {
    const keypair = Keypair.generate();
    const encoded = bs58.encode(keypair.secretKey);
    expect(decodePhantomPrivateKeyBase58(encoded)).toHaveLength(64);
  });

  it("rejects exports with the wrong length", () => {
    expect(() => decodePhantomPrivateKeyBase58(bs58.encode(new Uint8Array(32)))).toThrow(
      /64 bytes/
    );
  });

  it("verifies the expected Phantom address before returning a keypair", () => {
    const keypair = Keypair.generate();
    const encoded = bs58.encode(keypair.secretKey);
    expect(
      keypairFromPhantomPrivateKey(encoded, keypair.publicKey.toBase58()).publicKey.toBase58()
    ).toBe(keypair.publicKey.toBase58());
    expect(() =>
      keypairFromPhantomPrivateKey(encoded, Keypair.generate().publicKey.toBase58())
    ).toThrow(/does not match/);
  });

  it("writes the imported buyer as a Solana JSON keypair file", () => {
    const keypair = Keypair.generate();
    const dir = mkdtempSync(join(tmpdir(), "agenttab-phantom-"));
    const written = writeMainnetBuyerKeypair(dir, keypair);
    expect(JSON.parse(readFileSync(written.jsonPath, "utf8"))).toHaveLength(64);
    expect(readFileSync(written.addressPath, "utf8")).toBe(keypair.publicKey.toBase58());
  });

  it("parses .env.local Phantom credentials without exposing secrets in helpers", () => {
    const parsed = parseEnvLocal(`
# comment
PHANTOM_EXPECTED_ADDRESS=Addr111
PHANTOM_SOLANA_PRIVATE_KEY="secret-key"
OTHER=1
`);
    const creds = loadPhantomCredentialsFromEnv(parsed, ".env.local");
    expect(creds.expectedAddress).toBe("Addr111");
    expect(creds.privateKeyBase58).toBe("secret-key");
    expect(creds.sourcePath).toBe(".env.local");
  });
});

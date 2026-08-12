import { createHash } from "node:crypto";

/** Hex sha256 of the base64-decoded funding wire transaction. */
export function hashSerializedTransaction(serializedTransactionBase64: string): string {
  const bytes = Buffer.from(serializedTransactionBase64, "base64");
  if (bytes.length === 0) {
    throw new Error("serializedTransaction is empty");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Fail closed when a plan advertises a hash that does not match the bytes to sign.
 * Plans without a hash are accepted for backward-compatible mock/devnet envelopes.
 */
export function assertFundingPlanTransactionIntegrity(plan: {
  serializedTransaction?: string;
  transactionSha256?: string;
}): void {
  if (!plan.serializedTransaction) return;
  if (typeof plan.transactionSha256 !== "string" || plan.transactionSha256.length === 0) {
    return;
  }
  const actual = hashSerializedTransaction(plan.serializedTransaction);
  if (actual !== plan.transactionSha256) {
    throw new Error(
      "Funding plan transactionSha256 does not match serializedTransaction (possible quote substitution)"
    );
  }
}

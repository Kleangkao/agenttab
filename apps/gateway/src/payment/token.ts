import { createHmac, timingSafeEqual } from "node:crypto";

export interface PaymentSettlementClaims {
  operationId: string;
  amountAtomic: string;
  assetMint: string;
  destination: string;
  merchantOrigin: string;
  resource: string;
  network: string;
  issuedAt: string;
  expiresAt: string;
}

export function issuePaymentToken(
  claims: PaymentSettlementClaims,
  secret: string
): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyPaymentToken(
  token: string,
  secret: string,
  now = new Date()
): PaymentSettlementClaims {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Malformed payment token");

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("Invalid payment token signature");
  }

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PaymentSettlementClaims;
  if (new Date(claims.expiresAt) <= now) {
    throw new Error("Payment token expired");
  }
  return claims;
}

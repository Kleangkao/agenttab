import { canonicalizeHttpOrigin } from "@agenttab/core";

export function resolveMerchantOrigin(argv: string[]): string {
  const afterDash = argv.findIndex((arg) => arg === "--");
  const candidates = (afterDash >= 0 ? argv.slice(afterDash + 1) : argv).filter(
    (arg) => !arg.startsWith("-")
  );
  const raw = candidates[0] ?? process.env.AGENTTAB_ALLOW_ORIGIN?.trim();
  if (raw === undefined || raw.length === 0) {
    throw new Error("Usage: pnpm policy:allow -- <https://merchant.example>");
  }
  try {
    return canonicalizeHttpOrigin(raw);
  } catch {
    throw new Error(`Invalid origin: ${raw}`);
  }
}

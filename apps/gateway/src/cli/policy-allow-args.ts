export function resolveMerchantOrigin(argv: string[]): string {
  const afterDash = argv.findIndex((arg) => arg === "--");
  const candidates = (afterDash >= 0 ? argv.slice(afterDash + 1) : argv).filter(
    (arg) => !arg.startsWith("-")
  );
  const raw = candidates[0] ?? process.env.AGENTTAB_ALLOW_ORIGIN?.trim();
  if (raw === undefined || raw.length === 0) {
    throw new Error("Usage: pnpm policy:allow -- <https://merchant.example>");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid origin: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid origin protocol: ${raw}`);
  }
  return parsed.origin;
}

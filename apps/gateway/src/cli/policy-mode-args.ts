const MODES = ["observe", "approve", "autopay"] as const;

export type PolicyModeArg = (typeof MODES)[number];

export function resolvePolicyMode(argv: string[]): PolicyModeArg {
  const afterDash = argv.findIndex((arg) => arg === "--");
  const candidates = (afterDash >= 0 ? argv.slice(afterDash + 1) : argv).filter(
    (arg) => !arg.startsWith("-")
  );
  const raw = candidates[0] ?? process.env.AGENTTAB_POLICY_MODE?.trim();
  if (raw !== undefined && (MODES as readonly string[]).includes(raw)) {
    return raw as PolicyModeArg;
  }
  throw new Error("Usage: pnpm policy:mode -- <observe|approve|autopay>");
}

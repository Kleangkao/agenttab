export type PolicyCapField = "daily" | "payment" | "approve-above";

export interface PolicyCapChange {
  field: PolicyCapField;
  value: string | null;
}

export function resolvePolicyCap(argv: string[]): PolicyCapChange {
  const afterDash = argv.findIndex((arg) => arg === "--");
  const candidates = (afterDash >= 0 ? argv.slice(afterDash + 1) : argv).filter(
    (arg) => !arg.startsWith("-") || arg === "-"
  );
  const field = (candidates[0] ?? process.env.AGENTTAB_POLICY_CAP_FIELD?.trim()) as
    | PolicyCapField
    | undefined;
  const raw = candidates[1] ?? process.env.AGENTTAB_POLICY_CAP_VALUE?.trim();
  if (field !== "daily" && field !== "payment" && field !== "approve-above") {
    throw new Error(
      "Usage: pnpm policy:cap -- <daily|payment|approve-above> <micros|-> "
    );
  }
  if (raw === undefined || raw.length === 0) {
    throw new Error(
      "Usage: pnpm policy:cap -- <daily|payment|approve-above> <micros|-> "
    );
  }
  if (raw === "-") {
    if (field !== "approve-above") {
      throw new Error("Only approve-above can be cleared with -");
    }
    return { field, value: null };
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error("Cap value must be atomic USD micros (digits) or -");
  }
  return { field, value: raw };
}

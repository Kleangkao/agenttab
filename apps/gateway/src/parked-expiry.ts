import {
  isParkedApprovalExpired,
  parkedApprovalDeadline,
  type ExecutionState
} from "@agenttab/core";

export interface ParkedExpiryFields {
  parkedExpiresAt: string;
  parkedExpired: boolean;
}

export function parkedExpiryFor(
  input: { state: ExecutionState; createdAt: string; updatedAt?: string },
  policy: { parkedApprovalTtlSeconds?: number | undefined },
  now: Date = new Date()
): ParkedExpiryFields | Record<string, never> {
  if (input.state !== "approval_required") return {};
  const parkedAt = new Date(input.updatedAt ?? input.createdAt);
  if (Number.isNaN(parkedAt.getTime())) return {};
  return {
    parkedExpiresAt: parkedApprovalDeadline(parkedAt, policy).toISOString(),
    parkedExpired: isParkedApprovalExpired(parkedAt, policy, now)
  };
}

export function annotateParkedExpiry<T extends { state: ExecutionState; createdAt: string; updatedAt?: string }>(
  rows: readonly T[],
  policy: { parkedApprovalTtlSeconds?: number | undefined },
  now: Date = new Date()
): Array<T & Partial<ParkedExpiryFields>> {
  return rows.map((row) => ({ ...row, ...parkedExpiryFor(row, policy, now) }));
}

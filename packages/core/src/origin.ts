import { z } from "zod";

/** Canonical `URL.origin` for http(s) only (strips path, trailing slash, default ports). */
export function canonicalizeHttpOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid origin protocol: ${value}`);
  }
  return parsed.origin;
}

export const httpOriginSchema = z
  .url()
  .transform((value, ctx) => {
    try {
      return canonicalizeHttpOrigin(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "must be an http(s) origin" });
      return z.NEVER;
    }
  });

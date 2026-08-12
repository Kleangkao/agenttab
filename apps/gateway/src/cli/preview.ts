#!/usr/bin/env node
/**
 * Read-only policy preview. Never creates an execution or funds.
 *
 *   pnpm preview -- examples/intents/preview.local.json
 *   agenttab-preview -- examples/intents/preview.local.json
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paymentIntentSchema } from "@agenttab/core";
import { gatewayFetch } from "./gateway-http.js";
import { resolveIntentPath } from "./preview-args.js";

function readIntentFile(path: string): unknown {
  const absolute = resolve(path);
  const file = existsSync(absolute)
    ? absolute
    : resolve(process.cwd(), "../..", path);
  if (!existsSync(file)) {
    throw new Error(`Intent file not found: ${absolute}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (parsed !== null && typeof parsed === "object" && "notes" in parsed) {
    delete (parsed as { notes?: unknown }).notes;
  }
  return parsed;
}

async function main(): Promise<void> {
  const path = resolveIntentPath(process.argv.slice(2));
  const parsed = paymentIntentSchema.safeParse(readIntentFile(path));
  if (!parsed.success) {
    console.error(
      JSON.stringify(
        { error: "invalid_intent", source: path, message: parsed.error.message },
        null,
        2
      )
    );
    process.exit(1);
  }
  const response = await gatewayFetch("/v1/preview", {
    method: "POST",
    body: JSON.stringify(parsed.data)
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(
      JSON.stringify({ error: "preview_failed", status: response.status, body }, null, 2)
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify({ ok: true, source: path, ...(body as Record<string, unknown>) }, null, 2)
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

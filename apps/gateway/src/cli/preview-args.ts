export function resolveIntentPath(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  const flagIndex = argv.findIndex((arg) => arg === "--" || arg === "--file" || arg === "-f");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1]!;
  }
  const positional = argv.find((arg) => !arg.startsWith("-") && arg.endsWith(".json"));
  if (positional) return positional;
  const fromEnv = env.AGENTTAB_PREVIEW_INTENT?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    "Usage: pnpm preview -- <intent.json>   or set AGENTTAB_PREVIEW_INTENT"
  );
}

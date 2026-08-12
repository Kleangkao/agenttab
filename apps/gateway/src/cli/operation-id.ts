export function resolveOperationId(
  argv: string[],
  options: { command: string; envKeys?: string[]; usage: string }
): string {
  const flagIndex = argv.findIndex((arg) => arg === "--" || arg === "--id" || arg === "-i");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1]!;
  }
  const positional = argv.find(
    (arg) => !arg.startsWith("-") && arg !== options.command && !arg.endsWith(".ts")
  );
  if (positional) return positional;
  for (const key of options.envKeys ?? []) {
    const fromEnv = process.env[key]?.trim();
    if (fromEnv) return fromEnv;
  }
  throw new Error(options.usage);
}

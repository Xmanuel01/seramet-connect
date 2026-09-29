/**
 * Parse only user-supplied arguments, never the node executable or script path.
 * Default remains read-only. Explicit application is possible only with one
 * exact --apply argument and all separate backup/operator approval checks.
 */
export function parseStagingRecoveryMode(args) {
  if (
    !Array.isArray(args) ||
    args.length > 1 ||
    (args.length === 1 && !["--plan", "--apply"].includes(args[0]))
  ) {
    throw new Error("Use --plan OR --apply");
  }
  return args[0] === "--apply" ? "apply" : "plan";
}

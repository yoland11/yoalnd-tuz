const userAgent = process.env.npm_config_user_agent ?? "";
const execPath = process.env.npm_execpath ?? "";

const looksLikePnpm =
  userAgent.startsWith("pnpm/") ||
  execPath.includes("pnpm") ||
  process.env.PNPM_HOME !== undefined;

const looksLikeOtherManager =
  userAgent.startsWith("npm/") ||
  userAgent.startsWith("yarn/") ||
  userAgent.startsWith("bun/");

if (!looksLikePnpm && looksLikeOtherManager) {
  console.error("Use pnpm instead of npm/yarn/bun for this workspace.");
  process.exit(1);
}

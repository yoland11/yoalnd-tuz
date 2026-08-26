import { chmodSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync(".git") || !existsSync(".githooks/pre-push")) {
  console.log("AJN Git hook setup skipped (no writable Git checkout detected).");
  process.exit(0);
}

try {
  chmodSync(".githooks/pre-push", 0o755);
} catch {
  // Git for Windows does not require POSIX executable bits.
}

const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", ["config", "core.hooksPath", ".githooks"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
if (result.status !== 0) {
  console.warn("AJN Git hook setup warning: run `pnpm run setup:hooks` in a writable checkout.");
  process.exit(0);
}
console.log("AJN pre-push safety hook installed (.githooks/pre-push).");

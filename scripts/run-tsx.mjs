import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const shim = `--require ${resolve("scripts/tsx-windows-user-shim.cjs")}`;
const inheritedOptions = process.env.NODE_OPTIONS?.trim();
const result = spawnSync(
  process.execPath,
  [resolve("lib/db/node_modules/tsx/dist/cli.mjs"), ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_OPTIONS: inheritedOptions ? `${inheritedOptions} ${shim}` : shim,
    },
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);

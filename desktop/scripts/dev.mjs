import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = new URL("../../", import.meta.url);
const desktop = new URL("../", import.meta.url);
const explicitUrl = process.env.AJN_DESKTOP_URL;
let nextProcess = null;

async function waitFor(url) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch { /* server is still starting */ }
    await delay(500);
  }
  throw new Error("تعذر تشغيل خادم Next.js المحلي");
}

if (!explicitUrl) {
  nextProcess = spawn("pnpm", ["run", "dev"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  await waitFor("http://127.0.0.1:3000/admin/login");
}

const electronProcess = spawn("pnpm", ["run", "compile"], {
  cwd: desktop,
  stdio: "inherit",
  shell: process.platform === "win32",
});
await new Promise((resolve, reject) => {
  electronProcess.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`فشل compile: ${code}`)));
});

const appProcess = spawn("pnpm", ["exec", "electron", "."], {
  cwd: desktop,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, AJN_DESKTOP_URL: explicitUrl || "http://127.0.0.1:3000/admin/dashboard" },
});

function stop() {
  appProcess.kill("SIGTERM");
  nextProcess?.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
appProcess.once("exit", (code) => {
  nextProcess?.kill("SIGTERM");
  process.exit(code ?? 0);
});

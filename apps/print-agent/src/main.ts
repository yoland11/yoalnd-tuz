import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentConfig, PrintJob, PrinterInfo } from "./contracts.js";
import { salesInvoiceReceiptHtml } from "./receipt.js";

const DEFAULT_URL = "https://alijan-koshat.vercel.app";
const POLL_MS = 4_000;
const HEARTBEAT_MS = 30_000;
let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let printWindow: BrowserWindow | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let processing = false;
let status = "غير متصل";

function configPath() { return path.join(app.getPath("userData"), "print-agent-config.json"); }
function appIconPath() { return app.isPackaged ? path.join(process.resourcesPath, "assets", "icon.png") : path.join(import.meta.dirname, "..", "..", "..", "desktop", "assets", "icon.png"); }
function loadConfig(): AgentConfig | null {
  try {
    if (!existsSync(configPath())) return null;
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    if (!raw?.sealed || !safeStorage.isEncryptionAvailable()) return null;
    const config = JSON.parse(safeStorage.decryptString(Buffer.from(raw.sealed, "base64")));
    return typeof config?.agentToken === "string" && typeof config?.agentId === "string" ? config : null;
  } catch { return null; }
}
function saveConfig(config: AgentConfig) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("تعذر تأمين بيانات جهاز الطباعة في Windows.");
  const sealed = safeStorage.encryptString(JSON.stringify(config)).toString("base64");
  writeFileSync(configPath(), JSON.stringify({ sealed }), { encoding: "utf8", mode: 0o600 });
}
function clearConfig() { try { writeFileSync(configPath(), "", { encoding: "utf8", mode: 0o600 }); } catch { /* no config yet */ } }
function baseUrl(value: string) { const url = new URL(value || DEFAULT_URL); if (url.protocol !== "https:" && !url.hostname.match(/^(localhost|127\.0\.0\.1)$/)) throw new Error("يجب استخدام HTTPS لاتصال جهاز الطباعة."); return url.origin; }
async function api(pathname: string, init: RequestInit = {}) {
  const config = loadConfig();
  if (!config) throw new Error("جهاز الطباعة غير مسجل.");
  const result = await fetch(`${config.baseUrl}/api/print-agent${pathname}`, { ...init, headers: { "content-type": "application/json", "x-ajn-print-agent-token": config.agentToken, ...(init.headers ?? {}) } });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(String(data?.message ?? "تعذر الاتصال بخادم الطباعة."));
  return data;
}
async function getPrinters(): Promise<PrinterInfo[]> {
  const worker = printWindow ?? new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  if (!printWindow) printWindow = worker;
  return worker.webContents.getPrintersAsync();
}
function setStatus(next: string) { status = next; tray?.setToolTip(`AJN Print Agent — ${next}`); settingsWindow?.webContents.send("agent:status", { status, configured: Boolean(loadConfig()) }); }
async function heartbeat() {
  const config = loadConfig();
  if (!config) { setStatus("بانتظار التسجيل"); return; }
  try {
    await api("/heartbeat", { method: "POST", body: JSON.stringify({ hostname: os.hostname(), appVersion: app.getVersion(), printers: await getPrinters() }) });
    setStatus("متصل");
  } catch (error) { setStatus(`غير متصل: ${error instanceof Error ? error.message : "خطأ"}`); }
}
async function printPageSize(worker: BrowserWindow, payload: PrintJob["payload"]) {
  const paperSize = payload.paperSize;
  const landscape = payload.orientation === "landscape";
  if (paperSize === "a4") return landscape ? { width: 297_000, height: 210_000 } : { width: 210_000, height: 297_000 };
  if (paperSize === "a5") return landscape ? { width: 210_000, height: 148_000 } : { width: 148_000, height: 210_000 };
  if (paperSize === "custom") {
    const width = Math.min(210, Math.max(40, Number(payload.customWidthMm) || 80));
    const height = Math.min(500, Math.max(40, Number(payload.customHeightMm) || 297));
    return landscape ? { width: Math.round(height * 1000), height: Math.round(width * 1000) } : { width: Math.round(width * 1000), height: Math.round(height * 1000) };
  }
  // Chromium requires a height for a thermal Windows page. Derive it from the
  // canonical receipt content instead of using an A4-height page and scaling.
  const contentHeightPx = Number(await worker.webContents.executeJavaScript("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1)"));
  const height = Math.min(500_000, Math.max(10_000, Math.ceil(contentHeightPx * 25_400 / 96)));
  return { width: paperSize === "58mm" ? 58_000 : 80_000, height };
}
async function printDocument(worker: BrowserWindow, printerName: string, payload: PrintJob["payload"], copies: number) {
  const pageSize = await printPageSize(worker, payload);
  for (let copy = 0; copy < Math.min(Math.max(copies, 1), 5); copy += 1) {
    const accepted = await new Promise<boolean>((resolve) => worker.webContents.print({
      silent: true,
      deviceName: printerName,
      printBackground: true,
      pageSize,
      margins: { marginType: "none" },
    }, (ok) => resolve(ok)));
    if (!accepted) throw new Error("رفض Windows مهمة الطباعة أو الطابعة غير جاهزة.");
  }
}
async function printJob(job: PrintJob) {
  const printers = await getPrinters();
  if (!printers.some((printer) => printer.name === job.payload.printerName)) throw new Error("الطابعة المحددة لم تعد موجودة في Windows.");
  await api(`/jobs/${job.id}/printing`, { method: "POST", body: "{}" });
  const html = await salesInvoiceReceiptHtml(job.payload);
  const worker = printWindow ?? new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  printWindow = worker;
  await worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await printDocument(worker, job.payload.printerName, job.payload, job.copies);
  await api(`/jobs/${job.id}/complete`, { method: "POST", body: "{}" });
}
async function testPrint(requestedPrinterName?: string) {
  const printers = await getPrinters();
  const printerName = requestedPrinterName
    ? printers.find((printer) => printer.name === requestedPrinterName)?.name
    : printers.find((printer) => printer.isDefault)?.name ?? printers[0]?.name;
  if (!printerName) throw new Error("لا توجد طابعة Windows متاحة لاختبارها.");
  const payload: PrintJob["payload"] = {
    schemaVersion: 1, documentType: "sales_invoice", paperSize: "80mm", printerName,
    appearance: { logoUrl: null, companyName: "مجموعة علي جان نهاد", companyPhone: null, companyAddress: null, footerText: "", showLogo: true, showQr: true, showCustomerPhone: true, showEmployeeName: true, showAddress: true },
    invoice: { invoiceNo: "AJN PRINT TEST 1234567890", date: new Date().toISOString(), issuedAt: new Date().toISOString(), customerName: "مجموعة علي جان نهاد", customerPhone: null, paymentMethod: "اختبار", paymentStatus: "اختبار", subtotal: "0", discountAmount: "0", taxAmount: "0", total: "0", paidAmount: "0", remainingAmount: "0", notes: "اختبار طباعة عربية و QR", employeeName: null, items: [{ name: "اختبار الطابعة الحرارية", quantity: "0.5", unitPrice: "0", total: "0" }], qrUrl: "https://alijan-koshat.vercel.app" },
  };
  const html = await salesInvoiceReceiptHtml(payload);
  const worker = printWindow ?? new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  printWindow = worker;
  await worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await printDocument(worker, printerName, payload, 1);
  return { printerName };
}
async function poll() {
  if (processing || !loadConfig()) return;
  processing = true;
  try {
    const data = await api("/jobs");
    for (const listed of (data.jobs ?? []) as PrintJob[]) {
      try {
        const claim = await api(`/jobs/${listed.id}/claim`, { method: "POST", body: "{}" });
        await printJob(claim.job as PrintJob);
      } catch (error) {
        // A claimed/printing job is reported exactly once. The server applies a
        // capped delayed retry only when Windows rejected the print submission.
        try { await api(`/jobs/${listed.id}/fail`, { method: "POST", body: JSON.stringify({ errorMessage: error instanceof Error ? error.message.slice(0, 500) : "تعذر إرسال مهمة الطباعة." }) }); } catch { /* preserve original outcome in server log */ }
      }
    }
  } catch (error) { setStatus(`غير متصل: ${error instanceof Error ? error.message : "خطأ"}`); }
  finally { processing = false; }
}
async function register(input: { baseUrl: string; agentId: string; registrationToken: string }) {
  const origin = baseUrl(input.baseUrl);
  const result = await fetch(`${origin}/api/print-agent/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: input.agentId.trim(), registrationToken: input.registrationToken.trim(), hostname: os.hostname(), appVersion: app.getVersion(), printers: await getPrinters() }) });
  const data = await result.json().catch(() => ({}));
  if (!result.ok || !data?.agentToken) throw new Error(String(data?.message ?? "تعذر تسجيل جهاز الطباعة."));
  saveConfig({ baseUrl: origin, agentId: input.agentId.trim(), agentToken: data.agentToken });
  await heartbeat(); await poll();
  return { agentId: input.agentId.trim() };
}
function settingsHtml() { return `<!doctype html><html dir="rtl"><meta charset="utf-8"><style>body{font-family:Tahoma,Arial;background:#101015;color:#f4f4f5;padding:24px;line-height:1.5}main{max-width:520px;margin:auto}label{display:block;font-size:13px;margin-top:12px;color:#d4d4d8}input{width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #3f3f46;border-radius:8px;background:#18181b;color:white}button{margin-top:18px;margin-left:8px;padding:10px 14px;border:0;border-radius:8px;background:#f3c649;color:#171717;font-weight:bold;cursor:pointer}.muted{font-size:12px;color:#a1a1aa}.status{margin-top:16px;padding:10px;background:#18181b;border-radius:8px}</style><main><h1>AJN Print Agent</h1><p class="muted">سجّل هذا الجهاز برمز لمرة واحدة من إعدادات AJN → طابور الطباعة.</p><label>رابط AJN<input id="url" value="${DEFAULT_URL}" dir="ltr"></label><label>Agent ID<input id="agentId" placeholder="AJN-PRINT-001" dir="ltr"></label><label>رمز التسجيل<input id="token" type="password" dir="ltr"></label><button id="save">تسجيل الجهاز</button><button id="test">طباعة اختبار</button><div id="status" class="status">جاري التحقق...</div></main><script>const status=document.querySelector('#status');window.agent.status().then(x=>status.textContent=x.status);document.querySelector('#save').onclick=async()=>{try{status.textContent='جاري التسجيل...';await window.agent.register({baseUrl:url.value,agentId:agentId.value,registrationToken:token.value});token.value='';status.textContent='تم التسجيل والاتصال بنجاح.'}catch(e){status.textContent=e.message||'تعذر التسجيل'}};document.querySelector('#test').onclick=async()=>{try{status.textContent='جاري طباعة الاختبار...';const x=await window.agent.testPrint();status.textContent='تم إرسال الاختبار إلى '+x.printerName}catch(e){status.textContent=e.message||'تعذرت الطباعة'}}</script></html>`; }
function openSettings() { if (settingsWindow) { settingsWindow.show(); settingsWindow.focus(); return; } settingsWindow = new BrowserWindow({ width: 600, height: 540, title: "AJN Print Agent", webPreferences: { preload: path.join(import.meta.dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } }); settingsWindow.on("closed", () => { settingsWindow = null; }); void settingsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(settingsHtml())}`); }
function createTray() { tray = new Tray(nativeImage.createFromPath(appIconPath())); tray.setToolTip("AJN Print Agent"); tray.setContextMenu(Menu.buildFromTemplate([{ label: "الحالة: اتصال", enabled: false }, { label: "فتح الإعدادات", click: openSettings }, { label: "اختبار الطباعة", click: () => { void testPrint().then(({ printerName }) => setStatus(`تم إرسال اختبار إلى ${printerName}`)).catch((error) => setStatus(error instanceof Error ? error.message : "تعذرت طباعة الاختبار")); } }, { label: "إعادة الاتصال", click: () => { void heartbeat(); void poll(); } }, { label: "إيقاف التشغيل التلقائي", click: () => app.setLoginItemSettings({ openAtLogin: false }) }, { label: "تشغيل مع Windows", click: () => app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true }) }, { type: "separator" }, { label: "خروج", click: () => app.quit() }])); tray.on("click", openSettings); }

app.whenReady().then(() => {
  app.setAppUserModelId("com.ajn.erp.print-agent");
  const testPrinter = process.argv.find((argument) => argument.startsWith("--test-printer="))?.slice("--test-printer=".length);
  if (testPrinter) {
    // Installer validation only: this bypasses registration and never reads or
    // changes the server queue. It prints the canonical local test receipt.
    // A Windows driver that never acknowledges the test must not leave a hidden
    // Electron process running and holding the next installer build open.
    const testTimeout = setTimeout(() => {
      printWindow?.destroy();
      app.exit(2);
    }, 25_000);
    void testPrint(testPrinter).then(() => {
      clearTimeout(testTimeout);
      printWindow?.destroy();
      app.exit(0);
    }).catch((error) => { clearTimeout(testTimeout); console.error(error); app.exit(1); });
    return;
  }
  if (process.platform === "win32") app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  createTray();
  ipcMain.handle("agent:status", () => ({ status, configured: Boolean(loadConfig()) }));
  ipcMain.handle("agent:register", (_event, input) => register(input));
  ipcMain.handle("agent:test-print", () => testPrint());
  ipcMain.handle("agent:disconnect", () => { clearConfig(); setStatus("بانتظار التسجيل"); });
  openSettings(); void heartbeat(); pollTimer = setInterval(() => void poll(), POLL_MS); heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_MS);
});
app.on("before-quit", () => { if (pollTimer) clearInterval(pollTimer); if (heartbeatTimer) clearInterval(heartbeatTimer); printWindow?.destroy(); });

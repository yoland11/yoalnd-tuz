import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  session,
  shell,
  type IpcMainInvokeEvent,
  type WebContentsPrintOptions,
} from "electron";
import electronUpdater from "electron-updater";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopRequest, DesktopSettings } from "./contracts.js";
import { LocalDatabase } from "./database.js";
import { SyncManager } from "./sync.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const { autoUpdater } = electronUpdater;
const isDevelopment = !app.isPackaged;
const defaultUrl = isDevelopment
  ? "http://127.0.0.1:3000/admin/dashboard"
  : "https://alijan-koshat.vercel.app/admin/dashboard";
const appUrl = process.env.AJN_DESKTOP_URL || defaultUrl;
const allowedOrigin = new URL(appUrl).origin;
const partitionName = "persist:ajn-desktop";

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let database: LocalDatabase | null = null;
let syncManager: SyncManager | null = null;
let backupTimer: NodeJS.Timeout | null = null;

function assetPath(name: string) {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", name)
    : path.join(dirname, "..", "assets", name);
}

function preloadPath() { return path.join(dirname, "preload.cjs"); }

function trustedUrl(value: string) {
  try { return new URL(value).origin === allowedOrigin; }
  catch { return false; }
}

function applyWindowSettings(settings: DesktopSettings) {
  if (!mainWindow) return;
  mainWindow.setKiosk(settings.kiosk);
  if (!settings.kiosk) mainWindow.setFullScreen(settings.fullscreen);
  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup, openAsHidden: false });
  }
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 470,
    height: 300,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    icon: assetPath("icon.png"),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  void splashWindow.loadFile(assetPath("splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow?.show());
}

function configureChildWindows(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || trustedUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          icon: assetPath("icon.png"),
          webPreferences: {
            preload: preloadPath(),
            partition: partitionName,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: isDevelopment,
          },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (trustedUrl(url) || url.startsWith("file://")) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
}

async function createMainWindow() {
  const settings = database?.getSettings();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 650,
    show: false,
    backgroundColor: "#0B0B12",
    autoHideMenuBar: true,
    title: "AJN",
    icon: assetPath("icon.png"),
    webPreferences: {
      preload: preloadPath(),
      partition: partitionName,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDevelopment,
      spellcheck: false,
    },
  });
  configureChildWindows(mainWindow);

  mainWindow.webContents.on("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    console.error("AJN desktop load failed", { code, description, validatedUrl });
    void mainWindow?.loadFile(assetPath("offline.html"));
  });
  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow?.isVisible()) mainWindow?.show();
    splashWindow?.close();
    splashWindow = null;
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  if (settings) applyWindowSettings(settings);
  await mainWindow.loadURL(appUrl);
}

function installMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "AJN",
      submenu: [
        { label: "تحديث الصفحة", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
        { label: "مزامنة الآن", accelerator: "CmdOrCtrl+Shift+S", click: () => void syncManager?.syncNow() },
        { label: "ملء الشاشة", accelerator: "F11", click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()) },
        { type: "separator" },
        ...(isDevelopment ? [{ label: "أدوات المطور", accelerator: "F12", click: () => mainWindow?.webContents.toggleDevTools() } as Electron.MenuItemConstructorOptions] : []),
        { role: "quit", label: "خروج" },
      ],
    },
    { role: "editMenu", label: "تحرير" },
    { role: "windowMenu", label: "نافذة" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function paperOptions(settings: DesktopSettings): WebContentsPrintOptions["pageSize"] {
  if (settings.paperSize === "A4") return "A4";
  return { width: settings.paperSize === "58mm" ? 58000 : 80000, height: 297000 };
}

function registerIpc() {
  ipcMain.handle("desktop:info", () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, appUrl }));
  ipcMain.handle("desktop:sync-state", () => syncManager?.state());
  ipcMain.handle("desktop:list-operations", () => database?.listOperations() ?? []);
  ipcMain.handle("desktop:sync-now", () => syncManager?.syncNow());
  ipcMain.handle("desktop:retry", (_event, id: number) => syncManager?.retry(id));
  ipcMain.handle("desktop:discard", (_event, id: number) => syncManager?.discard(id));
  ipcMain.handle("desktop:request", (_event, request: DesktopRequest) => syncManager?.request(request));
  ipcMain.handle("desktop:get-settings", () => database?.getSettings());
  ipcMain.handle("desktop:update-settings", (_event, patch: Partial<DesktopSettings>) => {
    const settings = database?.setSettings(patch);
    if (settings) applyWindowSettings(settings);
    return settings;
  });
  ipcMain.handle("desktop:list-printers", (event) => event.sender.getPrintersAsync());
  ipcMain.handle("desktop:print", (event: IpcMainInvokeEvent, override: Partial<DesktopSettings> = {}) => new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const settings = { ...(database?.getSettings() ?? {}), ...override } as DesktopSettings;
    event.sender.print({
      silent: settings.silentPrint,
      deviceName: settings.defaultPrinter || undefined,
      printBackground: true,
      pageSize: paperOptions(settings),
      margins: { marginType: "none" },
    }, (success, failureReason) => resolve(success ? { ok: true } : { ok: false, error: failureReason }));
  }));
  ipcMain.handle("desktop:reload", async () => {
    if (!mainWindow) return;
    if (mainWindow.webContents.getURL().startsWith("file://")) await mainWindow.loadURL(appUrl);
    else mainWindow.reload();
  });
  ipcMain.handle("desktop:check-updates", async () => {
    if (!app.isPackaged || process.env.AJN_UPDATE_ENABLED !== "1") return { enabled: false, message: "التحديث التلقائي جاهز لكنه غير مفعّل" };
    const result = await autoUpdater.checkForUpdates();
    return { enabled: true, version: result?.updateInfo.version ?? null };
  });
  ipcMain.handle("desktop:list-backups", () => database?.listBackups() ?? []);
  ipcMain.handle("desktop:create-backup", () => database?.createBackup("manual"));
  ipcMain.handle("desktop:export-backup", async () => {
    if (!database || !mainWindow) return null;
    const selected = await dialog.showSaveDialog(mainWindow, { title: "تصدير نسخة AJN المحلية", defaultPath: `AJN-local-${new Date().toISOString().slice(0, 10)}.sqlite`, filters: [{ name: "AJN SQLite", extensions: ["sqlite"] }] });
    if (selected.canceled || !selected.filePath) return null;
    return database.exportTo(selected.filePath);
  });
  ipcMain.handle("desktop:import-backup", async () => {
    if (!database || !mainWindow) return null;
    const selected = await dialog.showOpenDialog(mainWindow, { title: "استيراد نسخة AJN المحلية", properties: ["openFile"], filters: [{ name: "AJN SQLite", extensions: ["sqlite"] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    await database.importFrom(selected.filePaths[0]);
    return { ok: true };
  });
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    if (Notification.isSupported()) new Notification({ title: "تحديث AJN متاح", body: `الإصدار ${info.version}` }).show();
  });
  autoUpdater.on("error", (error) => console.error("desktop updater", error.message));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("com.ajn.erp.desktop");
    nativeTheme.themeSource = "dark";
    const desktopSession = session.fromPartition(partitionName);
    desktopSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === "notifications"));
    desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders["X-AJN-Desktop"] = "1";
      callback({ requestHeaders: details.requestHeaders });
    });
    database = new LocalDatabase();
    syncManager = new SyncManager(database, desktopSession, () => mainWindow?.webContents ?? null, allowedOrigin);
    registerIpc();
    installMenu();
    configureUpdater();
    createSplash();
    await createMainWindow();
    syncManager.start();
    void database.ensureDailyBackup().catch((error) => console.error("daily local backup", error));
    backupTimer = setInterval(() => {
      void database?.ensureDailyBackup().catch((error) => console.error("daily local backup", error));
    }, 60 * 60 * 1000);
  });
}

app.on("activate", () => { if (!mainWindow) void createMainWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  syncManager?.stop();
  if (backupTimer) clearInterval(backupTimer);
  database?.close();
});

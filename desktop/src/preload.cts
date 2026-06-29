import { contextBridge, ipcRenderer } from "electron";
import type { DesktopRequest, DesktopResponse, DesktopSettings, SyncState } from "./contracts.js";

const api = {
  isDesktop: true as const,
  info: () => ipcRenderer.invoke("desktop:info"),
  request: (request: DesktopRequest): Promise<DesktopResponse> => ipcRenderer.invoke("desktop:request", request),
  getSyncState: (): Promise<SyncState> => ipcRenderer.invoke("desktop:sync-state"),
  listOperations: () => ipcRenderer.invoke("desktop:list-operations"),
  syncNow: () => ipcRenderer.invoke("desktop:sync-now"),
  retry: (id: number) => ipcRenderer.invoke("desktop:retry", id),
  discard: (id: number) => ipcRenderer.invoke("desktop:discard", id),
  onSyncState: (listener: (state: SyncState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SyncState) => listener(state);
    ipcRenderer.on("desktop:sync-state", handler);
    return () => ipcRenderer.removeListener("desktop:sync-state", handler);
  },
  getSettings: (): Promise<DesktopSettings> => ipcRenderer.invoke("desktop:get-settings"),
  updateSettings: (patch: Partial<DesktopSettings>): Promise<DesktopSettings> => ipcRenderer.invoke("desktop:update-settings", patch),
  listPrinters: () => ipcRenderer.invoke("desktop:list-printers"),
  print: (settings?: Partial<DesktopSettings>) => ipcRenderer.invoke("desktop:print", settings ?? {}),
  reload: () => ipcRenderer.invoke("desktop:reload"),
  checkUpdates: () => ipcRenderer.invoke("desktop:check-updates"),
  listBackups: () => ipcRenderer.invoke("desktop:list-backups"),
  createBackup: () => ipcRenderer.invoke("desktop:create-backup"),
  exportBackup: () => ipcRenderer.invoke("desktop:export-backup"),
  importBackup: () => ipcRenderer.invoke("desktop:import-backup"),
};

contextBridge.exposeInMainWorld("ajnDesktop", api);

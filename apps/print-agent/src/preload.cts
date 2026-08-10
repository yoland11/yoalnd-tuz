import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("agent", {
  status: () => ipcRenderer.invoke("agent:status"),
  register: (input: { baseUrl: string; agentId: string; registrationToken: string }) => ipcRenderer.invoke("agent:register", input),
  testPrint: () => ipcRenderer.invoke("agent:test-print"),
});

import { contextBridge, ipcRenderer } from "electron";
import { ORDER_STATUSES } from "../shared/api-client";

// Narrow, purpose-built bridge. The renderer gets no ipcRenderer, no Node,
// no filesystem and no session token -- only these named calls.
function subscribe(channel: string, callback: (payload: unknown) => void): () => void {
  const handler = (_event: unknown, payload: unknown) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("mbsUser", {
  config: {
    get: () => ipcRenderer.invoke("config:get") as Promise<{
      apiUrl: string;
      workspaceId: string;
      signedIn: boolean;
      settingsLocked: boolean;
      settingsUnlocked: boolean;
    }>,
    set: (config: { apiUrl?: string; workspaceId?: string }) =>
      ipcRenderer.invoke("config:set", config) as Promise<{ success: boolean; error?: string }>,
    unlock: (password: string) =>
      ipcRenderer.invoke("config:unlock", { password }) as Promise<{ success: boolean; error?: string }>,
    setLock: (password: string | null) =>
      ipcRenderer.invoke("config:setLock", { password }) as Promise<{ success: boolean; error?: string }>,
    relock: () =>
      ipcRenderer.invoke("config:relock") as Promise<{ success: boolean; error?: string }>
  },
  auth: {
    login: (input: { username: string; password: string }) => ipcRenderer.invoke("auth:login", input),
    logout: () => ipcRenderer.invoke("auth:logout"),
    refresh: () => ipcRenderer.invoke("session:refresh")
  },
  data: {
    list: (collection: string) => ipcRenderer.invoke("data:list", collection)
  },
  orders: {
    statuses: [...ORDER_STATUSES],
    updateStatus: (input: { localId: string; status: string; expectedRevision: number }) =>
      ipcRenderer.invoke("orders:updateStatus", input)
  },
  connection: {
    check: () => ipcRenderer.invoke("connection:check")
  },
  onSessionChanged: (callback: (payload: unknown) => void) => subscribe("session:changed", callback),
  onConnectionChanged: (callback: (payload: unknown) => void) => subscribe("connection:changed", callback)
});

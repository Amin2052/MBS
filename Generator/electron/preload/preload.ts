import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("generator", {

  vault: {
    isInitialized: () => ipcRenderer.invoke("vault:isInitialized"),
    isUnlocked: () => ipcRenderer.invoke("vault:isUnlocked"),
    setup: (password: string) => ipcRenderer.invoke("vault:setup", password),
    unlock: (password: string) => ipcRenderer.invoke("vault:unlock", password),
    verifyRecoveryKey: (key: string) => ipcRenderer.invoke("vault:verifyRecoveryKey", key),
    recover: (key: string, newPassword: string) => ipcRenderer.invoke("vault:recover", key, newPassword),
    lock: () => ipcRenderer.invoke("vault:lock"),
    lockoutStatus: () => ipcRenderer.invoke("vault:lockoutStatus")
  },

  settings: {
    cloud: {
      get: () => ipcRenderer.invoke("settings:cloud:get"),
      save: (settings: any) => ipcRenderer.invoke("settings:cloud:save", settings)
    }
  },

  keys: {
    info: () => ipcRenderer.invoke("keys:info")
  },

  license: {
    generate: (input: any) => ipcRenderer.invoke("license:generate", input),
    reExport: (licenseId: string) => ipcRenderer.invoke("license:reExport", licenseId),
    replace: (licenseId: string, overrides: any, notes?: string) =>
      ipcRenderer.invoke("license:replace", licenseId, overrides, notes),
    renew: (licenseId: string, newExpirationDate: string | null, notes?: string) =>
      ipcRenderer.invoke("license:renew", licenseId, newExpirationDate, notes),
    revoke: (licenseId: string, reason?: string) => ipcRenderer.invoke("license:revoke", licenseId, reason),
    list: () => ipcRenderer.invoke("license:list"),
    search: (query: string) => ipcRenderer.invoke("license:search", query),
    get: (licenseId: string) => ipcRenderer.invoke("license:get", licenseId),
    history: (licenseId: string) => ipcRenderer.invoke("license:history", licenseId)
  },

  dashboard: {
    counts: () => ipcRenderer.invoke("dashboard:counts")
  },

  revocation: {
    exportBundle: () => ipcRenderer.invoke("revocation:export")
  },

  database: {
    backup: () => ipcRenderer.invoke("database:backup"),
    restore: (confirmation: string) => ipcRenderer.invoke("database:restore", confirmation),
    reset: (confirmation: string) => ipcRenderer.invoke("database:reset", confirmation)
  }

});

import { contextBridge, ipcRenderer } from "electron";
import type { SmartPuckApi } from "../shared/types";

const api: SmartPuckApi = {
  library: {
    snapshot: () => ipcRenderer.invoke("library:snapshot"),
    chooseRoot: () => ipcRenderer.invoke("library:choose-root"),
    openRoot: () => ipcRenderer.invoke("library:open-root"),
    createWorkplace: (name) => ipcRenderer.invoke("library:create-workplace", name),
    renameWorkplace: (id, name) => ipcRenderer.invoke("library:rename-workplace", id, name),
    deleteWorkplace: (id) => ipcRenderer.invoke("library:delete-workplace", id),
    reorderWorkplaces: (ids) => ipcRenderer.invoke("library:reorder-workplaces", ids),
    importAudio: (paths, workplaceId) => ipcRenderer.invoke("library:import", paths, workplaceId),
    renameMeeting: (id, title) => ipcRenderer.invoke("library:rename", id, title),
    moveMeeting: (id, workplaceId) => ipcRenderer.invoke("library:move", id, workplaceId),
    addMeetingToWorkplace: (id, workplaceId) => ipcRenderer.invoke("library:add-to-workplace", id, workplaceId),
    removeMeetingFromWorkplace: (id, workplaceId) => ipcRenderer.invoke("library:remove-from-workplace", id, workplaceId),
    deleteMeeting: (id) => ipcRenderer.invoke("library:delete-meeting", id),
    saveTranscript: (id, text) => ipcRenderer.invoke("library:save-transcript", id, text),
    transcribe: (id) => ipcRenderer.invoke("library:transcribe", id),
    onChanged: (callback) => { const listener = (): void => callback(); ipcRenderer.on("library-changed", listener); return () => ipcRenderer.removeListener("library-changed", listener); },
  },
  device: {
    connect: (url) => ipcRenderer.invoke("device:connect", url),
    refresh: () => ipcRenderer.invoke("device:refresh"),
    setRecording: (action) => ipcRenderer.invoke("device:record", action),
    previewAudio: (path) => ipcRenderer.invoke("device:preview-audio", path),
    importSession: (path, workplaceId) => ipcRenderer.invoke("device:import", path, workplaceId),
    importNew: (workplaceId) => ipcRenderer.invoke("device:import-new", workplaceId),
    renameSession: (path, name) => ipcRenderer.invoke("device:rename-session", path, name),
    deleteSession: (path) => ipcRenderer.invoke("device:delete-session", path),
    wifiConfig: () => ipcRenderer.invoke("device:wifi-config"),
    saveWifi: (ssid, password) => ipcRenderer.invoke("device:save-wifi", ssid, password),
    removeWifi: (ssid) => ipcRenderer.invoke("device:remove-wifi", ssid),
    onChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof callback>[0]): void => callback(snapshot); ipcRenderer.on("device-changed", listener); return () => ipcRenderer.removeListener("device-changed", listener); },
    onSyncProgress: (callback) => { const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]): void => callback(progress); ipcRenderer.on("device-sync-progress", listener); return () => ipcRenderer.removeListener("device-sync-progress", listener); },
  },
  dialogs: { chooseAudio: () => ipcRenderer.invoke("dialog:audio") },
};
contextBridge.exposeInMainWorld("smartpuck", api);

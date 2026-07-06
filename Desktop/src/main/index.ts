import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { randomUUID } from "crypto";
import { createReadStream, rmSync, statSync } from "fs";
import { dirname, extname, join } from "path";
import { Readable } from "stream";
import chokidar from "chokidar";
import {
  addMeetingToWorkplace, createWorkplace, deleteMeeting, deleteWorkplace, ensureLibrary, importAudio, libraryRoot,
  moveMeeting, meetingById, removeMeetingFromWorkplace, renameMeeting, renameWorkplace, reorderWorkplaces, saveTranscript,
  setLibraryRoot, snapshot, updateMeetingMetadata,
} from "./library";
import { transcribeMeeting, stopTranscriptionWorker, prestartTranscriptionWorker } from "./transcription";
import { connectDevice, deleteDeviceSession, getDeviceWifiConfig, importDeviceSession, prepareDeviceSessionAudio, refreshDevice, removeDeviceWifi, renameDeviceSession, saveDeviceWifi, setDeviceRecording } from "./device";
import type { DeviceSyncProgress } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let watcher: ReturnType<typeof chokidar.watch> | null = null;
let automationTimer: NodeJS.Timeout | null = null;
const pendingTimers = new Set<NodeJS.Timeout>();
const devicePreviewFiles = new Map<string, string>();
let automationRunning = false;
let quitting = false;
let transcriptionDrainRunning = false;
const transcriptionQueue: string[] = [];
const transcriptionQueued = new Set<string>();

function safeSend(channel: string, ...args: unknown[]): void {
  if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, ...args);
}

function emitDeviceSyncProgress(progress: DeviceSyncProgress): void {
  safeSend("device-sync-progress", progress);
}

function schedule(delayMs: number, task: () => void): void {
  if (quitting) return;
  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    if (!quitting) task();
  }, delayMs);
  pendingTimers.add(timer);
}

protocol.registerSchemesAsPrivileged([
  { scheme: "smartpuck", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

function registerMediaProtocol(): void {
  protocol.handle("smartpuck", (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "audio" && url.hostname !== "device-audio") return new Response("Not found", { status: 404 });
    try {
      const filePath = url.hostname === "device-audio"
        ? devicePreviewFiles.get(decodeURIComponent(url.pathname.slice(1)))
        : (() => {
            const meeting = meetingById(decodeURIComponent(url.pathname.slice(1)));
            const audioFile = meeting.metadata.processedAudioFile || meeting.metadata.audioFile;
            return join(meeting.path, audioFile);
          })();
      if (!filePath) return new Response("Device audio not found", { status: 404 });
      const size = statSync(filePath).size;
      const contentType = extname(filePath).toLowerCase() === ".wav" ? "audio/wav" : "audio/mpeg";
      const range = request.headers.get("range");
      let start = 0;
      let end = size - 1;
      let status = 200;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        start = match[1] ? Number(match[1]) : 0;
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
          return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        }
        status = 206;
      }
      const headers: Record<string, string> = {
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1),
        "content-type": contentType,
      };
      if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${size}`;
      const body = Readable.toWeb(createReadStream(filePath, { start, end })) as BodyInit;
      return new Response(body, { status, headers });
    } catch {
      return new Response("Audio not found", { status: 404 });
    }
  });
}
function watchLibrary(): void {
  void watcher?.close();
  watcher = chokidar.watch(libraryRoot(), { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 } });
  let timer: NodeJS.Timeout | null = null;
  watcher.on("all", () => {
    if (quitting) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      safeSend("library-changed");
    }, 300);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 920, minHeight: 640, show: false,
    backgroundColor: "#0c0d0f",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false, contextIsolation: true },
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

function allMeetingIds(state: ReturnType<typeof snapshot>): Set<string> {
  return new Set([...state.inbox, ...state.workplaces.flatMap((workplace) => workplace.meetings)].map((meeting) => meeting.metadata.id));
}

async function drainTranscriptions(): Promise<void> {
  if (transcriptionDrainRunning) return;
  transcriptionDrainRunning = true;
  try {
    while (!quitting && transcriptionQueue.length > 0) {
      const meetingId = transcriptionQueue.shift();
      if (!meetingId) continue;
      try {
        await transcribeMeeting(meetingId);
      } catch {
        // transcribeMeeting records the user-facing error in meeting metadata.
      } finally {
        transcriptionQueued.delete(meetingId);
        safeSend("library-changed");
      }
    }
  } finally {
    transcriptionDrainRunning = false;
    if (!quitting && transcriptionQueue.length > 0) void drainTranscriptions();
  }
}

function enqueueTranscription(meetingId: string): ReturnType<typeof snapshot> {
  if (transcriptionQueued.has(meetingId)) return snapshot();
  updateMeetingMetadata(meetingId, {
    status: "queued",
    progressPercent: 0,
    progressStage: "Queued",
    error: undefined,
  });
  transcriptionQueued.add(meetingId);
  transcriptionQueue.push(meetingId);
  safeSend("library-changed");
  void drainTranscriptions();
  return snapshot();
}

function resumePendingTranscriptions(): void {
  const state = snapshot();
  const meetings = [...state.inbox, ...state.workplaces.flatMap((workplace) => workplace.meetings)];
  const seen = new Set<string>();
  for (const meeting of meetings) {
    if (seen.has(meeting.metadata.id)) continue;
    seen.add(meeting.metadata.id);
    if (meeting.metadata.status === "queued" || meeting.metadata.status === "transcribing") {
      enqueueTranscription(meeting.metadata.id);
    }
  }
}

function beginNewTranscriptions(before: Set<string>, result: ReturnType<typeof snapshot>): void {
  const added = [...result.inbox, ...result.workplaces.flatMap((workplace) => workplace.meetings)]
    .filter((meeting) => !before.has(meeting.metadata.id) || meeting.metadata.status === "queued");
  for (const meeting of added) enqueueTranscription(meeting.metadata.id);
}

async function syncNewDeviceSessions(workplaceId?: string): Promise<ReturnType<typeof snapshot>> {
  const initial = snapshot();
  const before = allMeetingIds(initial);
  const device = await refreshDevice();
  if (!device?.connected) throw new Error(device?.error || "SmartPuck is not connected.");
  let result = initial;
  for (const session of device.sessions.filter((item) => !item.uploaded)) {
    try {
      result = await importDeviceSession(session.path, workplaceId, { onProgress: emitDeviceSyncProgress });
    } catch (error) {
      emitDeviceSyncProgress({ path: session.path, name: session.name, phase: "error", message: (error as Error).message });
      throw error;
    }
  }
  beginNewTranscriptions(before, result);
  return snapshot();
}

async function runDeviceAutomation(): Promise<void> {
  if (automationRunning) return;
  automationRunning = true;
  try {
    let device = await refreshDevice();
    if (!device?.connected) {
      device = await connectDevice("http://smartpuck.local");
      if (!device.connected) device = await connectDevice("http://192.168.4.1");
      if (!device.connected) device = await connectDevice("usb://auto");
    }
    safeSend("device-changed", device);
    if (device.connected && !device.recording && device.sessions.some((session) => !session.uploaded)) {
      await syncNewDeviceSessions();
      device = await refreshDevice();
      safeSend("device-changed", device);
    }
  } catch {
    // Discovery is best-effort. The manual connection UI remains available.
  } finally {
    automationRunning = false;
  }
}

function startDeviceAutomation(): void {
  if (process.env.SMARTPUCK_DISABLE_AUTO_SYNC === "1") return;
  schedule(1_000, () => void runDeviceAutomation());
  automationTimer = setInterval(() => void runDeviceAutomation(), 30_000);
}

function registerIpc(): void {
  const importAndTranscribe = async (paths: string[], workplaceId?: string) => {
    const initial = snapshot();
    const before = allMeetingIds(initial);
    const imported = importAudio(paths, workplaceId);
    const added = [...imported.inbox, ...imported.workplaces.flatMap((w) => w.meetings)].filter((m) => !before.has(m.metadata.id));
    for (const meeting of added) enqueueTranscription(meeting.metadata.id);
    return snapshot();
  };
  ipcMain.handle("library:snapshot", () => snapshot());
  ipcMain.handle("library:choose-root", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    setLibraryRoot(result.filePaths[0]); watchLibrary(); return snapshot();
  });
  ipcMain.handle("library:open-root", () => shell.openPath(ensureLibrary()));
  ipcMain.handle("library:create-workplace", (_e, name: string) => createWorkplace(name));
  ipcMain.handle("library:rename-workplace", (_e, id: string, name: string) => renameWorkplace(id, name));
  ipcMain.handle("library:delete-workplace", (_e, id: string) => deleteWorkplace(id));
  ipcMain.handle("library:reorder-workplaces", (_e, ids: string[]) => reorderWorkplaces(ids));
  ipcMain.handle("library:import", (_e, paths: string[], workplaceId?: string) => importAndTranscribe(paths, workplaceId));
  ipcMain.handle("library:rename", (_e, id: string, title: string) => renameMeeting(id, title));
  ipcMain.handle("library:move", (_e, id: string, workplaceId?: string) => moveMeeting(id, workplaceId));
  ipcMain.handle("library:add-to-workplace", (_e, id: string, workplaceId: string) => addMeetingToWorkplace(id, workplaceId));
  ipcMain.handle("library:remove-from-workplace", (_e, id: string, workplaceId: string) => removeMeetingFromWorkplace(id, workplaceId));
  ipcMain.handle("library:delete-meeting", (_e, id: string) => deleteMeeting(id));
  ipcMain.handle("library:save-transcript", (_e, id: string, text: string) => saveTranscript(id, text));
  ipcMain.handle("library:transcribe", (_e, id: string) => enqueueTranscription(id));
  ipcMain.handle("dialog:audio", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "flac", "ogg", "pcm"] }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("device:connect", async (_e, url: string) => {
    const device = await connectDevice(url);
    safeSend("device-changed", device);
    if (device.connected) schedule(0, () => void runDeviceAutomation());
    return device;
  });
  ipcMain.handle("device:refresh", async () => {
    const device = await refreshDevice();
    safeSend("device-changed", device);
    return device;
  });
  ipcMain.handle("device:record", async (_e, action: "start" | "stop") => {
    const device = await setDeviceRecording(action);
    safeSend("device-changed", device);
    if (action === "stop") schedule(0, () => void runDeviceAutomation());
    return device;
  });
  ipcMain.handle("device:import", async (_e, path: string, workplaceId?: string) => {
    const initial = snapshot();
    const before = allMeetingIds(initial);
    try {
      const result = await importDeviceSession(path, workplaceId, { onProgress: emitDeviceSyncProgress });
      beginNewTranscriptions(before, result);
      return snapshot();
    } catch (error) {
      emitDeviceSyncProgress({ path, phase: "error", message: (error as Error).message });
      throw error;
    }
  });
  ipcMain.handle("device:import-new", (_e, workplaceId?: string) => syncNewDeviceSessions(workplaceId));
  ipcMain.handle("device:preview-audio", async (_e, path: string) => {
    const filePath = await prepareDeviceSessionAudio(path);
    const token = randomUUID();
    devicePreviewFiles.set(token, filePath);
    return `smartpuck://device-audio/${encodeURIComponent(token)}`;
  });
  ipcMain.handle("device:rename-session", async (_e, path: string, name: string) => {
    const device = await renameDeviceSession(path, name);
    safeSend("device-changed", device);
    return device;
  });
  ipcMain.handle("device:delete-session", async (_e, path: string) => {
    const device = await deleteDeviceSession(path);
    safeSend("device-changed", device);
    return device;
  });
  ipcMain.handle("device:wifi-config", async () => {
    try {
      return await getDeviceWifiConfig();
    } catch {
      return null;
    }
  });
  ipcMain.handle("device:save-wifi", async (_e, ssid: string, password: string) => {
    await saveDeviceWifi(ssid, password);
    schedule(2_000, () => void runDeviceAutomation());
  });
  ipcMain.handle("device:remove-wifi", (_e, ssid: string) => removeDeviceWifi(ssid));
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.smartpuck.desktop");
  app.on("browser-window-created", (_, window) => optimizer.watchWindowShortcuts(window));
  ensureLibrary(); prestartTranscriptionWorker(); registerMediaProtocol(); registerIpc(); watchLibrary(); createWindow(); resumePendingTranscriptions(); startDeviceAutomation();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  quitting = true;
  if (automationTimer) clearInterval(automationTimer);
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
  for (const filePath of devicePreviewFiles.values()) {
    rmSync(dirname(filePath), { recursive: true, force: true });
  }
  devicePreviewFiles.clear();
  stopTranscriptionWorker();
  void watcher?.close();
});

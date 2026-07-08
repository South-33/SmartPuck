import { closeSync, copyFileSync, createWriteStream, mkdtempSync, openSync, readSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { createConnection } from "net";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type { DeviceSnapshot, DeviceSyncProgress, DeviceWifiConfig } from "../shared/types";
import { hasImportedDeviceSession, importAudio, snapshot, updateMeetingMetadata } from "./library";
import {
  downloadUsbAudio,
  deleteUsbSession,
  getUsbDeviceSnapshot,
  isUsbDeviceUrl,
  markUsbSessionUploaded,
  renameUsbSession,
  setUsbRecording,
  saveUsbWifi,
} from "./usb-device";

let currentBaseUrl = "";
let currentNetworkBaseUrl = "";
const DOWNLOAD_TIMEOUT_MS = 120_000;
const DEVICE_READ_TIMEOUT_MS = 20_000;
const DEVICE_WRITE_TIMEOUT_MS = 30_000;
const WAV_HEADER_BYTES = 44;
type SyncProgressCallback = (progress: DeviceSyncProgress) => void;

function parseDeviceTimestamp(value?: string): Date | null {
  if (!value) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(value);
  const normalized = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}+07:00`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function base(raw: string): string { return raw.trim().replace(/\/+$/, ""); }
function ensureHttpBaseUrl(): string {
  if (/^https?:\/\//i.test(currentBaseUrl)) return currentBaseUrl;
  if (/^https?:\/\//i.test(currentNetworkBaseUrl)) {
    currentBaseUrl = currentNetworkBaseUrl;
    return currentBaseUrl;
  }
  throw new Error("SmartPuck Wi-Fi endpoint is not available. Refresh the device or connect over Wi-Fi before using this action.");
}
async function json(path: string, timeoutMs = DEVICE_READ_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const response = await fetch(`${ensureHttpBaseUrl()}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`SmartPuck returned ${response.status}.`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function deviceFetch(path: string, init: RequestInit = {}, timeoutMs = DEVICE_WRITE_TIMEOUT_MS): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${ensureHttpBaseUrl()}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 503) return response;
      lastError = new Error("SmartPuck storage is busy.");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("SmartPuck request failed.");
}

function makeProgressCounter(
  session: DeviceSnapshot["sessions"][number],
  onProgress?: SyncProgressCallback,
): (receivedBytes: number, totalBytes?: number) => void {
  let lastEmit = 0;
  return (receivedBytes, totalBytes = session.sizeBytes || undefined) => {
    const now = Date.now();
    const percent = totalBytes ? receivedBytes / totalBytes : 0;
    const shouldEmit = now - lastEmit > 250 || receivedBytes >= (totalBytes || Number.MAX_SAFE_INTEGER);
    if (!shouldEmit) return;
    lastEmit = now;
    onProgress?.({
      path: session.path,
      name: session.name,
      phase: "downloading",
      receivedBytes,
      totalBytes,
      message: totalBytes ? `${Math.round(percent * 100)}%` : undefined,
    });
  };
}

function progressTransform(report: (receivedBytes: number, totalBytes?: number) => void, totalBytes?: number): Transform {
  let received = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      report(received, totalBytes);
      callback(null, chunk);
    },
  });
}

function downloadRawHttp(
  baseUrl: string,
  audioPath: string,
  destination: string,
  onBytes?: (receivedBytes: number, totalBytes?: number) => void,
): Promise<void> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const socket = createConnection({ host: url.hostname, port: Number(url.port || 80) });
    let header = Buffer.alloc(0);
    let parsed = false;
    let expected: number | null = null;
    let received = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      output.destroy();
      reject(error);
    };
    const writeBody = (chunk: Buffer): void => {
      if (!chunk.length || settled) return;
      received += chunk.length;
      onBytes?.(received, expected || undefined);
      if (!output.write(chunk)) {
        socket.pause();
        output.once("drain", () => socket.resume());
      }
    };
    socket.setTimeout(DOWNLOAD_TIMEOUT_MS, () => fail(new Error("SmartPuck audio download timed out.")));
    socket.on("connect", () => socket.write(
      `GET /download?path=${encodeURIComponent(audioPath)} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`,
    ));
    socket.on("data", (chunk: Buffer) => {
      if (parsed) return writeBody(chunk);
      header = Buffer.concat([header, chunk]);
      if (header.length > 64 * 1024) return fail(new Error("SmartPuck returned oversized HTTP headers."));
      const end = header.indexOf("\r\n\r\n");
      if (end < 0) return;
      const lines = header.subarray(0, end).toString("latin1").split("\r\n");
      const status = Number(lines[0]?.split(" ")[1]);
      if (!Number.isFinite(status) || status < 200 || status >= 300) return fail(new Error(`SmartPuck returned HTTP ${status || "error"}.`));
      const lengths = lines.slice(1)
        .filter((line) => /^content-length:/i.test(line))
        .map((line) => Number(line.slice(line.indexOf(":") + 1).trim()))
        .filter(Number.isFinite);
      if (lengths.length && lengths.some((length) => length !== lengths[0])) return fail(new Error("SmartPuck returned conflicting content lengths."));
      expected = lengths[0] ?? null;
      parsed = true;
      writeBody(header.subarray(end + 4));
      header = Buffer.alloc(0);
    });
    socket.on("error", fail);
    output.on("error", fail);
    socket.on("end", () => {
      if (settled) return;
      if (!parsed) return fail(new Error("SmartPuck closed the download before sending headers."));
      if (expected !== null && received !== expected) return fail(new Error(`SmartPuck audio download was incomplete (${received}/${expected} bytes).`));
      output.end(() => { if (!settled) { settled = true; resolve(); } });
    });
  });
}

async function downloadAudio(
  audioPath: string,
  destination: string,
  onBytes?: (receivedBytes: number, totalBytes?: number) => void,
): Promise<void> {
  try {
    const response = await fetch(`${ensureHttpBaseUrl()}/download?path=${encodeURIComponent(audioPath)}`, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) throw new Error(`SmartPuck download failed (${response.status}).`);
    const totalBytes = Number(response.headers.get("content-length")) || undefined;
    await pipeline(Readable.fromWeb(response.body as never), progressTransform((received) => onBytes?.(received, totalBytes), totalBytes), createWriteStream(destination));
  } catch {
    rmSync(destination, { force: true });
    await downloadRawHttp(ensureHttpBaseUrl(), audioPath, destination, onBytes);
  }
}

function validateWavFile(path: string, expectedSize?: number): void {
  const size = statSync(path).size;
  if (expectedSize && size !== expectedSize) {
    throw new Error(`SmartPuck audio download was incomplete (${size}/${expectedSize} bytes).`);
  }
  if (size < WAV_HEADER_BYTES) {
    throw new Error("SmartPuck audio download is too small to be a WAV file.");
  }

  const header = Buffer.alloc(WAV_HEADER_BYTES);
  const fd = openSync(path, "r");
  try {
    readSync(fd, header, 0, WAV_HEADER_BYTES, 0);
  } finally {
    closeSync(fd);
  }
  const riff = header.toString("ascii", 0, 4);
  const wave = header.toString("ascii", 8, 12);
  const fmt = header.toString("ascii", 12, 16);
  const data = header.toString("ascii", 36, 40);
  const dataBytes = header.readUInt32LE(40);
  if (riff !== "RIFF" || wave !== "WAVE" || fmt !== "fmt " || data !== "data") {
    throw new Error("SmartPuck downloaded an invalid WAV file. Stop the recording again or reflash the updated firmware before syncing.");
  }
  if (dataBytes === 0 || dataBytes + WAV_HEADER_BYTES > size) {
    throw new Error("SmartPuck downloaded a WAV with an invalid audio length. Stop the recording again or repair it on the device before syncing.");
  }
}

async function downloadValidatedSessionAudio(
  session: DeviceSnapshot["sessions"][number],
  destination: string,
  onProgress?: SyncProgressCallback,
): Promise<void> {
  const report = makeProgressCounter(session, onProgress);
  onProgress?.({ path: session.path, name: session.name, phase: "starting", receivedBytes: 0, totalBytes: session.sizeBytes || undefined });
  if (isUsbDeviceUrl(currentBaseUrl)) await downloadUsbAudio(currentBaseUrl, session.audioPath, destination);
  else await downloadAudio(session.audioPath, destination, report);
  onProgress?.({ path: session.path, name: session.name, phase: "importing", receivedBytes: session.sizeBytes || undefined, totalBytes: session.sizeBytes || undefined });
  validateWavFile(destination, session.sizeBytes || undefined);
}

export async function connectDevice(raw: string): Promise<DeviceSnapshot> {
  currentBaseUrl = base(raw || "http://smartpuck.local");
  if (isUsbDeviceUrl(currentBaseUrl)) {
    const snapshot = await getUsbDeviceSnapshot(currentBaseUrl);
    if (snapshot.ip) currentNetworkBaseUrl = `http://${snapshot.ip}`;
    return snapshot;
  }
  currentNetworkBaseUrl = currentBaseUrl;
  return refreshDevice() as Promise<DeviceSnapshot>;
}

export async function refreshDevice(): Promise<DeviceSnapshot | null> {
  if (!currentBaseUrl) return null;
  if (isUsbDeviceUrl(currentBaseUrl)) {
    if (currentNetworkBaseUrl) {
      const usbUrl = currentBaseUrl;
      currentBaseUrl = currentNetworkBaseUrl;
      const networkSnapshot = await refreshDevice();
      if (networkSnapshot?.connected) return networkSnapshot;
      currentBaseUrl = usbUrl;
    }
    try {
      const snapshot = await getUsbDeviceSnapshot(currentBaseUrl);
      if (snapshot.ip) currentNetworkBaseUrl = `http://${snapshot.ip}`;
      return snapshot;
    } catch (error) {
      return { baseUrl: currentBaseUrl, transport: "usb", connected: false, recording: false, streaming: false, firmwareVersion: "", storageFreeBytes: 0, storageTotalBytes: 0, sessions: [], error: (error as Error).message };
    }
  }
  try {
    // ESP32 WebServer serves one request at a time. Keep discovery sequential so
    // status/session reads do not starve each other or recording controls.
    const status = await json("/status");
    const sessionsData = await json("/sessions").catch(() => ({ sessions: [] }));
    const reportedIp = typeof status.ip === "string" ? status.ip.trim() : "";
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(reportedIp)) currentBaseUrl = `http://${reportedIp}`;
    const sessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];
    const recordedBytes = Math.max(0, Number(status.audioSize) || 0) + Math.max(0, Number(status.recordingQueuedBytes) || 0);
    return {
      baseUrl: currentBaseUrl, connected: true, recording: !!status.recording, streaming: !!status.streaming,
      transport: "wifi",
      recordingDurationSeconds: status.recording ? Math.floor(recordedBytes / 32000) : undefined,
      firmwareVersion: String(status.firmwareVersion || status.version || "unknown"),
      storageFreeBytes: Number(status.storageFreeBytes || status.freeBytes) || 0,
      storageTotalBytes: Number(status.storageTotalBytes || status.totalBytes) || 0,
      network: typeof status.network === "string" ? status.network : undefined,
      ip: typeof status.ip === "string" ? status.ip : undefined,
      storageMode: typeof status.storageMode === "string" ? status.storageMode : undefined,
      sessions: sessions.map((item) => {
        const row = item as Record<string, unknown>;
        return { path: String(row.sessionPath || row.path || ""), audioPath: String(row.audioPath || ""), name: String(row.displayName || row.name || "Recording"), sizeBytes: Number(row.sizeBytes) || 0, durationSeconds: Number(row.durationSeconds) || 0, uploaded: !!row.uploaded, createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined, network: typeof row.network === "string" ? row.network : undefined, ip: typeof row.ip === "string" ? row.ip : undefined, storageMode: typeof row.storageMode === "string" ? row.storageMode : undefined };
      }),
    };
  } catch (error) {
    return { baseUrl: currentBaseUrl, transport: isUsbDeviceUrl(currentBaseUrl) ? "usb" : "wifi", connected: false, recording: false, streaming: false, firmwareVersion: "", storageFreeBytes: 0, storageTotalBytes: 0, sessions: [], error: (error as Error).message };
  }
}

function networkBaseUrl(): string {
  if (currentNetworkBaseUrl) return currentNetworkBaseUrl;
  if (!isUsbDeviceUrl(currentBaseUrl)) return currentBaseUrl;
  throw new Error("SmartPuck Wi-Fi is not reachable. Connect by USB to configure or inspect its network first.");
}

export async function getDeviceWifiConfig(): Promise<DeviceWifiConfig> {
  const response = await fetch(`${networkBaseUrl()}/wifi`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Could not read SmartPuck Wi-Fi settings (${response.status}).`);
  return response.json() as Promise<DeviceWifiConfig>;
}

export async function saveDeviceWifi(ssid: string, password: string): Promise<void> {
  const clean = ssid.trim();
  if (!clean) throw new Error("Wi-Fi name is required.");
  if (isUsbDeviceUrl(currentBaseUrl)) {
    await saveUsbWifi(currentBaseUrl, clean, password);
    return;
  }
  const response = await fetch(`${networkBaseUrl()}/wifi?ssid=${encodeURIComponent(clean)}&password=${encodeURIComponent(password)}`, { method: "POST", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Could not save SmartPuck Wi-Fi (${response.status}).`);
}

export async function removeDeviceWifi(ssid: string): Promise<void> {
  const response = await fetch(`${networkBaseUrl()}/wifi?ssid=${encodeURIComponent(ssid)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Could not remove SmartPuck Wi-Fi (${response.status}).`);
}

export async function setDeviceRecording(action: "start" | "stop"): Promise<DeviceSnapshot> {
  if (isUsbDeviceUrl(currentBaseUrl)) {
    if (currentNetworkBaseUrl) {
      const usbUrl = currentBaseUrl;
      currentBaseUrl = currentNetworkBaseUrl;
      try {
        return await setDeviceRecording(action);
      } catch {
        currentBaseUrl = usbUrl;
      }
    }
    const snapshot = await setUsbRecording(currentBaseUrl, action);
    if (snapshot.ip) currentNetworkBaseUrl = `http://${snapshot.ip}`;
    if (action === "start" && currentNetworkBaseUrl) {
      currentBaseUrl = currentNetworkBaseUrl;
      return refreshDevice() as Promise<DeviceSnapshot>;
    }
    return snapshot;
  }
  const endpoint = action === "start" ? "/start_record" : "/stop_record";
  const response = await deviceFetch(endpoint);
  if (!response.ok) throw new Error(`Could not ${action} recording.`);
  return refreshDevice() as Promise<DeviceSnapshot>;
}

export async function renameDeviceSession(sessionPath: string, name: string): Promise<DeviceSnapshot> {
  const clean = name.trim();
  if (!clean) throw new Error("Recording name is required.");
  if (isUsbDeviceUrl(currentBaseUrl)) await renameUsbSession(currentBaseUrl, sessionPath, clean);
  else {
    const response = await deviceFetch(`/session_rename?path=${encodeURIComponent(sessionPath)}&name=${encodeURIComponent(clean)}`, { method: "POST" });
    if (!response.ok) throw new Error(`Could not rename device recording (${response.status}).`);
  }
  return refreshDevice() as Promise<DeviceSnapshot>;
}

export async function deleteDeviceSession(sessionPath: string): Promise<DeviceSnapshot> {
  const device = await refreshDevice();
  if (!device?.connected) throw new Error(device?.error || "SmartPuck is not connected.");
  const session = device?.sessions.find((item) => item.path === sessionPath);
  if (!session) return device;
  if (isUsbDeviceUrl(currentBaseUrl)) await deleteUsbSession(currentBaseUrl, sessionPath);
  else {
    const force = session.uploaded && hasImportedDeviceSession(sessionPath) ? "" : "&force=1";
    const response = await deviceFetch(`/session?path=${encodeURIComponent(sessionPath)}${force}`, { method: "DELETE" }, 45_000);
    if (!response.ok) throw new Error(`Could not delete device recording (${response.status}).`);
  }
  return refreshDevice() as Promise<DeviceSnapshot>;
}

export async function importDeviceSession(
  sessionPath: string,
  workplaceId?: string,
  options: { onProgress?: SyncProgressCallback } = {},
) {
  const device = await refreshDevice();
  if (!device?.connected) throw new Error(device?.error || "SmartPuck is not connected.");
  const session = device?.sessions.find((item) => item.path === sessionPath);
  if (!session) throw new Error("Recording is no longer available on the SmartPuck.");
  const library = snapshot();
  const existing = [...library.inbox, ...library.workplaces.flatMap((w) => w.meetings)]
    .find((meeting) => meeting.metadata.sourceDevicePath === session.path);
  if (existing?.audioAvailable) {
    if (isUsbDeviceUrl(currentBaseUrl)) {
      await markUsbSessionUploaded(currentBaseUrl, session.path);
      return library;
    }
    const marked = await deviceFetch(`/session_uploaded?path=${encodeURIComponent(session.path)}`, { method: "POST" });
    if (!marked.ok) throw new Error("Recording is safely stored, but the SmartPuck could not mark it as synced.");
    return library;
  }
  if (session.audioPath !== "psram" && !session.audioPath.startsWith("/sessions/")) {
    throw new Error("SmartPuck returned an unsafe audio path.");
  }
  const temp = mkdtempSync(join(tmpdir(), "smartpuck-sync-"));
  const safeName = basename(session.name).replace(/[^a-z0-9._-]+/gi, "-") || "recording";
  const destination = join(temp, `${safeName}.wav`);
  try {
    await downloadValidatedSessionAudio(session, destination, options.onProgress);
    const recorded = parseDeviceTimestamp(session.createdAt);
    if (recorded) {
      const { utimesSync } = await import("fs");
      utimesSync(destination, recorded, recorded);
    }
    if (existing && !existing.audioAvailable) {
      copyFileSync(destination, join(existing.path, existing.metadata.audioFile));
      updateMeetingMetadata(existing.metadata.id, {
        durationSeconds: session.durationSeconds || existing.metadata.durationSeconds,
        status: "queued",
        progressPercent: 0,
        progressStage: "Queued",
        error: undefined,
        sourceDevice: {
          transport: isUsbDeviceUrl(currentBaseUrl) ? "usb" : "wifi",
          firmwareVersion: device.firmwareVersion,
          sessionName: session.name,
          network: session.network || device.network,
          ip: session.ip || device.ip,
        },
      });
      options.onProgress?.({ path: session.path, name: session.name, phase: "queued", receivedBytes: session.sizeBytes, totalBytes: session.sizeBytes });
      if (isUsbDeviceUrl(currentBaseUrl)) await markUsbSessionUploaded(currentBaseUrl, session.path);
      else {
        const marked = await deviceFetch(`/session_uploaded?path=${encodeURIComponent(session.path)}`, { method: "POST" });
        if (!marked.ok) throw new Error("Recording restored, but the SmartPuck could not mark it as synced.");
      }
      options.onProgress?.({ path: session.path, name: session.name, phase: "done", receivedBytes: session.sizeBytes, totalBytes: session.sizeBytes });
      return snapshot();
    }
    const result = importAudio([destination], workplaceId, session.path);
    const imported = [...result.inbox, ...result.workplaces.flatMap((workplace) => workplace.meetings)]
      .find((meeting) => meeting.metadata.sourceDevicePath === session.path);
    if (imported) {
      updateMeetingMetadata(imported.metadata.id, {
        durationSeconds: session.durationSeconds || undefined,
        sourceDevice: {
          transport: isUsbDeviceUrl(currentBaseUrl) ? "usb" : "wifi",
          firmwareVersion: device.firmwareVersion,
          sessionName: session.name,
          network: session.network || device.network,
          ip: session.ip || device.ip,
        },
      });
    }
    if (isUsbDeviceUrl(currentBaseUrl)) await markUsbSessionUploaded(currentBaseUrl, session.path);
    else {
      const marked = await deviceFetch(`/session_uploaded?path=${encodeURIComponent(session.path)}`, { method: "POST" });
      if (!marked.ok) throw new Error("Recording imported, but the SmartPuck could not mark it as synced.");
    }
    options.onProgress?.({ path: session.path, name: session.name, phase: "queued", receivedBytes: session.sizeBytes, totalBytes: session.sizeBytes });
    return result;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export async function prepareDeviceSessionAudio(sessionPath: string): Promise<string> {
  if (!currentBaseUrl) throw new Error("SmartPuck is not connected.");
  if (isUsbDeviceUrl(currentBaseUrl) && currentNetworkBaseUrl) {
    currentBaseUrl = currentNetworkBaseUrl;
  }
  if (sessionPath !== "psram" && !sessionPath.startsWith("/sessions/")) {
    throw new Error("SmartPuck returned an unsafe audio path.");
  }
  const session: DeviceSnapshot["sessions"][number] = {
    path: sessionPath,
    audioPath: sessionPath === "psram" ? "psram" : `${sessionPath}/audio_000.wav`,
    name: basename(sessionPath),
    sizeBytes: 0,
    durationSeconds: 0,
    uploaded: false,
  };
  const temp = mkdtempSync(join(tmpdir(), "smartpuck-preview-"));
  const safeName = basename(session.name).replace(/[^a-z0-9._-]+/gi, "-") || "recording";
  const destination = join(temp, `${safeName}.wav`);
  try {
    await downloadValidatedSessionAudio(session, destination);
    return destination;
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

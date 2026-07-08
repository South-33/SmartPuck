import { writeFile } from "fs/promises";
import { SerialPort } from "serialport";
import type { DeviceSnapshot } from "../shared/types";

const USB_PREFIX = "usb://";
const ESPRESSIF_VENDOR_ID = "303a";
const BAUD_RATE = 921_600;

let usbQueuePromise = Promise.resolve();

async function enqueueUsbOperation<T>(op: () => Promise<T>): Promise<T> {
  const next = usbQueuePromise.then(op);
  usbQueuePromise = next.catch(() => {}).then(() => {});
  return next;
}

interface UsbStatus {
  recording?: boolean;
  streaming?: boolean;
  audioSize?: number;
  recordingQueuedBytes?: number;
  firmwareVersion?: string;
  storageFreeBytes?: number;
  storageTotalBytes?: number;
  network?: string;
  ip?: string;
  storageMode?: string;
}

interface UsbSession {
  sessionPath?: string;
  path?: string;
  audioPath?: string;
  displayName?: string;
  name?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  uploaded?: boolean;
  createdAt?: string;
  network?: string;
  ip?: string;
  storageMode?: string;
}

export function isUsbDeviceUrl(value: string): boolean {
  return value.startsWith(USB_PREFIX);
}

async function resolveUsbPath(value: string): Promise<string> {
  const requested = value.slice(USB_PREFIX.length);
  if (requested && requested !== "auto") return requested;
  const ports = await SerialPort.list();
  const port = ports.find((entry) => entry.vendorId?.toLowerCase() === ESPRESSIF_VENDOR_ID);
  if (!port) throw new Error("No SmartPuck USB device found. Connect its USB-C data cable.");
  return port.path;
}

function requestJson<T>(url: string, command: string, responseType: string): Promise<T> {
  return enqueueUsbOperation(async () => {
    const path = await resolveUsbPath(url);
    return new Promise((resolve, reject) => {
      const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
      let pending = "";
      let settled = false;
      const finish = (error?: Error, value?: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const complete = (): void => error ? reject(error) : resolve(value as T);
        if (port.isOpen) port.close(complete); else complete();
      };
      const timeout = setTimeout(() => finish(new Error("SmartPuck USB connection timed out.")), 5_000);
      port.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          const prefix = `@SPK ${responseType} `;
          if (line.startsWith(prefix)) {
            try { finish(undefined, JSON.parse(line.slice(prefix.length)) as T); }
            catch { finish(new Error("SmartPuck USB returned invalid JSON.")); }
            return;
          }
          if (line.startsWith("@SPK ERROR ")) return finish(new Error(line.slice(11)));
          newline = pending.indexOf("\n");
        }
      });
      port.on("error", (error) => finish(error));
      port.open((error) => {
        if (error) return finish(new Error(`Could not open SmartPuck USB (${path}): ${error.message}`));
        port.write(`@SPK ${command}\n`, (writeError) => {
          if (writeError) finish(new Error(`Could not send SmartPuck USB command: ${writeError.message}`));
        });
      });
    });
  });
}

function requestOk(url: string, command: string): Promise<void> {
  return enqueueUsbOperation(async () => {
    const path = await resolveUsbPath(url);
    return new Promise((resolve, reject) => {
      const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
      let pending = "";
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const complete = (): void => error ? reject(error) : resolve();
        if (port.isOpen) port.close(complete); else complete();
      };
      const timeout = setTimeout(() => finish(new Error("SmartPuck USB connection timed out.")), 5_000);
      port.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        if (pending.includes("@SPK OK")) return finish();
        const match = /@SPK ERROR ([^\r\n]+)/.exec(pending);
        if (match) finish(new Error(match[1]));
      });
      port.on("error", (error) => finish(error));
      port.open((error) => {
        if (error) return finish(new Error(`Could not open SmartPuck USB (${path}): ${error.message}`));
        port.write(`@SPK ${command}\n`, (writeError) => {
          if (writeError) finish(new Error(`Could not send SmartPuck USB command: ${writeError.message}`));
        });
      });
    });
  });
}

export async function getUsbDeviceSnapshot(url: string): Promise<DeviceSnapshot> {
  const status = await requestJson<UsbStatus>(url, "STATUS", "STATUS");
  const payload = await requestJson<{ sessions?: UsbSession[] }>(url, "SESSIONS", "SESSIONS");
  const path = await resolveUsbPath(url);
  const recordedBytes = Math.max(0, Number(status.audioSize) || 0) + Math.max(0, Number(status.recordingQueuedBytes) || 0);
  return {
    baseUrl: `${USB_PREFIX}${path}`,
    transport: "usb",
    connected: true,
    recording: !!status.recording,
    recordingDurationSeconds: status.recording ? Math.floor(recordedBytes / 32000) : undefined,
    streaming: !!status.streaming,
    firmwareVersion: String(status.firmwareVersion || "unknown"),
    storageFreeBytes: Number(status.storageFreeBytes) || 0,
    storageTotalBytes: Number(status.storageTotalBytes) || 0,
    network: status.network,
    ip: status.ip,
    storageMode: status.storageMode,
    sessions: (payload.sessions || []).map((session) => ({
      path: String(session.sessionPath || session.path || ""),
      audioPath: String(session.audioPath || ""),
      name: String(session.displayName || session.name || "Recording"),
      sizeBytes: Number(session.sizeBytes) || 0,
      durationSeconds: Number(session.durationSeconds) || 0,
      uploaded: !!session.uploaded,
      createdAt: session.createdAt,
      network: session.network,
      ip: session.ip,
      storageMode: session.storageMode,
    })),
  };
}

export async function setUsbRecording(url: string, action: "start" | "stop"): Promise<DeviceSnapshot> {
  await requestJson<UsbStatus>(url, action === "start" ? "START" : "STOP", "STATUS");
  return getUsbDeviceSnapshot(url);
}

export async function downloadUsbAudio(url: string, audioPath: string, destination: string): Promise<void> {
  const bytes = await enqueueUsbOperation(async () => {
    const path = await resolveUsbPath(url);
    return new Promise<Buffer>((resolve, reject) => {
      const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
      let header = Buffer.alloc(0);
      let expected: number | null = null;
      const chunks: Buffer[] = [];
      let received = 0;
      let settled = false;
      const finish = (error?: Error, value?: Buffer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const complete = (): void => error ? reject(error) : resolve(value as Buffer);
        if (port.isOpen) port.close(complete); else complete();
      };
      const timeout = setTimeout(() => finish(new Error("SmartPuck USB transfer timed out.")), 120_000);
      port.on("data", (chunk: Buffer) => {
        let data = chunk;
        if (expected === null) {
          header = Buffer.concat([header, data]);
          let newline = header.indexOf(0x0a);
          while (newline >= 0) {
            const line = header.subarray(0, newline).toString("utf8").trim();
            header = header.subarray(newline + 1);
            const match = /^@SPK FILE (\d+)$/.exec(line);
            if (match) { expected = Number(match[1]); data = header; break; }
            if (line.startsWith("@SPK ERROR ")) return finish(new Error(line.slice(11)));
            newline = header.indexOf(0x0a);
          }
          if (expected === null) return;
        }
        const remaining = expected - received;
        const part = data.subarray(0, Math.max(0, remaining));
        if (part.length) { chunks.push(part); received += part.length; }
        if (received === expected) finish(undefined, Buffer.concat(chunks, expected));
      });
      port.on("error", (error) => finish(error));
      port.open((error) => {
        if (error) return finish(new Error(`Could not open SmartPuck USB (${path}): ${error.message}`));
        port.write(`@SPK DOWNLOAD ${audioPath}\n`, (writeError) => {
          if (writeError) finish(new Error(`Could not start SmartPuck USB transfer: ${writeError.message}`));
        });
      });
    });
  });
  await writeFile(destination, bytes);
}

export function markUsbSessionUploaded(url: string, sessionPath: string): Promise<void> {
  return requestOk(url, `UPLOADED ${sessionPath}`);
}

export function renameUsbSession(url: string, sessionPath: string, name: string): Promise<void> {
  if (name.includes("\t") || /[\r\n]/.test(name)) throw new Error("Recording name contains unsupported characters.");
  return requestOk(url, `RENAME ${sessionPath}\t${name}`);
}

export function deleteUsbSession(url: string, sessionPath: string): Promise<void> {
  return requestOk(url, `DELETE ${sessionPath}`);
}

export function saveUsbWifi(url: string, ssid: string, password: string): Promise<void> {
  if (ssid.includes("\t") || /[\r\n]/.test(ssid) || password.includes("\t") || /[\r\n]/.test(password)) {
    throw new Error("Wi-Fi credentials contain unsupported characters.");
  }
  return requestOk(url, `WIFI ${ssid}\t${password}`);
}

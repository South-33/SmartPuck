import { SerialPort } from "serialport";
import { writeFile } from "fs/promises";
import type {
  SmartPuckDeviceSession,
  SmartPuckDeviceSnapshot,
  SmartPuckDeviceStatus,
} from "../shared/smartpuck-library";

const USB_PREFIX = "usb://";
const SMARTPUCK_VENDOR_ID = "303a";
const BAUD_RATE = 921600;

export function isSmartPuckUsbUrl(value: string): boolean {
  return value.startsWith(USB_PREFIX);
}

async function resolveUsbPath(value: string): Promise<string> {
  const requested = value.slice(USB_PREFIX.length);
  if (requested && requested !== "auto") return requested;
  const ports = await SerialPort.list();
  const port = ports.find((entry) => entry.vendorId?.toLowerCase() === SMARTPUCK_VENDOR_ID);
  if (!port) throw new Error("No SmartPuck USB device found. Connect its USB-C data cable.");
  return port.path;
}

async function usbCommand<T>(url: string, command: string, responseType: string): Promise<T> {
  const path = await resolveUsbPath(url);
  return new Promise<T>((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
    let pending = "";
    const timeout = setTimeout(() => finish(new Error("SmartPuck USB connection timed out.")), 3_000);
    const finish = (error?: Error, value?: T) => {
      clearTimeout(timeout);
      port.removeAllListeners();
      const complete = () => {
        if (error) reject(error);
        else resolve(value as T);
      };
      if (port.isOpen) port.close(complete);
      else complete();
    };
    port.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        const prefix = `@SPK ${responseType} `;
        if (line.startsWith(prefix)) {
          try {
            finish(undefined, JSON.parse(line.slice(prefix.length)) as T);
          } catch {
            finish(new Error("SmartPuck USB sent invalid data."));
          }
          return;
        }
        if (line.startsWith("@SPK ERROR ")) {
          finish(new Error(line.slice(11)));
          return;
        }
        newline = pending.indexOf("\n");
      }
    });
    port.open((error) => {
      if (error) return finish(new Error(`Could not open SmartPuck USB (${path}): ${error.message}`));
      port.write(`@SPK ${command}\n`, (writeError) => {
        if (writeError) finish(new Error(`Could not send SmartPuck USB command: ${writeError.message}`));
      });
    });
  });
}

export async function getSmartPuckUsbSnapshot(deviceUrl: string): Promise<SmartPuckDeviceSnapshot> {
  const status = await usbCommand<SmartPuckDeviceStatus>(deviceUrl, "STATUS", "STATUS");
  const sessionPayload = await usbCommand<{ sessions?: SmartPuckDeviceSession[] }>(deviceUrl, "SESSIONS", "SESSIONS");
  const path = await resolveUsbPath(deviceUrl);
  return {
    baseUrl: `${USB_PREFIX}${path}`,
    status: { ...status, network: `${status.network} · USB-C ${path}` },
    sessions: Array.isArray(sessionPayload.sessions) ? sessionPayload.sessions : [],
  };
}

export async function controlSmartPuckUsbRecording(deviceUrl: string, action: "start" | "stop"): Promise<void> {
  await usbCommand<SmartPuckDeviceStatus>(deviceUrl, action === "start" ? "START" : "STOP", "STATUS");
}

async function usbOkCommand(url: string, command: string): Promise<void> {
  const path = await resolveUsbPath(url);
  await new Promise<void>((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
    let pending = "";
    const timeout = setTimeout(() => finish(new Error("SmartPuck USB connection timed out.")), 4_000);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      port.removeAllListeners();
      const complete = () => {
        if (error) reject(error); else resolve();
      };
      if (port.isOpen) port.close(complete);
      else complete();
    };
    port.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      if (pending.includes("@SPK OK")) finish();
      else {
        const error = /@SPK ERROR ([^\r\n]+)/.exec(pending);
        if (error) finish(new Error(error[1]));
      }
    });
    port.open((error) => {
      if (error) return finish(new Error(`Could not open SmartPuck USB (${path}): ${error.message}`));
      port.write(`@SPK ${command}\n`, (writeError) => {
        if (writeError) finish(new Error(`Could not send SmartPuck USB command: ${writeError.message}`));
      });
    });
  });
}

export async function downloadSmartPuckUsbAudio(deviceUrl: string, audioPath: string, destination: string): Promise<void> {
  const path = await resolveUsbPath(deviceUrl);
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
    let header = Buffer.alloc(0);
    let expectedSize: number | null = null;
    let chunks: Buffer[] = [];
    let received = 0;
    const timeout = setTimeout(() => finish(new Error("SmartPuck USB transfer timed out.")), 120_000);
    const finish = (error?: Error, value?: Buffer) => {
      clearTimeout(timeout);
      port.removeAllListeners();
      const complete = () => {
        if (error) reject(error); else resolve(value as Buffer);
      };
      if (port.isOpen) port.close(complete);
      else complete();
    };
    port.on("data", (chunk: Buffer) => {
      let data = chunk;
      if (expectedSize === null) {
        header = Buffer.concat([header, data]);
        let newline = header.indexOf(0x0a);
        while (newline >= 0 && expectedSize === null) {
          const line = header.subarray(0, newline).toString("utf8").trim();
          header = header.subarray(newline + 1);
          const match = /^@SPK FILE (\d+)$/.exec(line);
          if (match) {
            expectedSize = Number(match[1]);
            data = header;
            header = Buffer.alloc(0);
            break;
          }
          if (line.startsWith("@SPK ERROR ")) {
            finish(new Error(line.slice(11)));
            return;
          }
          newline = header.indexOf(0x0a);
        }
        if (expectedSize === null) return;
      }
      if (data.length) {
        const remaining = (expectedSize as number) - received;
        const part = data.subarray(0, Math.max(0, remaining));
        chunks.push(part);
        received += part.length;
      }
      if (received >= (expectedSize as number)) finish(undefined, Buffer.concat(chunks, expectedSize as number));
    });
    port.open((error) => {
      if (error) return finish(new Error(`Could not open SmartPuck USB (${path}): ${error.message}`));
      port.write(`@SPK DOWNLOAD ${audioPath}\n`, (writeError) => {
        if (writeError) finish(new Error(`Could not start SmartPuck USB transfer: ${writeError.message}`));
      });
    });
  });
  await writeFile(destination, bytes);
}

export function markSmartPuckUsbSessionUploaded(deviceUrl: string, sessionPath: string): Promise<void> {
  return usbOkCommand(deviceUrl, `UPLOADED ${sessionPath}`);
}

export function deleteSmartPuckUsbSession(deviceUrl: string, sessionPath: string): Promise<void> {
  return usbOkCommand(deviceUrl, `DELETE ${sessionPath}`);
}

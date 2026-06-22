import { createWriteStream, mkdtempSync, rmSync } from "fs";
import { createConnection } from "net";
import { tmpdir } from "os";
import { extname, join } from "path";
import type {
  SmartPuckDeviceSession,
  SmartPuckDeviceSnapshot,
  SmartPuckDeviceStatus,
  SmartPuckImportResult,
} from "../shared/smartpuck-library";
import { importSmartPuckAudioFiles } from "./smartpuck-library";
import {
  controlSmartPuckUsbRecording,
  deleteSmartPuckUsbSession,
  downloadSmartPuckUsbAudio,
  getSmartPuckUsbSnapshot,
  isSmartPuckUsbUrl,
  markSmartPuckUsbSessionUploaded,
} from "./smartpuck-usb";

const REQUEST_TIMEOUT_MS = 12_000;
const DISCOVERY_TIMEOUT_MS = 3_000;

function normalizeDeviceUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Enter a SmartPuck device URL.");
  const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  if (url.protocol !== "http:") {
    throw new Error("SmartPuck device URLs must use HTTP.");
  }
  if (url.username || url.password) {
    throw new Error("SmartPuck device URLs cannot include credentials.");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function deviceFetch(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`SmartPuck returned HTTP ${response.status}.`);
    }
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("SmartPuck connection timed out.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getSmartPuckDeviceSnapshot(
  deviceUrl: string,
): Promise<SmartPuckDeviceSnapshot> {
  if (isSmartPuckUsbUrl(deviceUrl)) {
    return getSmartPuckUsbSnapshot(deviceUrl);
  }
  const baseUrl = normalizeDeviceUrl(deviceUrl);
  // ESP32 WebServer processes one client at a time. Parallel discovery requests
  // race each other and can starve control endpoints such as /start_record.
  const statusResponse = await deviceFetch(
    baseUrl,
    "/status",
    undefined,
    DISCOVERY_TIMEOUT_MS,
  );
  const sessionsResponse = await deviceFetch(
    baseUrl,
    "/sessions",
    undefined,
    DISCOVERY_TIMEOUT_MS,
  );
  const status = (await statusResponse.json()) as SmartPuckDeviceStatus;
  const sessionPayload = (await sessionsResponse.json()) as {
    sessions?: SmartPuckDeviceSession[];
  };
  const reportedIp = typeof status.ip === "string" ? status.ip.trim() : "";
  const stableBaseUrl = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(reportedIp)
    ? `http://${reportedIp}`
    : baseUrl;
  return {
    baseUrl: stableBaseUrl,
    status,
    sessions: Array.isArray(sessionPayload.sessions)
      ? sessionPayload.sessions
      : [],
  };
}

export async function controlSmartPuckRecording(
  deviceUrl: string,
  action: "start" | "stop",
): Promise<void> {
  if (isSmartPuckUsbUrl(deviceUrl)) {
    await controlSmartPuckUsbRecording(deviceUrl, action);
    return;
  }
  const baseUrl = normalizeDeviceUrl(deviceUrl);
  await deviceFetch(baseUrl, action === "start" ? "/start_record" : "/stop_record");
}

function safeSessionFileName(session: SmartPuckDeviceSession): string {
  const source =
    session.name.trim() || session.displayName?.trim() || "meeting";
  const safe = source
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  const extension = extname(session.audioPath) || ".wav";
  return `${safe || "meeting"}${extension}`;
}

function downloadDeviceAudio(
  baseUrl: string,
  audioPath: string,
  destination: string,
): Promise<void> {
  const url = new URL(baseUrl);
  const requestPath = `/download?path=${encodeURIComponent(audioPath)}`;

  return new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const socket = createConnection({
      host: url.hostname,
      port: Number(url.port || 80),
    });
    let headerBuffer = Buffer.alloc(0);
    let headersParsed = false;
    let expectedBytes: number | null = null;
    let receivedBytes = 0;
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
      receivedBytes += chunk.length;
      if (!output.write(chunk)) {
        socket.pause();
        output.once("drain", () => socket.resume());
      }
    };

    socket.setTimeout(REQUEST_TIMEOUT_MS, () =>
      fail(new Error("SmartPuck audio download timed out.")),
    );
    socket.on("connect", () => {
      socket.write(
        `GET ${requestPath} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on("data", (chunk: Buffer) => {
      if (headersParsed) {
        writeBody(chunk);
        return;
      }
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      if (headerBuffer.length > 64 * 1024) {
        fail(new Error("SmartPuck returned oversized HTTP headers."));
        return;
      }
      const headerEnd = headerBuffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;

      const headerText = headerBuffer.subarray(0, headerEnd).toString("latin1");
      const lines = headerText.split("\r\n");
      const status = Number(lines[0]?.split(" ")[1]);
      if (!Number.isFinite(status) || status < 200 || status >= 300) {
        fail(new Error(`SmartPuck returned HTTP ${status || "error"}.`));
        return;
      }
      const lengths = lines
        .slice(1)
        .filter((line) => /^content-length:/i.test(line))
        .map((line) => Number(line.slice(line.indexOf(":") + 1).trim()))
        .filter(Number.isFinite);
      if (lengths.length && lengths.some((value) => value !== lengths[0])) {
        fail(new Error("SmartPuck returned conflicting content lengths."));
        return;
      }
      expectedBytes = lengths[0] ?? null;
      headersParsed = true;
      writeBody(headerBuffer.subarray(headerEnd + 4));
      headerBuffer = Buffer.alloc(0);
    });
    socket.on("error", fail);
    output.on("error", fail);
    socket.on("end", () => {
      if (settled) return;
      if (!headersParsed) {
        fail(
          new Error("SmartPuck closed the download before sending headers."),
        );
        return;
      }
      if (expectedBytes !== null && receivedBytes !== expectedBytes) {
        fail(
          new Error(
            `SmartPuck audio download was incomplete (${receivedBytes}/${expectedBytes} bytes).`,
          ),
        );
        return;
      }
      output.end(() => {
        if (settled) return;
        settled = true;
        resolve();
      });
    });
  });
}

export async function importSmartPuckDeviceSession(
  folderId: string | null,
  deviceUrl: string,
  session: SmartPuckDeviceSession,
): Promise<SmartPuckImportResult> {
  if (isSmartPuckUsbUrl(deviceUrl)) {
    const tempRoot = mkdtempSync(join(tmpdir(), "smartpuck-device-"));
    try {
      const tempAudioPath = join(tempRoot, safeSessionFileName(session));
      await downloadSmartPuckUsbAudio(deviceUrl, session.audioPath, tempAudioPath);
      const result = importSmartPuckAudioFiles(folderId, [tempAudioPath]);
      await markSmartPuckUsbSessionUploaded(deviceUrl, session.sessionPath);
      return result;
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
  const baseUrl = normalizeDeviceUrl(deviceUrl);
  if (
    session.audioPath !== "psram" &&
    !session.audioPath.startsWith("/sessions/")
  ) {
    throw new Error("SmartPuck returned an invalid audio path.");
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "smartpuck-device-"));
  try {
    const tempAudioPath = join(tempRoot, safeSessionFileName(session));
    await downloadDeviceAudio(baseUrl, session.audioPath, tempAudioPath);
    const result = importSmartPuckAudioFiles(folderId, [tempAudioPath]);
    await deviceFetch(
      baseUrl,
      `/session_uploaded?path=${encodeURIComponent(session.sessionPath)}`,
      { method: "POST" },
    );
    return result;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function deleteSmartPuckDeviceSession(
  deviceUrl: string,
  sessionPath: string,
): Promise<void> {
  if (isSmartPuckUsbUrl(deviceUrl)) {
    await deleteSmartPuckUsbSession(deviceUrl, sessionPath);
    return;
  }
  const baseUrl = normalizeDeviceUrl(deviceUrl);
  await deviceFetch(
    baseUrl,
    `/session?path=${encodeURIComponent(sessionPath)}&force=1`,
    { method: "DELETE" },
  );
}

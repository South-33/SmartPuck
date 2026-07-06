import { createServer, type Server } from "http";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(join(tmpdir(), "smartpuck-device-test-"));
vi.mock("electron", () => ({ app: { getPath: () => root } }));

let server: Server;
let baseUrl = "";
let activeDiscoveryRequests = 0;
let discoveryOverlap = false;
let uploadedMarks = 0;
let device: typeof import("../src/main/device");
let library: typeof import("../src/main/library");

function tinyWav(): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(40, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(4, 40);
  return Buffer.concat([header, Buffer.alloc(4)]);
}

beforeAll(async () => {
  process.env.SMARTPUCK_HOME = root;
  server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/status" || url.pathname === "/sessions") {
      activeDiscoveryRequests += 1;
      if (activeDiscoveryRequests > 1) discoveryOverlap = true;
      setTimeout(() => {
        response.setHeader("content-type", "application/json");
        if (url.pathname === "/status") {
          response.end(JSON.stringify({ recording: false, firmwareVersion: "test", storageFreeBytes: 10, storageTotalBytes: 20 }));
        } else {
          response.end(JSON.stringify({ sessions: [{ sessionPath: "/sessions/session_001", audioPath: "/sessions/session_001/audio_000.wav", displayName: "Meeting", sizeBytes: 48, durationSeconds: 1, uploaded: false, createdAt: "20260630_101500" }] }));
        }
        activeDiscoveryRequests -= 1;
      }, 15);
      return;
    }
    if (url.pathname === "/download") {
      response.setHeader("content-length", "48");
      response.end(tinyWav());
      return;
    }
    if (url.pathname === "/session_uploaded") {
      uploadedMarks += 1;
      response.end('{"ok":true}');
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
  device = await import("../src/main/device");
  library = await import("../src/main/library");
});

afterAll(async () => {
  delete process.env.SMARTPUCK_HOME;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(root, { recursive: true, force: true });
});

describe("SmartPuck device synchronization", () => {
  it("discovers sequentially and retries acknowledgement without duplicate imports", async () => {
    const snapshot = await device.connectDevice(baseUrl);
    expect(snapshot.connected).toBe(true);
    expect(discoveryOverlap).toBe(false);

    await device.importDeviceSession("/sessions/session_001");
    await device.importDeviceSession("/sessions/session_001");

    const state = library.snapshot();
    expect(state.inbox).toHaveLength(1);
    expect(state.inbox[0].metadata.sourceDevicePath).toBe("/sessions/session_001");
    expect(state.inbox[0].metadata.capturedAt).toBe("2026-06-30T03:15:00.000Z");
    expect(uploadedMarks).toBe(2);
  });
});

export type SmartPuckStatus = {
  recording?: boolean;
  streaming?: boolean;
  audioSize?: number;
  network?: string;
  networkMode?: "ap" | "station" | string;
  ip?: string;
  savedWifiCount?: number;
  storage?: string;
  storageReady?: boolean;
  storageMode?: "microsd" | "psram" | "none" | string;
  storageFreeBytes?: number;
  storageTotalBytes?: number;
  batteryPercent?: number | null;
  batteryCharging?: boolean | null;
  firmwareVersion?: string;
  lastError?: string;
};

export type SmartPuckWifiNetwork = {
  ssid: string;
  active: boolean;
};

export type SmartPuckWifiConfig = {
  mode: "ap" | "station" | string;
  network: string;
  ip: string;
  activeSsid: string;
  maxNetworks: number;
  networks: SmartPuckWifiNetwork[];
};

export type SmartPuckSession = {
  sessionPath: string;
  audioPath: string;
  name: string;
  displayName?: string;
  createdAt?: string;
  network?: string;
  ip?: string;
  sizeBytes: number;
  durationSeconds: number;
  uploaded: boolean;
  storageMode: "microsd" | "psram" | string;
};

export type TranscriptionResult = {
  full_text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
};

export function normalizePuckBaseUrl(address: string, fallback: string) {
  const trimmed = address.trim();
  if (!trimmed) {
    return fallback;
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function getSessionImportKey(baseUrl: string, sessionPath: string) {
  return `smartpuck:uploaded-session:${getDeviceSessionKey(baseUrl, sessionPath)}`;
}

export function getDeviceSessionKey(baseUrl: string, sessionPath: string) {
  return `${baseUrl.replace(/\/+$/, "")}:${sessionPath}`;
}

export function normalizeSmartPuckSessions(payload: unknown): SmartPuckSession[] {
  if (!payload || typeof payload !== "object" || !("sessions" in payload)) {
    return [];
  }

  const sessions = (payload as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions.flatMap((session) => {
    if (!session || typeof session !== "object") {
      return [];
    }

    const candidate = session as Record<string, unknown>;
    if (
      typeof candidate.sessionPath !== "string" ||
      typeof candidate.audioPath !== "string" ||
      typeof candidate.name !== "string"
    ) {
      return [];
    }

    return [
      {
        sessionPath: candidate.sessionPath,
        audioPath: candidate.audioPath,
        name: candidate.name,
        displayName: typeof candidate.displayName === "string" ? candidate.displayName : undefined,
        createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : undefined,
        network: typeof candidate.network === "string" ? candidate.network : undefined,
        ip: typeof candidate.ip === "string" ? candidate.ip : undefined,
        sizeBytes: typeof candidate.sizeBytes === "number" ? candidate.sizeBytes : 0,
        durationSeconds: typeof candidate.durationSeconds === "number" ? candidate.durationSeconds : 0,
        uploaded: candidate.uploaded === true,
        storageMode: typeof candidate.storageMode === "string" ? candidate.storageMode : "unknown",
      },
    ];
  });
}

export function formatTranscriptionText(transcription: TranscriptionResult) {
  const segments = Array.isArray(transcription.segments) ? transcription.segments : [];
  if (segments.length > 0) {
    return segments
      .map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text.trim()}`)
      .join("\n");
  }

  return transcription.full_text?.trim() || "No transcript text returned.";
}

export function getTranscriptionDurationMinutes(transcription: TranscriptionResult) {
  const segments = Array.isArray(transcription.segments) ? transcription.segments : [];
  if (segments.length === 0) {
    return 0;
  }

  return Math.max(0, segments[segments.length - 1].end / 60);
}

export async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("SmartPuck did not answer in time. Check the IP address and Wi-Fi network.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function normalizeSmartPuckWifiConfig(payload: unknown): SmartPuckWifiConfig {
  if (!payload || typeof payload !== "object") {
    return {
      mode: "unknown",
      network: "Unknown",
      ip: "",
      activeSsid: "",
      maxNetworks: 0,
      networks: [],
    };
  }

  const candidate = payload as Record<string, unknown>;
  const networks = Array.isArray(candidate.networks)
    ? candidate.networks.flatMap((network) => {
        if (!network || typeof network !== "object") {
          return [];
        }
        const item = network as Record<string, unknown>;
        if (typeof item.ssid !== "string") {
          return [];
        }
        return [{ ssid: item.ssid, active: item.active === true }];
      })
    : [];

  return {
    mode: typeof candidate.mode === "string" ? candidate.mode : "unknown",
    network: typeof candidate.network === "string" ? candidate.network : "Unknown",
    ip: typeof candidate.ip === "string" ? candidate.ip : "",
    activeSsid: typeof candidate.activeSsid === "string" ? candidate.activeSsid : "",
    maxNetworks: typeof candidate.maxNetworks === "number" ? candidate.maxNetworks : 0,
    networks,
  };
}

export async function fetchPuckWifiConfig(baseUrl: string) {
  const response = await fetchWithTimeout(`${baseUrl}/wifi`, 5000);
  if (!response.ok) {
    throw new Error(`SmartPuck could not load Wi-Fi settings (${response.status}).`);
  }
  return normalizeSmartPuckWifiConfig(await response.json());
}

export async function savePuckWifiNetwork(baseUrl: string, ssid: string, password: string) {
  const body = new URLSearchParams({ ssid, password });
  const response = await fetchWithTimeout(`${baseUrl}/wifi`, 7000, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function deletePuckWifiNetwork(baseUrl: string, ssid: string) {
  const response = await fetchWithTimeout(`${baseUrl}/wifi?ssid=${encodeURIComponent(ssid)}`, 5000, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function deletePuckSession(baseUrl: string, sessionPath: string, force = false) {
  const response = await fetchWithTimeout(
    `${baseUrl}/session?path=${encodeURIComponent(sessionPath)}${force ? "&force=1" : ""}`,
    7000,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function downloadPuckSessionBlob({
  baseUrl,
  session,
  onProgress,
}: {
  baseUrl: string;
  session: SmartPuckSession;
  onProgress: (downloadedBytes: number, totalBytes: number) => void;
}) {
  const chunks: Uint8Array[] = [];
  const expectedBytes = Math.max(session.sizeBytes, 0);
  let downloadedBytes = 0;
  let attempts = 0;
  const maxAttempts = 5;
  const downloadUrl = `${baseUrl}/download?path=${encodeURIComponent(session.audioPath)}`;

  while (downloadedBytes < expectedBytes || (expectedBytes === 0 && attempts === 0)) {
    attempts += 1;
    if (attempts > maxAttempts) {
      throw new Error("SmartPuck transfer kept dropping. Move closer to the device and try again.");
    }

    try {
      const response = await fetchWithTimeout(downloadUrl, 120000, {
        headers: downloadedBytes > 0 ? { Range: `bytes=${downloadedBytes}-` } : undefined,
      });

      if (downloadedBytes > 0 && response.status !== 206) {
        throw new Error("SmartPuck did not resume the transfer.");
      }
      if (!response.ok && response.status !== 206) {
        throw new Error(`SmartPuck could not download this recording (${response.status}).`);
      }

      if (!response.body) {
        const fallback = new Uint8Array(await response.arrayBuffer());
        chunks.push(fallback);
        downloadedBytes += fallback.byteLength;
        onProgress(downloadedBytes, expectedBytes || downloadedBytes);
        break;
      }

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
        downloadedBytes += value.byteLength;
        onProgress(downloadedBytes, expectedBytes || downloadedBytes);
      }
    } catch (error) {
      if (attempts >= maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 700 * attempts));
    }
  }

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([merged], { type: "audio/wav" });
}

function formatTimestamp(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

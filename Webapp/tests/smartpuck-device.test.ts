import {
  downloadPuckSessionBlob,
  formatTranscriptionText,
  getTranscriptionDurationMinutes,
  normalizeSmartPuckWifiConfig,
  normalizePuckBaseUrl,
  normalizeSmartPuckSessions,
} from "@/lib/smartpuck-device";

describe("SmartPuck device helpers", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("normalizes local puck addresses", () => {
    expect(normalizePuckBaseUrl("192.168.4.1/", "http://fallback")).toBe("http://192.168.4.1");
    expect(normalizePuckBaseUrl(" https://smartpuck.local/ ", "http://fallback")).toBe("https://smartpuck.local");
    expect(normalizePuckBaseUrl(" ", "http://fallback")).toBe("http://fallback");
  });

  test("sanitizes malformed sessions payloads", () => {
    expect(normalizeSmartPuckSessions({ sessions: [{ sessionPath: 1 }] })).toEqual([]);
    expect(
      normalizeSmartPuckSessions({
        sessions: [
          {
            sessionPath: "/sessions/session_001",
            audioPath: "/sessions/session_001/audio_000.wav",
            name: "session_001",
            sizeBytes: 32044,
            durationSeconds: 1,
            uploaded: true,
            storageMode: "microsd",
          },
        ],
      }),
    ).toEqual([
      {
        sessionPath: "/sessions/session_001",
        audioPath: "/sessions/session_001/audio_000.wav",
        name: "session_001",
        sizeBytes: 32044,
        durationSeconds: 1,
        uploaded: true,
        storageMode: "microsd",
      },
    ]);
  });

  test("normalizes SmartPuck Wi-Fi config without exposing passwords", () => {
    expect(
      normalizeSmartPuckWifiConfig({
        mode: "station",
        network: "Wi-Fi: Studio",
        ip: "192.168.3.22",
        activeSsid: "Studio",
        maxNetworks: 5,
        networks: [
          { ssid: "Studio", active: true, password: "secret" },
          { ssid: 42, active: true },
          { ssid: "Phone", active: false },
        ],
      }),
    ).toEqual({
      mode: "station",
      network: "Wi-Fi: Studio",
      ip: "192.168.3.22",
      activeSsid: "Studio",
      maxNetworks: 5,
      networks: [
        { ssid: "Studio", active: true },
        { ssid: "Phone", active: false },
      ],
    });
  });

  test("formats segment and text-only transcription responses", () => {
    expect(
      formatTranscriptionText({
        segments: [{ start: 65.4, end: 70, text: " Ship the demo. " }],
      }),
    ).toBe("[01:05] Ship the demo.");
    expect(formatTranscriptionText({ full_text: "  Plain transcript  " })).toBe("Plain transcript");
    expect(getTranscriptionDurationMinutes({ segments: [{ start: 0, end: 120, text: "Done" }] })).toBe(2);
  });

  test("resumes SmartPuck downloads with Range after an interrupted first response", async () => {
    const calls: Array<HeadersInit | undefined> = [];
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init?.headers);
      const chunk = chunks.shift() ?? new Uint8Array();
      return new Response(chunk, { status: calls.length === 1 ? 200 : 206 });
    });

    const progress: number[] = [];
    const blob = await downloadPuckSessionBlob({
      baseUrl: "http://192.168.4.1",
      session: {
        sessionPath: "/sessions/session_001",
        audioPath: "/sessions/session_001/audio_000.wav",
        name: "session_001",
        sizeBytes: 4,
        durationSeconds: 0,
        uploaded: false,
        storageMode: "microsd",
      },
      onProgress: (downloadedBytes) => progress.push(downloadedBytes),
    });

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(progress).toEqual([2, 4]);
    expect(calls[1]).toEqual({ Range: "bytes=2-" });
  });
});

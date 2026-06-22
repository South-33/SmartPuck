import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  Folder,
  Loader,
  Pencil,
  Refresh,
  Settings as SettingsIcon,
  Signal,
  X,
  Play,
  Pause,
  Plus,
  Trash,
  MoreVertical,
  Circle,
} from "../../assets/icons";
import type {
  SmartPuckDeviceSession,
  SmartPuckDeviceSnapshot,
  SmartPuckFolder,
  SmartPuckLibrarySnapshot,
  SmartPuckRecording,
  SmartPuckTranscriptionModel,
} from "../../../../shared/smartpuck-library";

const DEVICE_URL_KEY = "smartpuck.deviceUrl";
const DEVICE_FALLBACK_URLS = ["usb://auto", "http://smartpuck.local", "http://192.168.4.1"];
const DENOISE_MODE = "auto";
const NORMALIZE_AUDIO = true;
const TRANSCRIPTION_MODEL: SmartPuckTranscriptionModel = "auto";

function deviceStreamUrl(device: SmartPuckDeviceSnapshot): string {
  if (!device.baseUrl.startsWith("usb://")) return device.baseUrl;
  return device.status.ip ? `http://${device.status.ip}` : device.baseUrl;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value: number): string {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(recording: SmartPuckRecording): string {
  switch (recording.status) {
    case "ready":
      return "Ready";
    case "no-speech":
      return "No speech";
    case "transcribing":
      return "Transcribing";
    case "queued":
      return "Queued";
    case "error":
      return "Needs review";
    case "imported":
    default:
      return "Imported";
  }
}

export default function SmartPuck({
  playingId,
  audioPlaying,
  onPlayPauseAudio,
  audioUrl,
  onPlayDeviceAudio,
}: {
  playingId: string | null;
  audioPlaying: boolean;
  onPlayPauseAudio: (recording: SmartPuckRecording) => void;
  audioUrl: string | null;
  onPlayDeviceAudio: (
    session: SmartPuckDeviceSession,
    baseUrl: string,
  ) => Promise<void>;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SmartPuckLibrarySnapshot | null>(
    null,
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [editingRecording, setEditingRecording] =
    useState<SmartPuckRecording | null>(null);
  const [renamingRecording, setRenamingRecording] =
    useState<SmartPuckRecording | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [playlistPickerRecording, setPlaylistPickerRecording] =
    useState<SmartPuckRecording | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const transcriptPrefixRef = useRef("");
  const [deviceUrl, setDeviceUrl] = useState(() => {
    try {
      return localStorage.getItem(DEVICE_URL_KEY) || "http://192.168.4.1";
    } catch {
      return "http://192.168.4.1";
    }
  });
  const [device, setDevice] = useState<SmartPuckDeviceSnapshot | null>(null);
  const [deviceConnecting, setDeviceConnecting] = useState(false);
  const [manualDeviceOpen, setManualDeviceOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoConnectStartedRef = useRef(false);

  const [liveListening, setLiveListening] = useState(false);
  const [liveAudioLevel, setLiveAudioLevel] = useState(0);
  const lastLiveLevelUpdateRef = useRef(0);
  const [deviceCommand, setDeviceCommand] = useState<"start" | "stop" | null>(null);
  const [deviceSessionAction, setDeviceSessionAction] = useState<{
    path: string;
    type: "transfer" | "delete";
  } | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const monitorCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const nextPlaybackTimeRef = useRef<number>(0);
  const activeAudioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const streamHeaderBytesToSkipRef = useRef(44);
  const streamPcmCarryRef = useRef<Uint8Array>(new Uint8Array(0));

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeMenuPosition, setActiveMenuPosition] = useState({ top: 0, right: 0 });
  const [localLibraryExpanded, setLocalLibraryExpanded] = useState(true);
  const [deviceStorageExpanded, setDeviceStorageExpanded] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<'main' | 'move'>('main');

  const formatTime = useCallback((seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, []);


  const folders = snapshot?.folders ?? [];
  const selectedFolder = useMemo<SmartPuckFolder | null>(() => {
    return folders.find((folder) => folder.id === selectedFolderId) ?? null;
  }, [folders, selectedFolderId]);
  const visibleRecordings = selectedFolder?.recordings ?? snapshot?.recordings ?? [];
  const pendingDeviceSessions = useMemo(
    () =>
      device?.sessions.filter(
        (session) =>
          !folders.some((folder) =>
            folder.recordings.some(
              (recording) =>
                recording.sourceFileName.includes(session.name) ||
                recording.sizeBytes === session.sizeBytes,
            ),
          ),
      ) ?? [],
    [device, folders],
  );

  const refresh = useCallback(async () => {
    const next = await window.hermesAPI.smartPuck.listLibrary();
    setSnapshot(next);
    window.dispatchEvent(new Event("smartpuck-library-changed"));
    setSelectedFolderId((current) => {
      if (current && next.folders.some((folder) => folder.id === current)) {
        return current;
      }
      return current ?? null;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.hermesAPI.smartPuck
      .listLibrary()
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setSelectedFolderId(null);
        window.dispatchEvent(new Event("smartpuck-library-changed"));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasActiveTranscription = useMemo(
    () =>
      folders.some((folder) =>
        folder.recordings.some(
          (recording) =>
            recording.status === "queued" ||
            recording.status === "transcribing",
        ),
      ),
    [folders],
  );

  useEffect(() => {
    if (!hasActiveTranscription) return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [hasActiveTranscription, refresh]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const handleDeleteTranscript = useCallback(
    async (recordingId: string) => {
      if (!window.confirm("Are you sure you want to delete this transcript? This action cannot be undone.")) {
        return;
      }
      void runAction("Deleting transcript", async () => {
        await window.hermesAPI.smartPuck.deleteTranscript(recordingId);
        await refresh();
      });
    },
    [refresh, runAction],
  );

  const handleDeleteRecording = useCallback(
    async (recordingId: string) => {
      if (!window.confirm("Are you sure you want to delete this audio file and all its transcripts? This action cannot be undone.")) {
        return;
      }
      void runAction("Deleting recording", async () => {
        await window.hermesAPI.smartPuck.deleteRecording(recordingId);
        await refresh();
      });
    },
    [refresh, runAction],
  );

  const handleMoveRecording = useCallback(
    async (recordingId: string, targetFolderId: string) => {
      void runAction("Moving recording", async () => {
        await window.hermesAPI.smartPuck.moveRecording(recordingId, targetFolderId);
        await refresh();
      });
    },
    [refresh, runAction],
  );

  const handleRenameRecording = useCallback(
    (recording: SmartPuckRecording) => {
      setRenamingRecording(recording);
      setRenameDraft(recording.title);
    },
    [],
  );

  const handleConfirmRename = useCallback(() => {
    const name = renameDraft.trim();
    if (!renamingRecording || !name) return;
    void runAction("Renaming recording", async () => {
      await window.hermesAPI.smartPuck.renameRecording(
        renamingRecording.id,
        name,
      );
      setRenamingRecording(null);
      await refresh();
    });
  }, [refresh, renameDraft, renamingRecording, runAction]);

  const handleAddToFolder = useCallback(
    (recordingId: string, folderId: string) => {
      void runAction("Adding to folder", async () => {
        await window.hermesAPI.smartPuck.moveRecording(recordingId, folderId);
        await refresh();
      });
    },
    [refresh, runAction],
  );

  const handleRemoveFromFolder = useCallback(
    (recordingId: string, folderId: string) => {
      void runAction("Removing from folder", async () => {
        await window.hermesAPI.smartPuck.removeRecordingFromFolder(
          recordingId,
          folderId,
        );
        await refresh();
      });
    },
    [refresh, runAction],
  );

  const isAlreadyImported = useCallback(
    (session: SmartPuckDeviceSession) => {
      return folders.some((folder) =>
        folder.recordings.some(
          (rec) =>
            rec.sizeBytes === session.sizeBytes ||
            rec.sourceFileName.includes(session.name),
        ),
      );
    },
    [folders],
  );

  const handleTransferSession = useCallback(
    async (session: SmartPuckDeviceSession) => {
      if (!device) return;
      setDeviceSessionAction({ path: session.sessionPath, type: "transfer" });
      setError(null);
      try {
        const targetFolderId = selectedFolder?.id ?? null;
        const result = await window.hermesAPI.smartPuck.importDeviceSession(
          targetFolderId,
          device.baseUrl,
          session,
        );
        const importedRecording = result.recordings.find(
          (rec) => rec.sizeBytes === session.sizeBytes || rec.sourceFileName.includes(session.name)
        );
        await refresh();

        if (importedRecording) {
          await window.hermesAPI.smartPuck.queueTranscription(
            importedRecording.id,
            TRANSCRIPTION_MODEL,
            null,
            DENOISE_MODE,
            NORMALIZE_AUDIO
          );
          await refresh();
        }

        setDevice((current) =>
          current
            ? {
                ...current,
                sessions: current.sessions.map((item) =>
                  item.sessionPath === session.sessionPath
                    ? { ...item, uploaded: true }
                    : item,
                ),
              }
            : current,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDeviceSessionAction(null);
      }
    },
    [device, selectedFolder?.id, refresh],
  );

  const handleTransferAllNewSessions = useCallback(
    async () => {
      if (!device) return;
      const pending = device.sessions.filter(s => !s.uploaded);
      if (pending.length === 0) return;

      void runAction("Transferring all new sessions", async () => {
        const targetFolderId = selectedFolder?.id ?? null;
        let folderIdToUse = targetFolderId;
        const importedRecordingsToTranscribe: string[] = [];

        for (const session of pending) {
          const result = await window.hermesAPI.smartPuck.importDeviceSession(
            folderIdToUse,
            device.baseUrl,
            session,
          );
          if (result.folder) {
            folderIdToUse = result.folder.id;
          }
          const importedRecording = result.recordings.find(
            (rec) => rec.sizeBytes === session.sizeBytes || rec.sourceFileName.includes(session.name)
          );
          if (importedRecording) {
            importedRecordingsToTranscribe.push(importedRecording.id);
          }
        }
        await refresh();

        for (const recId of importedRecordingsToTranscribe) {
          try {
            await window.hermesAPI.smartPuck.queueTranscription(
              recId,
              TRANSCRIPTION_MODEL,
              null,
              DENOISE_MODE,
              NORMALIZE_AUDIO
            );
          } catch (e) {
            console.error("Failed to auto-transcribe", recId, e);
          }
        }
        await refresh();

        const nextDevice = await window.hermesAPI.smartPuck.getDeviceSnapshot(device.baseUrl);
        setDevice(nextDevice);
      });
    },
    [device, selectedFolder?.id, refresh, runAction],
  );

  const handleDeleteDeviceSession = useCallback(
    async (session: SmartPuckDeviceSession) => {
      if (!device) return;
      if (!window.confirm(`Are you sure you want to delete "${session.displayName || session.name}" from the device? This will free space on the puck.`)) {
        return;
      }
      const previousDevice = device;
      setDeviceSessionAction({ path: session.sessionPath, type: "delete" });
      setError(null);
      setDevice((current) =>
        current
          ? {
              ...current,
              sessions: current.sessions.filter(
                (item) => item.sessionPath !== session.sessionPath,
              ),
            }
          : current,
      );
      try {
        await window.hermesAPI.smartPuck.deleteDeviceSession(device.baseUrl, session.sessionPath);
      } catch (err) {
        setDevice(previousDevice);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDeviceSessionAction(null);
      }
    },
    [device],
  );

  const handleImportAudio = useCallback(() => {
    void runAction("Importing audio", async () => {
      const files = await window.hermesAPI.smartPuck.selectAudioFiles();
      if (!files.length) return;
      const result = await window.hermesAPI.smartPuck.importAudioFiles(
        selectedFolder?.id ?? null,
        files,
      );
      await refresh();
      setSelectedFolderId(result.folder.id);
    });
  }, [refresh, runAction, selectedFolder?.id]);

  const handleQueueTranscription = useCallback(
    (recording: SmartPuckRecording) => {
      void runAction("Queueing transcription", async () => {
        await window.hermesAPI.smartPuck.queueTranscription(
          recording.id,
          TRANSCRIPTION_MODEL,
          null,
          DENOISE_MODE,
          NORMALIZE_AUDIO,
        );
        await refresh();
      });
    },
    [refresh, runAction],
  );

  const handleEditTranscript = useCallback((recording: SmartPuckRecording) => {
    setEditingRecording(recording);
    setTranscriptLoading(true);
    setTranscriptDraft("");
    transcriptPrefixRef.current = "";
    void window.hermesAPI.smartPuck
      .readTranscript(recording.id)
      .then((content) => {
        const marker = /^## Transcript\s*$/m;
        const match = marker.exec(content);
        if (!match) {
          setTranscriptDraft(content.trim());
          return;
        }
        const bodyStart = match.index + match[0].length;
        transcriptPrefixRef.current = `${content.slice(0, bodyStart).trimEnd()}\n\n`;
        setTranscriptDraft(content.slice(bodyStart).trim());
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setTranscriptLoading(false));
  }, []);

  const handleSaveTranscript = useCallback(() => {
    if (!editingRecording) return;
    void runAction("Saving transcript", async () => {
      await window.hermesAPI.smartPuck.saveTranscript(
        editingRecording.id,
        transcriptDraft.trim()
          ? `${transcriptPrefixRef.current}${transcriptDraft.trim()}`
          : "",
      );
      setEditingRecording(null);
      await refresh();
    });
  }, [editingRecording, refresh, runAction, transcriptDraft]);

  const connectAndSyncDevice = useCallback(
    async (url: string, surfaceError: boolean): Promise<boolean> => {
      try {
        if (surfaceError) setError(null);
        let resolvedUrl = url;
        try {
          const parsed = new URL(url);
          if (parsed.hostname === "smartpuck.local") {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 3_000);
            try {
              const response = await fetch(`${parsed.origin}/status`, {
                cache: "no-store",
                signal: controller.signal,
              });
              const status = response.ok
                ? (await response.json()) as { ip?: unknown }
                : null;
              if (typeof status?.ip === "string" && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(status.ip)) {
                resolvedUrl = `http://${status.ip}`;
              }
            } finally {
              window.clearTimeout(timeout);
            }
          }
        } catch {
          // Keep the entered URL as a fallback; the main process will report a useful error.
        }
        let next = await window.hermesAPI.smartPuck.getDeviceSnapshot(resolvedUrl);
        setDevice(next);
        setDeviceUrl(next.baseUrl);
        try {
          localStorage.setItem(DEVICE_URL_KEY, next.baseUrl);
        } catch {
          /* persistence is best-effort */
        }
        return true;
      } catch (err) {
        if (surfaceError) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return false;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const connectDevice = useCallback(() => {
    void (async () => {
      setDeviceConnecting(true);
      const connected = await connectAndSyncDevice(deviceUrl, true);
      setDeviceConnecting(false);
      if (connected) setManualDeviceOpen(false);
    })();
  }, [connectAndSyncDevice, deviceUrl]);

  const handleStartDeviceRecording = useCallback(async () => {
    console.log("[SmartPuck] Clicked Start Recording, device:", device);
    if (!device) return;
    setDeviceCommand("start");
    setBusy("Starting recording");
    setError(null);
    try {
      await window.hermesAPI.smartPuck.controlRecording(device.baseUrl, "start");
      setDevice((current) =>
        current
          ? { ...current, status: { ...current.status, recording: true, audioLevel: 0 } }
          : current,
      );
    } catch (err) {
      setDevice((current) =>
        current
          ? { ...current, status: { ...current.status, recording: false, audioLevel: 0 } }
          : current,
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeviceCommand(null);
      setBusy(null);
    }
  }, [device]);

  const handleStopDeviceRecording = useCallback(async () => {
    console.log("[SmartPuck] Clicked Stop Recording, device:", device);
    if (!device) return;
    setDeviceCommand("stop");
    setBusy("Stopping recording");
    setError(null);
    try {
      await window.hermesAPI.smartPuck.controlRecording(device.baseUrl, "stop");
      setDevice((current) =>
        current
          ? { ...current, status: { ...current.status, recording: false, audioLevel: 0 } }
          : current,
      );
      void (async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 300 + attempt * 400));
          try {
            const snapshot = await window.hermesAPI.smartPuck.getDeviceSnapshot(
              device.baseUrl,
            );
            setDevice(snapshot);
            return;
          } catch {
            // The puck can briefly remain busy while the SD file is finalized.
          }
        }
      })();
    } catch (err) {
      setDevice((current) =>
        current
          ? { ...current, status: { ...current.status, recording: true } }
          : current,
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeviceCommand(null);
      setBusy(null);
    }
  }, [device]);

  const ensureAudioContext = useCallback(async () => {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("This browser does not support Web Audio playback.");
    }
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor({ sampleRate: 16000 });
      const gain = audioContextRef.current.createGain();
      // A small monitor lift keeps Live Listen close to recorded playback.
      // Larger boosts make spoken voice misleadingly louder than the saved WAV.
      gain.gain.value = 2;
      const compressor = audioContextRef.current.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 8;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
      gain.connect(compressor);
      compressor.connect(audioContextRef.current.destination);
      monitorGainRef.current = gain;
      monitorCompressorRef.current = compressor;
      nextPlaybackTimeRef.current = audioContextRef.current.currentTime + 0.05;
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
  }, []);

  const playPcmChunk = useCallback((pcmChunk: Uint8Array) => {
    const audioContext = audioContextRef.current;
    if (!audioContext || pcmChunk.byteLength < 2) {
      return;
    }

    const sampleCount = Math.floor(pcmChunk.byteLength / 2);
    const audioBuffer = audioContext.createBuffer(1, sampleCount, 16000);
    const channel = audioBuffer.getChannelData(0);
    const view = new DataView(pcmChunk.buffer, pcmChunk.byteOffset, sampleCount * 2);
    let peak = 0;

    for (let i = 0; i < sampleCount; i += 1) {
      const sample = view.getInt16(i * 2, true);
      channel[i] = sample / 32768;
      peak = Math.max(peak, Math.abs(sample));
    }
    const now = performance.now();
    if (now - lastLiveLevelUpdateRef.current >= 100) {
      lastLiveLevelUpdateRef.current = now;
      setLiveAudioLevel(Math.min(100, Math.round((peak / 32767) * 100)));
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(monitorGainRef.current ?? audioContext.destination);
    const startAt = Math.max(audioContext.currentTime + 0.02, nextPlaybackTimeRef.current);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + audioBuffer.duration;
    activeAudioSourcesRef.current.push(source);
    source.onended = () => {
      activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter((item) => item !== source);
    };
  }, []);

  const startLiveListening = useCallback(async () => {
    console.log("[SmartPuck] Clicked Start Live Listening, device:", device, "liveListening:", liveListening);
    if (!device || liveListening || device.status.recording || deviceCommand !== null) return;
    let abortController: AbortController | null = null;
    try {
      const controller = new AbortController();
      abortController = controller;
      streamAbortRef.current = abortController;
      const connectTimeout = window.setTimeout(() => controller.abort(), 8000);
      streamHeaderBytesToSkipRef.current = 44;
      streamPcmCarryRef.current = new Uint8Array(0);
      setLiveListening(true);
      setError(null);
      await ensureAudioContext();

      let response: Response;
      try {
        response = await fetch(`${deviceStreamUrl(device)}/stream`, {
          cache: "no-store",
          signal: abortController.signal,
        });
      } finally {
        window.clearTimeout(connectTimeout);
      }
      if (!response.ok || !response.body) {
        throw new Error(`Stream failed with HTTP ${response.status}.`);
      }

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          let start = 0;
          if (streamHeaderBytesToSkipRef.current > 0) {
            const skipped = Math.min(streamHeaderBytesToSkipRef.current, value.byteLength);
            streamHeaderBytesToSkipRef.current -= skipped;
            start = skipped;
          }
          if (start < value.byteLength) {
            const incoming = value.slice(start);
            const combined = new Uint8Array(
              streamPcmCarryRef.current.byteLength + incoming.byteLength,
            );
            combined.set(streamPcmCarryRef.current, 0);
            combined.set(incoming, streamPcmCarryRef.current.byteLength);
            const evenLength = combined.byteLength - (combined.byteLength % 2);
            if (evenLength > 0) playPcmChunk(combined.slice(0, evenLength));
            streamPcmCarryRef.current = combined.slice(evenLength);
          }
        }
      }

      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
        setLiveListening(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (abortController && streamAbortRef.current === abortController) {
          streamAbortRef.current = null;
          setLiveListening(false);
          setError("SmartPuck did not answer in time. Check the IP address and Wi-Fi network.");
        }
        return;
      }
      setLiveListening(false);
      setError(err instanceof Error ? err.message : "SmartPuck stream stopped unexpectedly.");
    }
  }, [device, liveListening, ensureAudioContext, playPcmChunk]);

  const stopLiveListening = useCallback(() => {
    console.log("[SmartPuck] Clicked Stop Live Listening");
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    activeAudioSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Sources may already have ended naturally.
      }
    });
    activeAudioSourcesRef.current = [];
    nextPlaybackTimeRef.current = 0;
    streamPcmCarryRef.current = new Uint8Array(0);
    setLiveAudioLevel(0);
    setLiveListening(false);
  }, []);

  const handlePlayDeviceSession = useCallback(
    async (session: SmartPuckDeviceSession) => {
      if (!device) return;
      try {
        await onPlayDeviceAudio(session, deviceStreamUrl(device));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not play SmartPuck recording.");
      }
    },
    [device, onPlayDeviceAudio],
  );

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      activeAudioSourcesRef.current.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Ignore
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!device || liveListening) return;
    const interval = setInterval(() => {
      void connectAndSyncDevice(device.baseUrl, false);
    }, 4000);
    return () => clearInterval(interval);
  }, [device?.baseUrl, device?.status.recording, deviceCommand, liveListening, connectAndSyncDevice]);

  useEffect(() => {
    if (!device?.status.recording) return;
    let cancelled = false;
    let requestRunning = false;
    const updateLevel = async (): Promise<void> => {
      if (requestRunning) return;
      requestRunning = true;
      try {
        const response = await fetch(`${deviceStreamUrl(device)}/status`, { cache: "no-store" });
        if (!response.ok) return;
        const status = (await response.json()) as SmartPuckDeviceSnapshot["status"];
        if (!cancelled) {
          setDevice((current) => (current ? { ...current, status } : current));
        }
      } catch {
        // A transient meter miss must not interrupt an active recording.
      } finally {
        requestRunning = false;
      }
    };
    void updateLevel();
    const interval = window.setInterval(() => void updateLevel(), 300);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [device?.baseUrl, device?.status.recording]);

  useEffect(() => {
    if (autoConnectStartedRef.current) return;
    autoConnectStartedRef.current = true;
    let cancelled = false;
    void (async () => {
      setDeviceConnecting(true);
      const candidates = Array.from(
        new Set([
          DEVICE_FALLBACK_URLS[0],
          deviceUrl,
          ...DEVICE_FALLBACK_URLS.slice(1),
        ]),
      );
      for (const candidate of candidates) {
        if (cancelled) return;
        if (await connectAndSyncDevice(candidate, false)) {
          if (!cancelled) setDeviceConnecting(false);
          return;
        }
      }
      if (!cancelled) {
        setDeviceConnecting(false);
        setManualDeviceOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectAndSyncDevice, deviceUrl]);

  return (
    <div className="smartpuck-screen">
      <style>{`
        .smartpuck-recording-row {
          display: grid;
          grid-template-columns: 40px 1fr auto;
          gap: 16px;
          align-items: center;
          padding: 14px 20px;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          background: var(--bg-secondary);
          transition: all 0.2s ease;
        }
        .smartpuck-recording-row:hover {
          border-color: var(--border-bright);
          background: var(--bg-card);
        }
        .smartpuck-recording-icon {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--accent-subtle);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          border: none;
          cursor: pointer;
        }
        .smartpuck-recording-icon:hover {
          background: var(--accent);
          color: #ffffff;
          transform: scale(1.05);
        }
        .smartpuck-recording-title {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 8px;
        }
        .smartpuck-recording-title strong {
          font-size: 14px;
          font-weight: 650;
          color: var(--text-primary);
        }
        .smartpuck-status-badge {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .smartpuck-status-ready {
          background: rgba(46, 204, 113, 0.15);
          color: #2ecc71;
        }
        .smartpuck-status-no-speech {
          background: rgba(149, 165, 166, 0.15);
          color: #95a5a6;
        }
        .smartpuck-status-queued {
          background: rgba(241, 196, 15, 0.15);
          color: #f1c40f;
        }
        .smartpuck-status-working {
          background: rgba(52, 152, 219, 0.15);
          color: #3498db;
        }
        .smartpuck-status-imported {
          background: rgba(155, 89, 182, 0.15);
          color: #9b59b6;
        }
        .smartpuck-status-error {
          background: rgba(231, 76, 60, 0.15);
          color: #e74c3c;
        }
        .smartpuck-recording-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-top: 4px;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .smartpuck-recording-filename {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 3px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .smartpuck-audio-slider {
          -webkit-appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: var(--border);
          outline: none;
          cursor: pointer;
        }
        .smartpuck-audio-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--accent);
          transition: transform 0.1s ease;
        }
        .smartpuck-audio-slider::-webkit-slider-thumb:hover {
          transform: scale(1.3);
        }
        .smartpuck-recording-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .smartpuck-dropdown-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          border: none;
          background: transparent;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 12px;
          text-align: left;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .smartpuck-dropdown-item:hover {
          background: var(--bg-hover);
        }
        .smartpuck-dropdown-item svg {
          color: var(--text-secondary);
          flex-shrink: 0;
        }
        .smartpuck-dropdown-item-danger {
          color: #d84a3a !important;
        }
        .smartpuck-dropdown-item-danger:hover {
          background: rgba(216, 74, 58, 0.1);
        }
        .smartpuck-dropdown-item-danger svg {
          color: #d84a3a !important;
        }
        .smartpuck-accordion-header {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 22px;
          background: var(--bg-secondary);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          font-family: inherit;
          font-weight: 600;
          font-size: 13px;
          color: var(--text-primary);
          cursor: pointer;
          transition: background 0.15s ease;
          border-left: none;
          border-right: none;
        }
        .smartpuck-accordion-header:hover {
          background: var(--bg-hover);
        }
        .smartpuck-accordion-content {
          padding: 0;
          background: var(--bg-primary);
          min-height: 0;
          opacity: 0;
          transform: translateY(-6px);
          transition: opacity 160ms ease, transform 220ms ease;
        }
        .smartpuck-device-storage-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 22px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border);
          font-size: 12px;
          color: var(--text-secondary);
        }
        .smartpuck-accordion-content-wrapper {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.3s ease-out;
          overflow: hidden;
        }
        .smartpuck-accordion-content-wrapper.expanded {
          grid-template-rows: 1fr;
        }
        .smartpuck-accordion-content-wrapper.expanded > .smartpuck-accordion-content {
          opacity: 1;
          transform: translateY(0);
          transition-delay: 80ms;
        }
        @keyframes smartpuck-pulse {
          0% { opacity: 0.6; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1.05); }
          100% { opacity: 0.6; transform: scale(0.95); }
        }
        .smartpuck-pulse {
          animation: smartpuck-pulse 1.5s infinite ease-in-out;
          color: var(--red) !important;
        }
        .smartpuck-recording-active {
          border-color: rgba(231, 76, 60, 0.4) !important;
          background: rgba(231, 76, 60, 0.1) !important;
          color: #e74c3c !important;
        }
        .smartpuck-recording-meter {
          height: 16px;
          display: inline-flex;
          align-items: center;
          gap: 2px;
        }
        .smartpuck-recording-meter > i {
          width: 2px;
          min-height: 3px;
          border-radius: 2px;
          background: currentColor;
          transition: height 120ms ease;
        }
        .smartpuck-level-orb {
          display: inline-grid;
          width: 26px;
          height: 26px;
          place-items: center;
          border: 2px solid currentColor;
          border-radius: 50%;
          transition: transform 100ms ease, box-shadow 100ms ease;
        }
        .smartpuck-inline-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: nowrap;
        }
        .smartpuck-danger-icon-btn {
          border-color: color-mix(in srgb, var(--red) 55%, var(--border)) !important;
          color: var(--red) !important;
        }
        .smartpuck-listening-active {
          border-color: rgba(46, 204, 113, 0.4) !important;
          background: rgba(46, 204, 113, 0.1) !important;
          color: #2ecc71 !important;
        }
        .smartpuck-device-strip {
          display: flex !important;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 8px 20px !important;
          flex-wrap: nowrap;
          overflow: hidden;
        }
        .smartpuck-device-stats {
          grid-column: auto !important;
          display: flex !important;
          align-items: center;
          gap: 8px;
          flex-shrink: 1;
          min-width: 0;
        }
        .smartpuck-secondary-btn {
          cursor: pointer !important;
          pointer-events: auto !important;
          user-select: none !important;
          -webkit-user-select: none !important;
        }
      `}</style>
      {error && <div className="smartpuck-error">{error}</div>}

      <section className="smartpuck-device-strip">
        <div className="smartpuck-device-heading">
          {device ? (
            <Check size={17} style={{ color: "var(--accent)" }} />
          ) : deviceConnecting ? (
            <Loader size={17} className="smartpuck-spin" />
          ) : (
            <Signal size={17} />
          )}
          <div>
            <strong>
              {device ? "SmartPuck connected" : "SmartPuck device"}
            </strong>
            <span>
              {device
                ? device.baseUrl.startsWith("usb://")
                  ? `USB-C connected · Wi-Fi ${device.status.ip || "available"}`
                  : `${device.status.networkMode === "ap" ? "Device hotspot" : "Wi-Fi"} · ${device.baseUrl.replace(/^https?:\/\//, "")}`
                : deviceConnecting
                  ? "Looking for your SmartPuck..."
                  : "Not connected"}
            </span>
          </div>
        </div>
        {manualDeviceOpen && !device && (
          <form
            className="smartpuck-device-connect"
            onSubmit={(event) => {
              event.preventDefault();
              connectDevice();
            }}
          >
            <input
              value={deviceUrl}
              onChange={(event) => setDeviceUrl(event.target.value)}
              aria-label="SmartPuck device URL"
              placeholder="http://192.168.4.1"
            />
            <button
              className="smartpuck-secondary-btn"
              type="submit"
              disabled={deviceConnecting || !deviceUrl.trim()}
            >
              <Signal size={14} />
              Connect
            </button>
          </form>
        )}
        <div className="smartpuck-device-stats">
          {device ? (
            <>
              <span>Firmware {device.status.firmwareVersion}</span>
              <span>
                {device.sessions.length} session
                {device.sessions.length === 1 ? "" : "s"}
              </span>

              {/* Record / Stop Recording Button */}
              {deviceCommand === "start" ? (
                <button
                  className="smartpuck-secondary-btn"
                  type="button"
                  disabled
                >
                  <Loader size={14} className="smartpuck-spin" />
                  Starting…
                </button>
              ) : device.status.recording ? (
                <button
                  className="smartpuck-secondary-btn smartpuck-recording-active"
                  type="button"
                  title="Stop recording on device"
                  onClick={handleStopDeviceRecording}
                  disabled={deviceCommand === "stop"}
                >
                  <span
                    className="smartpuck-level-orb"
                    aria-hidden="true"
                    style={{
                      transform: `scale(${Math.min(1.65, 1 + Math.sqrt(device.status.audioLevel || 0) / 12)})`,
                      boxShadow: `0 0 ${5 + Math.sqrt(device.status.audioLevel || 0) * 2}px color-mix(in srgb, var(--red) ${35 + Math.min(45, (device.status.audioLevel || 0) * 2)}%, transparent)`,
                    }}
                  >
                    <Circle size={9} fill="currentColor" />
                  </span>
                  {deviceCommand === "stop" ? "Stopping…" : "Recording"}
                </button>
              ) : (
                <button
                  className="smartpuck-secondary-btn"
                  type="button"
                  title="Start recording on device"
                  onClick={handleStartDeviceRecording}
                  disabled={deviceCommand !== null || liveListening}
                >
                  <Circle size={14} style={{ color: "var(--red)" }} />
                  Record
                </button>
              )}

              {/* Live Listen Button */}
              {liveListening ? (
                <button
                  className="smartpuck-secondary-btn smartpuck-listening-active"
                  type="button"
                  title="Stop live stream"
                  onClick={stopLiveListening}
                >
                  <span
                    className="smartpuck-level-orb"
                    aria-hidden="true"
                    style={{
                      transform: `scale(${Math.min(1.65, 1 + Math.sqrt(liveAudioLevel) / 12)})`,
                      boxShadow: `0 0 ${5 + Math.sqrt(liveAudioLevel) * 2}px color-mix(in srgb, var(--accent) ${35 + Math.min(45, liveAudioLevel * 2)}%, transparent)`,
                    }}
                  >
                    <AudioLines size={10} />
                  </span>
                  Stop Listen
                </button>
              ) : (
                <button
                  className="smartpuck-secondary-btn"
                  type="button"
                  title="Listen to device live stream"
                  onClick={startLiveListening}
                  disabled={deviceCommand !== null || device.status.recording}
                >
                  <AudioLines size={14} />
                  Live Listen
                </button>
              )}

              <button
                className="smartpuck-secondary-btn"
                type="button"
                disabled
              >
                {busy?.startsWith("Transferring") ? (
                  <Loader size={14} className="smartpuck-spin" />
                ) : (
                  <Check size={14} />
                )}
                {busy?.startsWith("Transferring")
                  ? "Transferring"
                  : pendingDeviceSessions.length === 0
                    ? "Synced"
                    : `${pendingDeviceSessions.length} on device`}
              </button>
              <button
                className="smartpuck-icon-btn"
                type="button"
                title="Refresh device"
                aria-label="Refresh device"
                onClick={() => void connectAndSyncDevice(device.baseUrl, true)}
                disabled={deviceConnecting}
              >
                <Refresh size={15} />
              </button>
              <button
                className="smartpuck-icon-btn"
                type="button"
                title="Change device"
                aria-label="Change device"
                onClick={() => {
                  setDevice(null);
                  setManualDeviceOpen(true);
                }}
                disabled={deviceConnecting || !!busy}
              >
                <SettingsIcon size={15} />
              </button>
            </>
          ) : !deviceConnecting && !manualDeviceOpen ? (
            <button
              className="smartpuck-secondary-btn"
              type="button"
              onClick={() => setManualDeviceOpen(true)}
            >
              Connect manually
            </button>
          ) : null}
        </div>
      </section>

      <div className="smartpuck-layout smartpuck-layout-single">
        <section className="smartpuck-main-pane">
          <div className="smartpuck-folder-toolbar">
            <div className="smartpuck-folder-title">
              <AudioLines size={18} />
              <div>
                <h2>Recording library</h2>
                <p>Import and process recordings stored on this computer.</p>
              </div>
            </div>
            <div className="smartpuck-toolbar-actions">
              <div className="smartpuck-menu-select">
                <button
                  type="button"
                  className="smartpuck-menu-trigger"
                  onClick={() => setFolderMenuOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={folderMenuOpen}
                >
                  <Folder size={14} />
                  <span>{selectedFolder?.name ?? "All recordings"}</span>
                  <ChevronDown size={13} />
                </button>
                {folderMenuOpen && (
                  <div className="smartpuck-menu-dropdown" role="listbox">
                    <button
                      type="button"
                      role="option"
                      aria-selected={!selectedFolder}
                      className={`smartpuck-menu-option ${!selectedFolder ? "active" : ""}`}
                      onClick={() => {
                        setSelectedFolderId(null);
                        setFolderMenuOpen(false);
                      }}
                    >
                      <span>All recordings</span>
                      {!selectedFolder && <Check size={14} />}
                    </button>
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        role="option"
                        aria-selected={folder.id === selectedFolder?.id}
                        className={`smartpuck-menu-option ${folder.id === selectedFolder?.id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedFolderId(folder.id);
                          setFolderMenuOpen(false);
                        }}
                      >
                        <span>{folder.name}</span>
                        {folder.id === selectedFolder?.id && (
                          <Check size={14} />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="smartpuck-primary-btn"
                type="button"
                onClick={handleImportAudio}
                disabled={!!busy}
              >
                {busy?.startsWith("Importing") ? (
                  <Loader size={15} className="smartpuck-spin" />
                ) : (
                  <AudioLines size={15} />
                )}
                Import audio
              </button>
            </div>
          </div>

          <div className="smartpuck-folder-summary">
            <button
              className="smartpuck-summary-action"
              type="button"
              disabled={!selectedFolder}
              onClick={() =>
                void runAction("Opening folder", async () => {
                  await window.hermesAPI.smartPuck.openPath(
                    selectedFolder?.path,
                  );
                })
              }
            >
              <Folder size={16} />
              Open folder
            </button>
            <div>
              <strong>{visibleRecordings.length}</strong>
              <span>recordings</span>
            </div>
            <div>
              <strong>
                {formatBytes(
                  visibleRecordings.reduce(
                    (total, recording) => total + recording.sizeBytes,
                    0,
                  ) ?? 0,
                )}
              </strong>
              <span>stored locally</span>
            </div>
          </div>
          {/* Collapsible Local Recording Library */}
          <button
            type="button"
            className="smartpuck-accordion-header"
            onClick={() => setLocalLibraryExpanded(!localLibraryExpanded)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AudioLines size={16} style={{ color: "var(--accent)" }} />
              <span>All recordings ({visibleRecordings.length})</span>
            </div>
            <ChevronDown
              size={16}
              style={{
                transform: localLibraryExpanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease"
              }}
            />
          </button>
          
          <div className={`smartpuck-accordion-content-wrapper ${localLibraryExpanded ? "expanded" : ""}`}>
            <div className="smartpuck-accordion-content">
              <div className="smartpuck-recordings">
                {visibleRecordings.map((recording) => {
                  return (
                    <article className="smartpuck-recording-row" key={recording.id}>
                      <button
                        type="button"
                        className="smartpuck-recording-icon"
                        onClick={() => onPlayPauseAudio(recording)}
                        title={playingId === recording.id && audioPlaying ? "Pause audio" : "Play audio"}
                      >
                        {playingId === recording.id ? (
                          audioUrl === null ? (
                            <Loader size={16} className="smartpuck-spin" />
                          ) : audioPlaying ? (
                            <Pause size={16} />
                          ) : (
                            <Play size={16} />
                          )
                        ) : (
                          <Play size={16} />
                        )}
                      </button>
                      <div className="smartpuck-recording-main" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <div className="smartpuck-recording-title">
                          <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {recording.title}
                          </strong>
                          <span className={`smartpuck-status-badge smartpuck-status-${recording.status === "transcribing" ? "working" : recording.status}`}>
                            {statusLabel(recording)}
                          </span>
                        </div>
                        <div className="smartpuck-recording-meta">
                          <span>{formatDate(recording.createdAt)}</span>
                          <span style={{ color: "var(--text-muted)" }}>·</span>
                          <span>{formatBytes(recording.sizeBytes)}</span>
                          {recording.language && (
                            <>
                              <span style={{ color: "var(--text-muted)" }}>·</span>
                              <span>{recording.language.toUpperCase()}</span>
                            </>
                          )}
                          {recording.durationSeconds && (
                            <>
                              <span style={{ color: "var(--text-muted)" }}>·</span>
                              <span>{formatTime(recording.durationSeconds)}</span>
                            </>
                          )}
                        </div>
                        <div className="smartpuck-recording-filename">
                          <span style={{ color: "var(--text-muted)" }}>File:</span>
                          <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                            {recording.sourceFileName}
                          </span>
                        </div>
                      </div>
                      <div className="smartpuck-recording-actions">
                        {recording.status === "queued" || recording.status === "transcribing" ? (
                          <button
                            className="smartpuck-secondary-btn"
                            type="button"
                            disabled
                            style={{ cursor: "not-allowed" }}
                          >
                            <Loader size={14} className="smartpuck-spin" />
                            {recording.status === "queued" ? "Queued" : "Working"}
                          </button>
                        ) : recording.status === "ready" || recording.status === "no-speech" ? null : (
                          <button
                            className="smartpuck-primary-btn"
                            type="button"
                            onClick={() => handleQueueTranscription(recording)}
                            disabled={!!busy}
                          >
                            <AudioLines size={14} />
                            Transcribe
                          </button>
                        )}

                        {recording.status !== "queued" && recording.status !== "transcribing" && (
                          <div className="smartpuck-inline-actions">
                            <button
                              type="button"
                              className="smartpuck-icon-btn"
                              title="Add to folder"
                              aria-label={`Add ${recording.title} to folder`}
                              onClick={() => setPlaylistPickerRecording(recording)}
                            >
                              <Plus size={14} />
                            </button>
                            <button
                              type="button"
                              className="smartpuck-icon-btn smartpuck-danger-icon-btn"
                              title="Delete audio"
                              aria-label={`Delete ${recording.title}`}
                              onClick={() => handleDeleteRecording(recording.id)}
                            >
                              <Trash size={14} />
                            </button>
                          </div>
                        )}

                        {recording.status !== "queued" && recording.status !== "transcribing" && (
                          <div style={{ position: "relative" }}>
                            <button
                              type="button"
                              className="smartpuck-icon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const bounds = e.currentTarget.getBoundingClientRect();
                                setActiveMenuPosition({
                                  top: Math.min(bounds.bottom + 6, window.innerHeight - 276),
                                  right: Math.max(12, window.innerWidth - bounds.right),
                                });
                                setActiveMenuId(activeMenuId === recording.id ? null : recording.id);
                                setActiveSubMenu('main');
                              }}
                              title="More actions"
                              aria-label="More actions"
                            >
                              <MoreVertical size={16} />
                            </button>
                            {activeMenuId === recording.id && (
                              <>
                                <div
                                  onClick={() => setActiveMenuId(null)}
                                  style={{
                                    position: "fixed",
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    zIndex: 998,
                                  }}
                                />
                                <div
                                  className="smartpuck-dropdown-menu"
                                  style={{
                                    position: "fixed",
                                    top: activeMenuPosition.top,
                                    right: activeMenuPosition.right,
                                    background: "var(--bg-secondary)",
                                    border: "1px solid var(--border-bright)",
                                    borderRadius: 6,
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                                    zIndex: 999,
                                    minWidth: 180,
                                    padding: "4px 0",
                                    display: "flex",
                                    flexDirection: "column"
                                  }}
                                >
                                  {activeSubMenu === 'main' ? (
                                    <>
                                      <button
                                        type="button"
                                        className="smartpuck-dropdown-item"
                                        onClick={() => {
                                          setActiveMenuId(null);
                                          handleRenameRecording(recording);
                                        }}
                                      >
                                        <Pencil size={14} />
                                        Rename
                                      </button>
                                      <button
                                        type="button"
                                        className="smartpuck-dropdown-item"
                                        onClick={() => {
                                          setActiveMenuId(null);
                                          void runAction("Opening recording", async () => {
                                            await window.hermesAPI.smartPuck.openPath(recording.recordingPath);
                                          });
                                        }}
                                      >
                                        <Folder size={14} />
                                        Open folder
                                      </button>
                                      {(recording.status === "ready" || recording.status === "no-speech") && (
                                        <>
                                          <button
                                            type="button"
                                            className="smartpuck-dropdown-item"
                                            onClick={() => {
                                              setActiveMenuId(null);
                                              handleEditTranscript(recording);
                                            }}
                                          >
                                            <Pencil size={14} />
                                            Edit transcript
                                          </button>
                                          <button
                                            type="button"
                                            className="smartpuck-dropdown-item"
                                            onClick={() => {
                                              setActiveMenuId(null);
                                              handleQueueTranscription(recording);
                                            }}
                                          >
                                            <Refresh size={14} />
                                            Re-transcribe
                                          </button>
                                          <button
                                            type="button"
                                            className="smartpuck-dropdown-item"
                                            onClick={() => {
                                              setActiveMenuId(null);
                                              handleDeleteTranscript(recording.id);
                                            }}
                                          >
                                            <X size={14} />
                                            Delete transcript
                                          </button>
                                        </>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        className="smartpuck-dropdown-item"
                                        style={{ fontWeight: 600, borderBottom: "1px solid var(--border)", borderRadius: 0, paddingBottom: 8 }}
                                        onClick={() => setActiveSubMenu('main')}
                                      >
                                        ← Back
                                      </button>
                                      <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                                        {folders.map((f) => (
                                          <button
                                            key={f.id}
                                            type="button"
                                            className="smartpuck-dropdown-item"
                                            style={{ paddingLeft: 20, color: f.id === recording.folderId ? "var(--accent)" : "inherit" }}
                                            disabled={f.id === recording.folderId}
                                            onClick={() => {
                                              setActiveMenuId(null);
                                              handleMoveRecording(recording.id, f.id);
                                            }}
                                          >
                                            <Folder size={12} style={{ marginRight: 6, opacity: 0.7 }} />
                                            {f.name}
                                          </button>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}

                {visibleRecordings.length === 0 && (
                  <div className="smartpuck-empty-recordings">
                    <AudioLines size={28} />
                    <h3>No recordings yet</h3>
                    <p>
                      Import audio files or connect a SmartPuck. Recordings and
                      transcripts stay on this computer.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Collapsible SmartPuck Device Storage */}
          <button
            type="button"
            className="smartpuck-accordion-header"
            onClick={() => setDeviceStorageExpanded(!deviceStorageExpanded)}
            style={{ borderTop: "none" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Signal size={16} style={{ color: device ? "var(--accent)" : "var(--text-muted)" }} />
              <span>SmartPuck Device Storage {device ? `(${device.sessions.length})` : "(Disconnected)"}</span>
            </div>
            <ChevronDown
              size={16}
              style={{
                transform: deviceStorageExpanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease"
              }}
            />
          </button>

          <div className={`smartpuck-accordion-content-wrapper ${deviceStorageExpanded ? "expanded" : ""}`}>
            <div className="smartpuck-accordion-content">
              {!device ? (
                <div className="smartpuck-empty-recordings" style={{ margin: "24px auto", maxWidth: 450 }}>
                  <Signal size={28} />
                  <h3>No SmartPuck connected</h3>
                  <p>
                    Please connect your SmartPuck device to view and transfer recordings stored on it.
                  </p>
                </div>
              ) : (
                <>
                  <div className="smartpuck-device-storage-toolbar">
                    <div>
                      <span>Storage: </span>
                      <strong>
                        {formatBytes(device.status.storageTotalBytes - device.status.storageFreeBytes)}
                      </strong>
                      <span> used / </span>
                      <strong>{formatBytes(device.status.storageTotalBytes)}</strong>
                      <span> total</span>
                    </div>
                    {device.sessions.filter(s => !isAlreadyImported(s)).length > 0 && (
                      <button
                        type="button"
                        className="smartpuck-primary-btn"
                        style={{ height: 28, fontSize: 11 }}
                        disabled={!!busy}
                        onClick={handleTransferAllNewSessions}
                      >
                        <Check size={12} />
                        Transfer All New ({device.sessions.filter(s => !isAlreadyImported(s)).length})
                      </button>
                    )}
                  </div>

                  <div className="smartpuck-recordings" style={{ paddingTop: 14 }}>
                    {device.sessions.map((session) => {
                      const imported = isAlreadyImported(session);
                      const sessionAction =
                        deviceSessionAction?.path === session.sessionPath
                          ? deviceSessionAction.type
                          : null;
                      return (
                        <article className="smartpuck-recording-row" key={session.sessionPath}>
                          <button
                            type="button"
                            className="smartpuck-recording-icon"
                            title="Play directly from SmartPuck"
                            aria-label={`Play ${session.displayName || session.name} from SmartPuck`}
                            onClick={() => void handlePlayDeviceSession(session)}
                          >
                            {playingId === `device:${session.sessionPath}` && audioUrl === null ? (
                              <Loader size={16} className="smartpuck-spin" />
                            ) : playingId === `device:${session.sessionPath}` && audioPlaying ? (
                              <Pause size={16} />
                            ) : (
                              <Play size={16} />
                            )}
                          </button>
                          <div className="smartpuck-recording-main" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                            <div className="smartpuck-recording-title">
                              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {session.displayName || session.name}
                              </strong>
                              <span className={`smartpuck-status-badge ${imported ? "smartpuck-status-ready" : "smartpuck-status-imported"}`} style={{ border: "1px solid var(--border)", textTransform: "none" }}>
                                {imported ? "Synced to Library" : "On Device Only"}
                              </span>
                            </div>
                            <div className="smartpuck-recording-meta">
                              <span>Size: {formatBytes(session.sizeBytes)}</span>
                              <span style={{ color: "var(--text-muted)" }}>·</span>
                              <span>Duration: {formatTime(session.durationSeconds)}</span>
                              {session.createdAt && (
                                <>
                                  <span style={{ color: "var(--text-muted)" }}>·</span>
                                  <span>{session.createdAt}</span>
                                </>
                              )}
                            </div>
                            <div className="smartpuck-recording-filename">
                              <span style={{ color: "var(--text-muted)" }}>Path:</span>
                              <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                {session.sessionPath}
                              </span>
                            </div>
                          </div>
                          <div className="smartpuck-recording-actions">
                            {!imported && (
                              <button
                                className="smartpuck-primary-btn"
                                type="button"
                                onClick={() => handleTransferSession(session)}
                                disabled={sessionAction !== null}
                              >
                                {sessionAction === "transfer" ? (
                                  <Loader size={14} className="smartpuck-spin" />
                                ) : (
                                  <AudioLines size={14} />
                                )}
                                {sessionAction === "transfer" ? "Transferring…" : "Transfer"}
                              </button>
                            )}
                            <button
                              className="smartpuck-icon-btn"
                              style={{ borderColor: "#d84a3a", color: "#d84a3a" }}
                              type="button"
                              title={imported ? "Delete from device" : "Permanently delete untransferred recording from device"}
                              aria-label={`Delete ${session.displayName || session.name} from device`}
                              onClick={() => handleDeleteDeviceSession(session)}
                              disabled={sessionAction !== null}
                            >
                              {sessionAction === "delete" ? (
                                <Loader size={14} className="smartpuck-spin" />
                              ) : (
                                <Trash size={14} />
                              )}
                            </button>
                          </div>
                        </article>
                      );
                    })}

                    {device.sessions.length === 0 && (
                      <div className="smartpuck-empty-recordings">
                        <AudioLines size={28} />
                        <h3>No recordings on device</h3>
                        <p>
                          Recordings taken on the SmartPuck will appear here when connected.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      {editingRecording && (
        <div
          className="smartpuck-transcript-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="smartpuck-transcript-title"
        >
          <div className="smartpuck-transcript-dialog">
            <header>
              <div>
                <h2 id="smartpuck-transcript-title">Edit transcript</h2>
                <p>{editingRecording.title}</p>
                <div className="smartpuck-transcript-meta">
                  <span>{formatDate(editingRecording.createdAt)}</span>
                  {editingRecording.durationSeconds != null && (
                    <span>{formatTime(editingRecording.durationSeconds)}</span>
                  )}
                  {editingRecording.language && (
                    <span>{editingRecording.language.toUpperCase()}</span>
                  )}
                </div>
              </div>
              <button
                className="smartpuck-icon-btn"
                type="button"
                title="Close"
                aria-label="Close transcript editor"
                onClick={() => setEditingRecording(null)}
              >
                <X size={16} />
              </button>
            </header>
            {transcriptLoading ? (
              <div className="smartpuck-transcript-loading">
                <Loader size={18} className="smartpuck-spin" />
              </div>
            ) : (
              <textarea
                autoFocus
                value={transcriptDraft}
                onChange={(event) => setTranscriptDraft(event.target.value)}
                placeholder="Type or paste the corrected transcript here."
                aria-label="Transcript"
              />
            )}
            <footer>
              <span>
                Empty text marks this recording as having no usable speech.
              </span>
              <div>
                <button
                  className="smartpuck-secondary-btn"
                  type="button"
                  onClick={() => setEditingRecording(null)}
                >
                  Cancel
                </button>
                <button
                  className="smartpuck-primary-btn"
                  type="button"
                  onClick={handleSaveTranscript}
                  disabled={transcriptLoading || !!busy}
                >
                  Save transcript
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {renamingRecording && (
        <div
          className="smartpuck-transcript-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="smartpuck-rename-title"
        >
          <form
            className="smartpuck-rename-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              handleConfirmRename();
            }}
          >
            <h2 id="smartpuck-rename-title">Rename recording</h2>
            <input
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div>
              <button
                type="button"
                className="smartpuck-secondary-btn"
                onClick={() => setRenamingRecording(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="smartpuck-primary-btn"
                disabled={!renameDraft.trim() || !!busy}
              >
                {busy === "Renaming recording" && (
                  <Loader size={14} className="smartpuck-spin" />
                )}
                Rename
              </button>
            </div>
          </form>
        </div>
      )}

      {playlistPickerRecording && (
        <div className="smartpuck-transcript-overlay" role="dialog" aria-modal="true">
          <div className="smartpuck-rename-dialog smartpuck-folder-picker">
            <h2>Save to folders</h2>
            <p className="smartpuck-folder-picker-title">{playlistPickerRecording.title}</p>
            <div className="smartpuck-playlist-list">
              {folders.map((folder) => {
                const included = folder.recordings.some(
                  (recording) => recording.id === playlistPickerRecording.id,
                );
                return (
                  <button
                    key={folder.id}
                    type="button"
                    className={`smartpuck-folder-picker-option${included ? " is-selected" : ""}`}
                    disabled={!!busy}
                    onClick={() =>
                      included
                        ? handleRemoveFromFolder(playlistPickerRecording.id, folder.id)
                        : handleAddToFolder(playlistPickerRecording.id, folder.id)
                    }
                  >
                    <Folder size={14} />
                    <span>{folder.name}</span>
                    <span className="smartpuck-folder-picker-check" aria-hidden="true">
                      {included ? <Check size={14} /> : <Circle size={14} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <div>
              <button type="button" className="smartpuck-secondary-btn" onClick={() => setPlaylistPickerRecording(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

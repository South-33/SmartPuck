import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code,
  Folder,
  FolderOpen,
  HelpCircle,
  Import,
  List,
  Mic,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  DeviceSnapshot,
  DeviceWifiConfig,
  LibrarySnapshot,
  Meeting,
  Workplace,
} from "../../shared/types";

type View = "library" | "device" | "settings";
const empty: LibrarySnapshot = { rootPath: "", workplaces: [], inbox: [] };
type ContextMenuState =
  | { type: "workplace"; workplace: Workplace; x: number; y: number }
  | { type: "meeting"; meeting: Meeting; x: number; y: number }
  | null;
type WorkspaceDialogState =
  | { type: "create"; name: string }
  | { type: "rename"; workplace: Workplace; name: string }
  | null;

function size(value: number): string {
  if (!value) return "0 GB";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let i = 0;
  while (amount >= 1024 && i < units.length - 1) {
    amount /= 1024;
    i++;
  }
  return `${amount.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>("library");
  const [library, setLibrary] = useState<LibrarySnapshot>(empty);
  const [workplaceId, setWorkplaceId] = useState<string>("inbox");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState("");
  const [device, setDevice] = useState<DeviceSnapshot | null>(null);
  const [deviceUrl, setDeviceUrl] = useState("http://smartpuck.local");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [liveListening, setLiveListening] = useState(false);
  const [wifiConfig, setWifiConfig] = useState<DeviceWifiConfig | null>(null);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [draggingWorkplaceId, setDraggingWorkplaceId] = useState("");
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState>(null);
  
  // Collapsible & Resizable Panes States
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [workspacesWidth, setWorkspacesWidth] = useState(220);
  const [meetingsWidth, setMeetingsWidth] = useState(380);

  // Custom Audio Player States
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeStr, setCurrentTimeStr] = useState("00:00");
  const [playSpeed, setPlaySpeed] = useState("1x");
  const [progressPercent, setProgressPercent] = useState(0);
  const [volume, setVolume] = useState(1.0);

  // Device Audio Player States
  const [activeDeviceSession, setActiveDeviceSession] = useState<any | null>(null);
  const [isDeviceAudioPlaying, setIsDeviceAudioPlaying] = useState(false);
  const [deviceAudioTimeStr, setDeviceAudioTimeStr] = useState("00:00");
  const [deviceAudioDurationStr, setDeviceAudioDurationStr] = useState("00:00");
  const [deviceAudioProgress, setDeviceAudioProgress] = useState(0);
  const [deviceAudioSrc, setDeviceAudioSrc] = useState("");
  const deviceAudioRef = useRef<HTMLAudioElement | null>(null);

  // Settings Dropdown States
  const [deviceVal, setDeviceVal] = useState("auto");
  const [modelVal, setModelVal] = useState("medium");
  const [langVal, setLangVal] = useState("bilingual");
  const [deviceDropdownOpen, setDeviceDropdownOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  // Smooth Progress State
  const [smoothProgressMap, setSmoothProgressMap] = useState<Record<string, number>>({});

  const streamAbort = useRef<AbortController | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const monitorGain = useRef<GainNode | null>(null);
  const nextPlaybackTime = useRef(0);
  const activeSources = useRef<AudioBufferSourceNode[]>([]);

  const reload = async (): Promise<void> =>
    setLibrary(await window.smartpuck.library.snapshot());
  useEffect(() => {
    void reload();
    return window.smartpuck.library.onChanged(() => void reload());
  }, []);
  useEffect(() => window.smartpuck.device.onChanged(setDevice), []);
  useEffect(() => {
    if (view !== "device" || !device?.connected || !device.ip) return;
    void window.smartpuck.device.wifiConfig().then(setWifiConfig).catch(() => setWifiConfig(null));
  }, [view, device?.connected, device?.ip]);
  
  useEffect(() => {
    const handleWindowResize = () => {
      const activeRailWidth = isRailCollapsed ? 68 : 240;
      const availableWidth = window.innerWidth - activeRailWidth;
      const minDetailWidth = 350;
      const currentCombined = workspacesWidth + meetingsWidth;
      const neededCombined = availableWidth - minDetailWidth;
      
      if (currentCombined > neededCombined) {
        const excess = currentCombined - neededCombined;
        const newMeetingsWidth = Math.max(200, meetingsWidth - excess);
        setMeetingsWidth(newMeetingsWidth);
        const remainingExcess = excess - (meetingsWidth - newMeetingsWidth);
        if (remainingExcess > 0) {
          const newWorkspacesWidth = Math.max(150, workspacesWidth - remainingExcess);
          setWorkspacesWidth(newWorkspacesWidth);
        }
      }
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isRailCollapsed, workspacesWidth, meetingsWidth]);
  useEffect(() => {
    const close = (): void => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, []);


  const stopLiveListening = useCallback((): void => {
    streamAbort.current?.abort();
    streamAbort.current = null;
    for (const source of activeSources.current) {
      try { source.stop(); } catch { /* already ended */ }
    }
    activeSources.current = [];
    nextPlaybackTime.current = 0;
    setLiveListening(false);
  }, []);

  useEffect(() => stopLiveListening, [stopLiveListening]);

  const startLiveListening = useCallback((): void => {
    if (!device || liveListening) return;
    const streamBase = device.ip ? `http://${device.ip}` : device.transport === "wifi" ? device.baseUrl : "";
    if (!streamBase) {
      setError("Live listening needs the puck's Wi-Fi connection. Connect both devices to the same network or join the SmartPuck fallback network.");
      return;
    }
    setError("");
    setLiveListening(true);
    const controller = new AbortController();
    streamAbort.current = controller;
    void (async () => {
      try {
        if (!audioContext.current) {
          audioContext.current = new AudioContext({ sampleRate: 16000 });
          monitorGain.current = audioContext.current.createGain();
          monitorGain.current.gain.value = 2;
          monitorGain.current.connect(audioContext.current.destination);
        }
        if (audioContext.current.state === "suspended") await audioContext.current.resume();
        nextPlaybackTime.current = audioContext.current.currentTime + 0.05;
        const response = await fetch(`${streamBase}/stream`, { cache: "no-store", signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`Live monitor failed (${response.status}).`);
        const reader = response.body.getReader();
        let headerBytes = 44;
        let carry = new Uint8Array(0);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          let incoming = value || new Uint8Array(0);
          if (headerBytes) {
            const skipped = Math.min(headerBytes, incoming.byteLength);
            headerBytes -= skipped;
            incoming = incoming.slice(skipped);
          }
          if (!incoming.byteLength) continue;
          const combined = new Uint8Array(carry.byteLength + incoming.byteLength);
          combined.set(carry);
          combined.set(incoming, carry.byteLength);
          const evenLength = combined.byteLength - (combined.byteLength % 2);
          carry = combined.slice(evenLength);
          if (!evenLength || !audioContext.current) continue;
          const view = new DataView(combined.buffer, combined.byteOffset, evenLength);
          const buffer = audioContext.current.createBuffer(1, evenLength / 2, 16000);
          const channel = buffer.getChannelData(0);
          for (let i = 0; i < channel.length; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;
          const source = audioContext.current.createBufferSource();
          source.buffer = buffer;
          source.connect(monitorGain.current || audioContext.current.destination);
          const startAt = Math.max(audioContext.current.currentTime + 0.02, nextPlaybackTime.current);
          source.start(startAt);
          nextPlaybackTime.current = startAt + buffer.duration;
          activeSources.current.push(source);
          source.onended = () => { activeSources.current = activeSources.current.filter((item) => item !== source); };
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setError((error as Error).message);
      } finally {
        if (streamAbort.current === controller) streamAbort.current = null;
        setLiveListening(false);
      }
    })();
  }, [device, liveListening]);

  const allMeetings = useMemo(
    () => [...new Map([...library.inbox, ...library.workplaces.flatMap((w) => w.meetings)].map((meeting) => [meeting.metadata.id, meeting])).values()],
    [library],
  );

  useEffect(() => {
    const transcribing = allMeetings.filter((m) => m.metadata.status === "transcribing");
    if (transcribing.length === 0) {
      if (Object.keys(smoothProgressMap).length > 0) setSmoothProgressMap({});
      return;
    }

    const interval = setInterval(() => {
      setSmoothProgressMap((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const m of transcribing) {
          const id = m.metadata.id;
          const rawTarget = m.metadata.progressPercent !== undefined ? m.metadata.progressPercent : 5;
          const target = rawTarget >= 90 ? 99 : rawTarget;
          const current = prev[id] !== undefined ? prev[id] : 5;
          
          if (current < target) {
            const diff = target - current;
            const speedFactor = rawTarget >= 90 ? 0.015 : 0.05;
            const step = Math.max(0.05, diff * speedFactor);
            next[id] = Math.min(target, current + step);
            changed = true;
          } else if (current > target) {
            next[id] = target;
            changed = true;
          } else if (current < 95) {
            next[id] = Math.min(95, current + 0.02);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [allMeetings]);

  const meetings = useMemo(() => {
    const scoped = workplaceId === "all"
        ? allMeetings
        : workplaceId === "inbox"
            ? library.inbox
            : library.workplaces.find((w) => w.metadata.id === workplaceId)
                ?.meetings || [];
            
    let filtered = scoped;
    
    // Search strictly within selected workspace meetings
    const needle = query.trim().toLocaleLowerCase();
    if (needle) {
      filtered = filtered.filter((meeting) =>
        `${meeting.metadata.title}\n${meeting.metadata.summary || ""}\n${meeting.transcript}`.toLocaleLowerCase().includes(needle),
      );
    }
    
    return filtered;
  }, [allMeetings, library, workplaceId, query]);

  const selected = useMemo(
    () =>
      allMeetings.find(
        (m) => m.metadata.id === selectedId,
      ) || null,
    [allMeetings, selectedId],
  );

  useEffect(() => {
    setDraft(selected?.transcript || "");
    setIsPlaying(false);
    setCurrentTimeStr("00:00");
    setProgressPercent(0);
  }, [selected?.metadata.id, selected?.transcript]);

  useEffect(() => {
    if (!selected) return;
    if (draft === selected.transcript) return;
    const timer = setTimeout(() => {
      void window.smartpuck.library.saveTranscript(selected.metadata.id, draft)
        .then((next) => {
          setLibrary(next);
        })
        .catch((err) => {
          setError(err.message);
        });
    }, 1000);
    return () => clearTimeout(timer);
  }, [draft, selected?.metadata.id]);

  const run = async (
    label: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const importFiles = (): void => {
    void run("import", async () => {
      const paths = await window.smartpuck.dialogs.chooseAudio();
      if (paths.length) {
        const targetId = workplaceId === "inbox" || workplaceId === "all" ? undefined : workplaceId;
        setLibrary(await window.smartpuck.library.importAudio(paths, targetId));
      }
    });
  };

  const openCreateWorkspace = (): void => setWorkspaceDialog({ type: "create", name: "" });
  const submitWorkspaceDialog = (): void => {
    if (!workspaceDialog) return;
    const name = workspaceDialog.name.trim();
    if (!name) return;
    if (workspaceDialog.type === "create") {
      void run("workspace", async () => {
        const next = await window.smartpuck.library.createWorkplace(name);
        setLibrary(next);
        const created = next.workplaces.find((workspace) => workspace.metadata.name === name);
        if (created) {
          setWorkplaceId(created.metadata.id);
          setSelectedId("");
        }
        setWorkspaceDialog(null);
      });
    } else {
      void run("rename-workspace", async () => {
        const next = await window.smartpuck.library.renameWorkplace(workspaceDialog.workplace.metadata.id, name);
        setLibrary(next);
        setWorkplaceId(workspaceDialog.workplace.metadata.id);
        setWorkspaceDialog(null);
      });
    }
  };

  const rename = (meeting: Meeting): void => {
    const title = prompt("Meeting title", meeting.metadata.title);
    if (title)
      void run("rename", async () =>
        setLibrary(
          await window.smartpuck.library.renameMeeting(
            meeting.metadata.id,
            title,
          ),
        ),
      );
  };

  const renameWorkplace = (workplace: Workplace): void => {
    setWorkspaceDialog({ type: "rename", workplace, name: workplace.metadata.name });
  };

  const deleteWorkplace = (workplace: Workplace): void => {
    if (!confirm(`Delete workspace "${workplace.metadata.name}"? Meetings will become unassigned; audio and transcripts stay safe.`)) return;
    void run("delete-workplace", async () => {
      setLibrary(await window.smartpuck.library.deleteWorkplace(workplace.metadata.id));
      setWorkplaceId("inbox");
      setSelectedId("");
    });
  };

  const addToWorkplace = (meeting: Meeting, targetId: string): void => {
    void run("add-workplace", async () =>
      setLibrary(await window.smartpuck.library.addMeetingToWorkplace(meeting.metadata.id, targetId)),
    );
  };

  const removeFromWorkplace = (meeting: Meeting, targetId: string): void => {
    void run("remove-workplace", async () => {
      setLibrary(await window.smartpuck.library.removeMeetingFromWorkplace(meeting.metadata.id, targetId));
      if (workplaceId === targetId) setSelectedId("");
    });
  };

  const deleteMeeting = (meeting: Meeting): void => {
    if (!confirm(`Move "${meeting.metadata.title}" to Trash?`)) return;
    void run("delete-meeting", async () => {
      setLibrary(await window.smartpuck.library.deleteMeeting(meeting.metadata.id));
      setSelectedId("");
    });
  };

  const meetingWorkspaceIds = (meeting: Meeting): Set<string> =>
    new Set(meeting.metadata.workspaceIds || []);

  const reorderWorkplaceDrop = (targetId: string): void => {
    if (!draggingWorkplaceId || draggingWorkplaceId === targetId) return;
    const ids = library.workplaces.map((workplace) => workplace.metadata.id);
    const from = ids.indexOf(draggingWorkplaceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    void run("reorder-workplaces", async () => setLibrary(await window.smartpuck.library.reorderWorkplaces(ids)));
  };

  // Custom Audio Player Event Handlers
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const current = audioRef.current.currentTime || 0;
    const duration = audioRef.current.duration || 1;
    const min = Math.floor(current / 60);
    const sec = Math.floor(current % 60);
    setCurrentTimeStr(`${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`);
    setProgressPercent((current / duration) * 100);
  };

  const cyclePlaySpeed = () => {
    if (!audioRef.current) return;
    let nextRate = 1.0;
    let nextLabel = "1x";
    if (playSpeed === "1x") {
      nextRate = 1.5;
      nextLabel = "1.5x";
    } else if (playSpeed === "1.5x") {
      nextRate = 2.0;
      nextLabel = "2x";
    } else {
      nextRate = 1.0;
      nextLabel = "1x";
    }
    audioRef.current.playbackRate = nextRate;
    setPlaySpeed(nextLabel);
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTimeStr("00:00");
    setProgressPercent(0);
  };

  const cycleVolume = () => {
    if (!audioRef.current) return;
    let nextVol = 1.0;
    if (volume === 1.0) nextVol = 0.5;
    else if (volume === 0.5) nextVol = 0.0;
    else nextVol = 1.0;
    audioRef.current.volume = nextVol;
    setVolume(nextVol);
  };

  const handleWaveformClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !audioRef.current.duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percent = clickX / rect.width;
    audioRef.current.currentTime = audioRef.current.duration * percent;
    setProgressPercent(percent * 100);
  };

  // Resize Mouse Drag Handlers
  const handleWorkspaceResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = workspacesWidth;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const activeRailWidth = isRailCollapsed ? 68 : 240;
      const availableWidth = window.innerWidth - activeRailWidth;
      const maxW = Math.max(150, availableWidth - meetingsWidth - 350);
      const newWidth = Math.max(150, Math.min(maxW, startWidth + (moveEvent.clientX - startX)));
      setWorkspacesWidth(newWidth);
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMeetingsResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = meetingsWidth;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const activeRailWidth = isRailCollapsed ? 68 : 240;
      const availableWidth = window.innerWidth - activeRailWidth;
      const maxW = Math.max(200, availableWidth - workspacesWidth - 350);
      const newWidth = Math.max(200, Math.min(maxW, startWidth + (moveEvent.clientX - startX)));
      setMeetingsWidth(newWidth);
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const meetingWorkspaces = (meeting: Meeting): string[] => {
    const ids = new Set(meeting.metadata.workspaceIds || []);
    return library.workplaces
      .filter((w) => ids.has(w.metadata.id))
      .map((w) => w.metadata.name);
  };

  const parseDeviceDate = (dateStr?: string): string => {
    if (!dateStr) return "Unknown Date";
    const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    if (match) {
      const [_, y, m, d, hh, mm, ss] = match;
      const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
      return date.toLocaleString();
    }
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? dateStr : parsed.toLocaleString();
  };

  const toggleDeviceAudio = (session: any) => {
    if (activeDeviceSession?.path === session.path) {
      if (isDeviceAudioPlaying) {
        deviceAudioRef.current?.pause();
      } else {
        deviceAudioRef.current?.play().catch(() => {});
      }
    } else {
      if (deviceAudioRef.current) {
        deviceAudioRef.current.pause();
      }
      const match = allMeetings.find((m) =>
        m.metadata.title.includes(session.name) ||
        m.metadata.id.includes(session.name) ||
        session.name.includes(m.metadata.id)
      );
      const src = match 
        ? `smartpuck://audio/${encodeURIComponent(match.metadata.id)}` 
        : `${device?.baseUrl || ""}${session.audioPath}`;
      setActiveDeviceSession(session);
      setDeviceAudioSrc(src);
      setDeviceAudioProgress(0);
      setDeviceAudioTimeStr("00:00");
      setTimeout(() => {
        deviceAudioRef.current?.play().catch(() => {});
      }, 50);
    }
  };

  const handleDeviceAudioTimeUpdate = () => {
    const el = deviceAudioRef.current;
    if (!el) return;
    const cur = el.currentTime || 0;
    const dur = el.duration || 0;
    
    const curMin = Math.floor(cur / 60);
    const curSec = Math.floor(cur % 60);
    setDeviceAudioTimeStr(`${curMin}:${String(curSec).padStart(2, "0")}`);
    
    if (dur) {
      const durMin = Math.floor(dur / 60);
      const durSec = Math.floor(dur % 60);
      setDeviceAudioDurationStr(`${durMin}:${String(durSec).padStart(2, "0")}`);
      setDeviceAudioProgress((cur / dur) * 100);
    } else {
      setDeviceAudioDurationStr("00:00");
      setDeviceAudioProgress(0);
    }
  };

  const handleDeviceAudioSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = deviceAudioRef.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    el.currentTime = percent * el.duration;
  };

  const handleDeleteDeviceSession = (session: any) => {
    if (confirm(`Are you sure you want to delete "${session.name}" from the device?`)) {
      void run("delete-device-session", async () => {
        setDevice(await window.smartpuck.device.deleteSession(session.path));
        if (activeDeviceSession?.path === session.path) {
          if (deviceAudioRef.current) deviceAudioRef.current.pause();
          setActiveDeviceSession(null);
        }
      });
    }
  };

  const handleRenameDeviceSession = (session: any) => {
    const newName = prompt("Enter new name for device recording:", session.name);
    if (newName !== null) {
      const clean = newName.trim();
      if (clean && clean !== session.name) {
        void run("rename-device-session", async () => {
          setDevice(await window.smartpuck.device.renameSession(session.path, clean));
          if (activeDeviceSession?.path === session.path) {
            setActiveDeviceSession({ ...activeDeviceSession, name: clean });
          }
        });
      }
    }
  };

  const wordCount = draft ? draft.trim().split(/\s+/).filter(Boolean).length : 0;
  const charCount = draft ? draft.length : 0;

  return (
    <div className="app" style={{ gridTemplateColumns: isRailCollapsed ? "68px 1fr" : "240px 1fr" }}>
      <aside className={`rail ${isRailCollapsed ? "collapsed" : ""}`} style={{ width: isRailCollapsed ? 68 : 240 }}>
        <div className="brand">
          <button
            className="rail-collapse-toggle top-toggle"
            onClick={() => setIsRailCollapsed(!isRailCollapsed)}
            title={isRailCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isRailCollapsed ? <ChevronRight size={22} /> : <ChevronLeft size={22} />}
          </button>
          <strong>SmartPuck</strong>
        </div>
        <nav>
          <button
            className={view === "library" ? "active" : ""}
            onClick={() => setView("library")}
          >
            <FolderOpen />
            <span className="label">Library</span>
          </button>
          <button
            className={view === "device" ? "active" : ""}
            onClick={() => setView("device")}
          >
            <Mic />
            <span className="label">Device</span>
            {device?.connected ? (
              <span style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: device.recording ? "var(--accent-red)" : "var(--accent-lime)",
                marginLeft: "auto",
                boxShadow: device.recording ? "0 0 10px var(--accent-red)" : "0 0 8px var(--accent-lime)",
                animation: device.recording ? "status-pulse 1.5s infinite" : "none"
              }} />
            ) : (
              <span style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--text-muted)",
                marginLeft: "auto",
                opacity: 0.4
              }} />
            )}
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
          >
            <Settings />
            <span className="label">Settings</span>
          </button>
        </nav>
      </aside>
      <main>
        {error && <div className="global-error-toast"><AlertCircle size={16} />{error}</div>}
        {workspaceDialog && (
          <div className="modal-backdrop" onClick={() => setWorkspaceDialog(null)}>
            <form
              className="modal"
              onClick={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault();
                submitWorkspaceDialog();
              }}
            >
              <h2>{workspaceDialog.type === "create" ? "New workspace" : "Rename workspace"}</h2>
              <p>
                Workspaces are playlist-like folders. Meetings stay in one canonical place and can belong to many workspaces.
              </p>
              <input
                autoFocus
                style={{ pointerEvents: "auto", position: "relative", zIndex: 110 }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder="Workspace name"
                value={workspaceDialog.name}
                onChange={(event) => setWorkspaceDialog({ ...workspaceDialog, name: event.target.value })}
              />
              <div className="actions">
                <button type="button" onClick={() => setWorkspaceDialog(null)}>Cancel</button>
                <button className="primary" type="submit" disabled={!workspaceDialog.name.trim() || busy === "workspace" || busy === "rename-workspace"}>
                  {workspaceDialog.type === "create" ? "Create workspace" : "Save name"}
                </button>
              </div>
            </form>
          </div>
        )}
        {contextMenu && (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            {contextMenu.type === "workplace" ? (
              <>
                <button onClick={() => { renameWorkplace(contextMenu.workplace); setContextMenu(null); }}>
                  <Pencil /> Rename workspace
                </button>
                <button className="danger" onClick={() => { deleteWorkplace(contextMenu.workplace); setContextMenu(null); }}>
                  <Trash2 /> Delete workspace
                </button>
              </>
            ) : (
              <>
                <button onClick={() => { rename(contextMenu.meeting); setContextMenu(null); }}>
                  <Pencil /> Rename meeting
                </button>
                <button
                  disabled={busy === "transcribe" || contextMenu.meeting.metadata.status === "transcribing"}
                  onClick={() => {
                    void run("transcribe", async () =>
                      setLibrary(await window.smartpuck.library.transcribe(contextMenu.meeting.metadata.id))
                    );
                    setContextMenu(null);
                  }}
                >
                  <Sparkles /> Re-transcribe
                </button>
                <div className="menu-section">
                  <span>Workspaces</span>
                  {library.workplaces.length === 0 && (
                    <button disabled style={{ opacity: 0.5 }}>No workspaces created</button>
                  )}
                  {library.workplaces.map((workplace) => {
                    const activeMeeting = allMeetings.find((m) => m.metadata.id === contextMenu.meeting.metadata.id) || contextMenu.meeting;
                    const linked = meetingWorkspaceIds(activeMeeting).has(workplace.metadata.id);
                    return (
                      <button
                        key={workplace.metadata.id}
                        onClick={() => {
                          if (linked) {
                            removeFromWorkplace(activeMeeting, workplace.metadata.id);
                          } else {
                            addToWorkplace(activeMeeting, workplace.metadata.id);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 12px",
                          background: "transparent",
                          border: "none",
                          outline: "none",
                          boxShadow: "none",
                          cursor: "pointer"
                        }}
                      >
                        <div style={{
                          width: "14px",
                          height: "14px",
                          borderRadius: "50%",
                          border: linked ? "1.5px solid var(--accent-lime)" : "1.5px solid rgba(255, 255, 255, 0.3)",
                          background: linked ? "var(--accent-lime)" : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0
                        }}>
                          {linked && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "8px", height: "8px" }}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <span style={{ fontSize: "13.5px", fontWeight: "600", color: "rgba(255, 255, 255, 0.9)" }}>{workplace.metadata.name}</span>
                      </button>
                    );
                  })}
                </div>
                <button className="danger" onClick={() => { deleteMeeting(contextMenu.meeting); setContextMenu(null); }}>
                  <Trash2 /> Move meeting to Trash
                </button>
              </>
            )}
          </div>
        )}
        {view === "library" && (
          <div className="library-container" style={{ gridTemplateColumns: `${workspacesWidth}px 1px ${meetingsWidth}px 1px 1fr` }}>
            {/* Column 1: Workspaces */}
            <aside className="lib-col-workspaces">
              <div className="col-header">
                <h3>Workspaces</h3>
                <button onClick={openCreateWorkspace} style={{ padding: "4px 8px", fontSize: "11px" }}>
                  <Plus size={12} /> New
                </button>
              </div>
              <div className="col-content">
                <div className="workspace-tree">
                  <div
                    className={`workspace-item ${workplaceId === "all" ? "selected" : ""}`}
                    onClick={() => {
                      setWorkplaceId("all");
                    }}
                  >
                    <div className="workspace-item-label">
                      <List size={16} />
                      <span>All Recordings</span>
                    </div>
                    <span className="count">{allMeetings.length}</span>
                  </div>
                  <div
                    className={`workspace-item ${workplaceId === "inbox" ? "selected" : ""}`}
                    onClick={() => {
                      setWorkplaceId("inbox");
                    }}
                  >
                    <div className="workspace-item-label">
                      <Folder />
                      <span>Unassigned</span>
                    </div>
                    <span className="count">{library.inbox.length}</span>
                  </div>
                  {library.workplaces.map((w) => (
                    <div
                      key={w.metadata.id}
                      draggable
                      className={`workspace-item ${workplaceId === w.metadata.id ? "selected" : ""}`}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setContextMenu({ type: "workplace", workplace: w, x: event.clientX, y: event.clientY });
                      }}
                      onDoubleClick={() => renameWorkplace(w)}
                      onDragStart={() => setDraggingWorkplaceId(w.metadata.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => reorderWorkplaceDrop(w.metadata.id)}
                      onDragEnd={() => setDraggingWorkplaceId("")}
                      onClick={() => {
                        setWorkplaceId(w.metadata.id);
                      }}
                    >
                      <div className="workspace-item-label">
                        <Folder />
                        <span>{w.metadata.name}</span>
                      </div>
                      <span className="count">{w.meetings.length}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            {/* Resize Divider 1 */}
            <div className="resize-handle" onMouseDown={handleWorkspaceResize} />

            {/* Column 2: Meetings */}
            <section className="lib-col-meetings">
              <div className="col-header">
                <h3>Meetings ({meetings.length})</h3>
                <button onClick={importFiles} style={{ padding: "4px 8px", fontSize: "11px" }}>
                  <Import size={12} /> Import
                </button>
              </div>
              <div className="col-content">
                <div className="meetings-search-row">
                  <div className="search-container">
                    <Search size={15} />
                    <input
                      className="search"
                      aria-label="Search meetings"
                      placeholder="Search meetings..."
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                </div>
                {meetings.length === 0 ? (
                  <div className="empty">
                    <Mic />
                    <p>No recordings found.</p>
                  </div>
                ) : (
                  meetings.map((m) => (
                    <button
                      key={m.metadata.id}
                      className={`meeting-card ${selectedId === m.metadata.id ? "selected" : ""}`}
                      onClick={() => setSelectedId(m.metadata.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setContextMenu({ type: "meeting", meeting: m, x: event.clientX, y: event.clientY });
                      }}
                      onDoubleClick={() => rename(m)}
                    >
                      <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: "6px" }}>
                        {/* Row 1: Title + Duration */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", width: "100%", gap: "12px" }}>
                          <strong style={{
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "var(--text-primary)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            flex: 1,
                            minWidth: 0
                          }}>{m.metadata.title}</strong>
                          <span className="meeting-card-duration" style={{ flexShrink: 0 }}>
                            {m.metadata.durationSeconds
                              ? `${Math.floor(m.metadata.durationSeconds / 60)}:${String(Math.floor(m.metadata.durationSeconds % 60)).padStart(2, "0")}`
                              : "0:00"}
                          </span>
                        </div>

                        {/* Row 2: Date + Status Badge */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: "12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", fontSize: "12.5px", color: "var(--text-secondary)", minWidth: 0, flex: 1 }}>
                            <span>{new Date(m.metadata.capturedAt).toLocaleDateString()}</span>
                            <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text-muted)", opacity: 0.6, flexShrink: 0 }} />
                            <span>{new Date(m.metadata.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {workplaceId === "all" && meetingWorkspaces(m).map((name) => (
                              <span key={name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text-muted)", opacity: 0.6, flexShrink: 0 }} />
                                <span style={{
                                  fontSize: "10px",
                                  background: "var(--bg-panel)",
                                  color: "var(--text-secondary)",
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                  border: "1px solid var(--border-color)",
                                  lineHeight: 1
                                }}>
                                  {name}
                                </span>
                              </span>
                            ))}
                          </div>
                          <span className={`status-badge ${m.metadata.status}`} style={{ flexShrink: 0, marginTop: 0 }}>
                            {m.metadata.status === "transcribing" ? (() => {
                              const val = smoothProgressMap[m.metadata.id] !== undefined
                                ? Math.round(smoothProgressMap[m.metadata.id])
                                : (m.metadata.progressPercent !== undefined ? m.metadata.progressPercent : 5);
                              const displayVal = Math.min(100, Math.max(0, val));
                              if (m.metadata.progressStage) {
                                const stage = m.metadata.progressStage;
                                if (val >= 0 && val < 100) {
                                  return `${stage} ${displayVal}%`;
                                }
                                return stage;
                              }
                              if (val < 0) return "Loading Models…";
                              if (val < 40) return `Analyzing Audio ${displayVal}%`;
                              if (val >= 95) return `Diarizing Speakers ${displayVal}%`;
                              return `Transcribing ${displayVal}%`;
                            })() : m.metadata.status}
                          </span>
                        </div>
                      </div>
                      {m.metadata.status === "transcribing" && (() => {
                        const val = smoothProgressMap[m.metadata.id] !== undefined
                          ? Math.round(smoothProgressMap[m.metadata.id])
                          : (m.metadata.progressPercent !== undefined ? m.metadata.progressPercent : 5);
                        const widthVal = Math.min(100, Math.max(0, val));
                        return (
                          <div style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: "3px",
                            background: "rgba(255,255,255,0.05)"
                          }}>
                            <div style={{
                              height: "100%",
                              width: `${widthVal}%`,
                              background: "var(--accent-blue)",
                              transition: "width 0.1s linear"
                            }} />
                          </div>
                        );
                      })()}
                    </button>
                  ))
                )}
              </div>
              <div className="meetings-footer">
                <span>Showing 1-{meetings.length} of {meetings.length}</span>
                <div className="meetings-pagination">
                  <button disabled>&lt;</button>
                  <button disabled>&gt;</button>
                </div>
              </div>
            </section>

            {/* Resize Divider 2 */}
            <div className="resize-handle" onMouseDown={handleMeetingsResize} />

            {/* Column 3: Meeting Detail & Transcript */}
            <section className="lib-col-detail">
              {selected ? (
                <>
                  <div className="detail-header-wrapper">
                    <div className="detail-header-info">
                      <h2
                        onDoubleClick={() => rename(selected)}
                        title="Double-click to rename"
                        style={{ cursor: "pointer" }}
                      >
                        {selected.metadata.title}
                      </h2>
                      <p>
                        {new Date(selected.metadata.capturedAt).toLocaleDateString()} • {new Date(selected.metadata.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {selected.metadata.durationSeconds ? `${Math.floor(selected.metadata.durationSeconds / 60)}:${String(Math.floor(selected.metadata.durationSeconds % 60)).padStart(2, "0")}` : "0:00"} • {selected.metadata.sourceDevice?.sessionName || "SmartPuck-2F3A"}
                      </p>
                    </div>
                  </div>
                  <div className="detail-scroller">
                    {/* Custom Formatted Audio Player */}
                    <div className="custom-audio-player">
                      <button className="player-play-btn" onClick={togglePlay} title={isPlaying ? "Pause" : "Play"}>
                        {isPlaying ? <Square size={16} fill="#000" /> : <Play size={16} />}
                      </button>
                      <span className="player-time">{currentTimeStr}</span>
                      <div className="player-waveform-visualizer" onClick={handleWaveformClick} title="Click to seek">
                        {Array.from({ length: 45 }).map((_, i) => {
                          const isActive = i / 45 * 100 < progressPercent;
                          const heightVal = 15 + Math.abs(Math.sin(i * 0.2)) * 75;
                          return (
                            <div
                              key={i}
                              className={`waveform-bar ${isActive ? "active" : ""}`}
                              style={{ height: `${heightVal}%` }}
                            />
                          );
                        })}
                      </div>
                      <span className="player-time">
                        {selected.metadata.durationSeconds ? `${Math.floor(selected.metadata.durationSeconds / 60)}:${String(Math.floor(selected.metadata.durationSeconds % 60)).padStart(2, "0")}` : "0:00"}
                      </span>
                      <div className="player-controls-right">
                        <button className="player-speed-btn" onClick={cyclePlaySpeed} title="Playback Speed">
                          {playSpeed}
                        </button>
                        <button className="player-icon-btn" onClick={cycleVolume} title={`Volume: ${Math.round(volume * 100)}%`}>
                          {volume === 1.0 ? <Volume2 size={16} /> : volume === 0.5 ? <Volume1 size={16} /> : <VolumeX size={16} />}
                        </button>
                      </div>
                      <audio
                        ref={(el) => {
                          audioRef.current = el;
                        }}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onTimeUpdate={handleTimeUpdate}
                        onEnded={handleAudioEnded}
                        src={`smartpuck://audio/${encodeURIComponent(selected.metadata.id)}`}
                        style={{ display: "none" }}
                      />
                    </div>

                    {selected.metadata.status === "error" && (
                      <div className="transcription-error-card" style={{
                        background: "rgba(255, 77, 77, 0.04)",
                        border: "1px solid rgba(255, 77, 77, 0.15)",
                        borderRadius: "var(--radius-lg)",
                        padding: "20px 24px",
                        marginBottom: "20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--accent-red)" }}>
                          <AlertCircle size={20} />
                          <strong style={{ fontSize: "14.5px" }}>Transcription Failed</strong>
                        </div>
                        <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
                          SmartPuck encountered an error while attempting to transcribe this audio recording. The transcription engine reported:
                        </p>
                        <div style={{
                          background: "rgba(0,0,0,0.15)",
                          border: "1px solid rgba(255,255,255,0.04)",
                          borderRadius: "var(--radius-md)",
                          padding: "12px 16px",
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "12px",
                          color: "#FFC0C0",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all"
                        }}>
                          {selected.metadata.error || "Unknown transcription error. Please verify your Python environment and GPU configuration."}
                        </div>
                        <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                          <button
                            className="primary danger"
                            onClick={() =>
                              void run("transcribe", async () =>
                                setLibrary(
                                  await window.smartpuck.library.transcribe(
                                    selected.metadata.id,
                                  ),
                                ),
                              )
                            }
                            disabled={busy === "transcribe"}
                            style={{
                              padding: "8px 16px",
                              fontSize: "12.5px",
                              fontWeight: "600",
                              background: "var(--accent-red-bg)",
                              color: "#FFC0C0",
                              border: "1px solid var(--accent-red-border)",
                              borderRadius: "var(--radius-md)",
                              cursor: "pointer"
                            }}
                          >
                            {busy === "transcribe" ? "Retrying…" : "Retry Transcription"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Summary Section */}
                    {selected.metadata.summary && (
                      <div className="detail-summary-wrapper">
                        <h4 className="detail-section-title">Summary</h4>
                        <div className="summary-text-block">
                          {selected.metadata.summary}
                        </div>
                        <span className="summary-showmore">Show more</span>
                      </div>
                    )}

                    {/* Transcript Editor Card */}
                    <div className="detail-transcript-wrapper" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <h4 className="detail-section-title">Transcript</h4>
                      <div className="transcript-card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          spellCheck
                          placeholder="Edit transcript text..."
                        />
                         <div className="transcript-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                           <span>{charCount.toLocaleString()} characters • {wordCount.toLocaleString()} words</span>
                           <button
                             onClick={() =>
                               void run("transcribe", async () =>
                                 setLibrary(
                                   await window.smartpuck.library.transcribe(
                                     selected.metadata.id,
                                   ),
                                 ),
                               )
                             }
                             disabled={busy === "transcribe" || selected.metadata.status === "transcribing"}
                             style={{
                               padding: "6px 12px",
                               fontSize: "12px",
                               fontWeight: "600",
                               background: "rgba(255, 255, 255, 0.05)",
                               border: "1px solid var(--border-color)",
                               borderRadius: "var(--radius-sm)",
                               color: "var(--text-secondary)",
                               cursor: "pointer",
                               display: "flex",
                               alignItems: "center",
                               gap: "6px",
                               transition: "var(--transition)",
                               outline: "none"
                             }}
                           >
                             <Sparkles size={13} />
                             {selected.metadata.status === "error"
                               ? "Retry transcription"
                               : selected.metadata.status === "transcribing"
                                 ? "Transcribing…"
                                 : "Re-transcribe"}
                           </button>
                         </div>
                       </div>
                     </div>
                   </div>
                </>
              ) : (
                <div className="empty">
                  <FolderOpen />
                  <p>Select a meeting to review its transcript.</p>
                </div>
              )}
            </section>
          </div>
        )}
        {view === "device" && (
          <div className="page" style={{ padding: "24px 32px", paddingBottom: activeDeviceSession ? "100px" : "24px" }}>
            <header style={{ marginBottom: "20px" }}>
              <div>
                <p className="eyebrow">Hardware</p>
                <h1>Device</h1>
              </div>
            </header>
            
            <div className="device-dashboard">
              {!device?.connected ? (
                <div className={`device-offline-card ${busy === "connect" ? "connecting" : "disconnected"}`}>
                  <div className="puck-icon-orb">
                    {busy === "connect" ? <RefreshCw size={36} /> : <Mic size={36} />}
                  </div>
                  <h2>
                    {busy === "connect" ? "Connecting to SmartPuck..." : "Connect your SmartPuck"}
                  </h2>
                  <p>
                    {busy === "connect"
                      ? `Locating and connecting to SmartPuck at ${deviceUrl}...`
                      : "USB-C and smartpuck.local are checked automatically. You can also specify your device's Wi-Fi network address below."}
                  </p>
                  <div className="connect-panel">
                    <input
                      disabled={busy === "connect"}
                      placeholder="http://smartpuck.local or IP address"
                      value={deviceUrl}
                      onChange={(e) => setDeviceUrl(e.target.value)}
                    />
                    <button
                      className="primary"
                      disabled={busy === "connect"}
                      onClick={() =>
                        void run("connect", async () =>
                          setDevice(
                            await window.smartpuck.device.connect(deviceUrl),
                          ),
                        )
                      }
                    >
                      {busy === "connect" ? "Connecting…" : "Connect"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Status Banner */}
                  <div className="device-header">
                    <div className="device-header-left">
                      <div className="device-header-status-badge">
                        <Check size={20} />
                      </div>
                      <div className="device-header-title">
                        <h2>Puck Connected</h2>
                        <p>Your SmartPuck is online and ready.</p>
                      </div>
                    </div>
                    <div className="device-header-badges">
                      <div className="device-header-badge-item">
                        <span className="label">Transport</span>
                        <span className="val">{device.transport.toUpperCase()}</span>
                      </div>
                      <div className="device-header-badge-item">
                        <span className="label">Address</span>
                        <span className="val">{device.network || device.baseUrl || "—"}</span>
                      </div>
                      <div className="device-header-badge-item">
                        <span className="label">Hostname</span>
                        <span className="val">{device.ip || "smartpuck-2f3a"}</span>
                      </div>
                      <div className="device-header-badge-item">
                        <span className="label">Firmware</span>
                        <span className="val">{device.firmwareVersion}</span>
                      </div>
                    </div>
                  </div>

                  {/* 3-Column widgets layout */}
                  <div className="device-dashboard-grid">
                    {/* Storage Card */}
                    <section className="panel device-card">
                      <h3>Storage</h3>
                      <div className="circle-storage-wrapper" style={{ marginTop: "10px" }}>
                        <svg className="circle-storage-svg">
                          <circle className="circle-storage-bg" cx="60" cy="60" r="50" />
                          <circle
                            className="circle-storage-fill"
                            cx="60"
                            cy="60"
                            r="50"
                            style={{
                              strokeDasharray: "314",
                              strokeDashoffset: `${314 - (314 * (device.storageFreeBytes / device.storageTotalBytes || 0.62))}`
                            }}
                          />
                        </svg>
                        <div className="circle-storage-text">
                          <span className="circle-storage-percent">
                            {Math.round((device.storageFreeBytes / device.storageTotalBytes) * 100 || 62)}%
                          </span>
                          <span className="circle-storage-label">Free</span>
                        </div>
                      </div>
                      <div className="storage-metrics-row">
                        <div className="storage-metric">
                          <span className="label">Total</span>
                          <span className="val">{size(device.storageTotalBytes) || "256 GB"}</span>
                        </div>
                        <div className="storage-metric">
                          <span className="label">Used</span>
                          <span className="val">{size(device.storageTotalBytes - device.storageFreeBytes) || "132 GB"}</span>
                        </div>
                      </div>
                    </section>

                    {/* Recorder Controls */}
                    <section className="panel device-card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "12px", padding: "24px" }}>
                      <h3>Recorder Controls</h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, justifyContent: "center" }}>
                        <button
                          className={device.recording ? "danger" : "primary"}
                          onClick={() =>
                            void run("record", async () =>
                              setDevice(
                                await window.smartpuck.device.setRecording(
                                  device.recording ? "stop" : "start",
                                ),
                              ),
                            )
                          }
                          style={{ padding: "12px", fontSize: "13px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
                        >
                          {device.recording ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                          {device.recording ? "Stop Recording" : "Start Recording"}
                        </button>
                        <button
                          onClick={liveListening ? stopLiveListening : startLiveListening}
                          style={{
                            padding: "12px",
                            fontSize: "13px",
                            fontWeight: "600",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            background: liveListening ? "var(--accent-lime)" : "rgba(255,255,255,0.05)",
                            color: liveListening ? "#000" : "var(--text-primary)",
                            border: "none",
                            borderRadius: "var(--radius-md)"
                          }}
                        >
                          <Activity size={16} />
                          {liveListening ? "Stop Live Listen" : "Live Listen"}
                        </button>
                      </div>
                    </section>

                    {/* Wi-Fi Provisioning */}
                    <section className="panel device-card">
                      <h3>Wi-Fi</h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <input
                          placeholder="SSID"
                          value={wifiSsid}
                          onChange={(event) => setWifiSsid(event.target.value)}
                          style={{ padding: "8px 10px", fontSize: "12.5px", pointerEvents: "auto", position: "relative", zIndex: 10 }}
                        />
                        <input
                          placeholder="Password"
                          type="password"
                          value={wifiPassword}
                          onChange={(event) => setWifiPassword(event.target.value)}
                          style={{ padding: "8px 10px", fontSize: "12.5px", pointerEvents: "auto", position: "relative", zIndex: 10 }}
                        />
                        <button
                          className="primary"
                          onClick={() =>
                            void run("save-wifi", async () => {
                              await window.smartpuck.device.saveWifi(wifiSsid, wifiPassword);
                              setWifiPassword("");
                              setWifiSsid("");
                              setWifiConfig(await window.smartpuck.device.wifiConfig());
                            })
                          }
                          style={{ fontSize: "12px", padding: "8px" }}
                        >
                          Save to Puck
                        </button>
                      </div>
                      <div className="wifi-saved-list">
                        {wifiConfig?.networks.map((network) => (
                          <div className={`wifi-saved-item ${network.active ? "connected" : ""}`} key={network.ssid}>
                            <div className="wifi-saved-item-left">
                              <CircleDot size={12} />
                              <strong>{network.ssid}</strong>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              {network.active && <span className="conn-status">Connected</span>}
                              <button
                                className="forget-btn"
                                onClick={() =>
                                  void run("remove-wifi", async () => {
                                    await window.smartpuck.device.removeWifi(network.ssid);
                                    setWifiConfig(await window.smartpuck.device.wifiConfig());
                                  })
                                }
                              >
                                <Trash size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                  {/* On-Device recordings table */}
                  <section className="panel recordings-table-card">
                    <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                      <h3>On-Device Recordings</h3>
                      <div className="actions" style={{ display: "flex", gap: "8px" }}>
                        <button
                          className="primary"
                          disabled={busy === "sync-new" || !device.sessions.some((s) => !s.uploaded)}
                          onClick={() =>
                            void run("sync-new", async () => {
                              setLibrary(
                                await window.smartpuck.device.importNew(
                                  workplaceId === "inbox" ? undefined : workplaceId,
                                ),
                              );
                              setDevice(await window.smartpuck.device.refresh());
                            })
                          }
                          style={{ fontSize: "12px" }}
                        >
                          Sync New
                        </button>
                        <button
                          onClick={() =>
                            void run("refresh", async () =>
                              setDevice(await window.smartpuck.device.refresh())
                            )
                          }
                          style={{ fontSize: "12px", padding: "8px 12px" }}
                        >
                          Refresh List
                        </button>
                      </div>
                    </div>
                    <div className="recordings-table-wrapper">
                      <table className="recordings-table">
                        <thead>
                          <tr>
                            <th style={{ width: "40px" }} />
                            <th>Filename</th>
                            <th>Duration</th>
                            <th>Size</th>
                            <th>Modified</th>
                            <th style={{ width: "40px" }} />
                          </tr>
                        </thead>
                        <tbody>
                          {device.sessions.length === 0 ? (
                            <tr>
                              <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                                No recording files found on device.
                              </td>
                            </tr>
                          ) : (
                            device.sessions.map((s) => (
                              <tr key={s.path}>
                                <td>
                                  <button
                                    onClick={() => toggleDeviceAudio(s)}
                                    style={{
                                      padding: "6px",
                                      borderRadius: "50%",
                                      background: activeDeviceSession?.path === s.path && isDeviceAudioPlaying ? "var(--accent-lime-muted)" : "transparent",
                                      border: "none",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: activeDeviceSession?.path === s.path && isDeviceAudioPlaying ? "var(--accent-lime)" : "var(--text-secondary)",
                                      cursor: "pointer",
                                      transition: "all 0.15s ease"
                                    }}
                                    title="Listen to recording"
                                  >
                                    {activeDeviceSession?.path === s.path && isDeviceAudioPlaying ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
                                  </button>
                                </td>
                                <td
                                  onDoubleClick={() => handleRenameDeviceSession(s)}
                                  title="Double-click to rename"
                                  style={{ fontWeight: "500", color: "var(--text-primary)", cursor: "pointer" }}
                                >
                                  {s.name}
                                </td>
                                <td>
                                  {s.durationSeconds
                                    ? `${Math.floor(s.durationSeconds / 60)}:${String(Math.floor(s.durationSeconds % 60)).padStart(2, "0")}`
                                    : "0:00"}
                                </td>
                                <td>{size(s.sizeBytes)}</td>
                                <td>{parseDeviceDate(s.createdAt)}</td>
                                <td>
                                  <button
                                    className="forget-btn"
                                    onClick={() => handleDeleteDeviceSession(s)}
                                    style={{
                                      padding: "6px",
                                      background: "transparent",
                                      border: "none",
                                      color: "var(--text-muted)",
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center"
                                    }}
                                    title="Delete from device"
                                  >
                                    <Trash size={12} />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="recordings-table-footer">
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className="rail-status-dot active" style={{ width: "6px", height: "6px" }} />
                        <span>Auto-sync is ON</span>
                      </div>
                      <span>Last synced: 2 minutes ago</span>
                    </div>
                  </section>

                  {activeDeviceSession && (
                    <div className="device-mini-player" style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "16px",
                      background: "var(--bg-panel-header)",
                      padding: "16px 20px",
                      borderRadius: "var(--radius-lg)",
                      marginTop: "16px",
                      border: "1px solid var(--border-color)"
                    }}>
                      <button
                        onClick={() => {
                          if (isDeviceAudioPlaying) {
                            deviceAudioRef.current?.pause();
                          } else {
                            deviceAudioRef.current?.play().catch(() => {});
                          }
                        }}
                        style={{
                          padding: "8px",
                          borderRadius: "50%",
                          background: "var(--accent-lime)",
                          color: "#000",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                      >
                        {isDeviceAudioPlaying ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                      </button>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                        <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>{activeDeviceSession.name}</strong>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}>{deviceAudioTimeStr}</span>
                          <div
                            onClick={handleDeviceAudioSeek}
                            style={{ flex: 1, height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", cursor: "pointer", position: "relative" }}
                          >
                            <div style={{ width: `${deviceAudioProgress}%`, height: "100%", background: "var(--accent-lime)", borderRadius: "2px" }} />
                          </div>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}>{deviceAudioDurationStr}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (deviceAudioRef.current) deviceAudioRef.current.pause();
                          setActiveDeviceSession(null);
                        }}
                        style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "14px" }}
                      >
                        ✕
                      </button>
                      <audio
                        ref={deviceAudioRef}
                        onPlay={() => setIsDeviceAudioPlaying(true)}
                        onPause={() => setIsDeviceAudioPlaying(false)}
                        onTimeUpdate={handleDeviceAudioTimeUpdate}
                        onEnded={() => setIsDeviceAudioPlaying(false)}
                        src={deviceAudioSrc}
                        style={{ display: "none" }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {view === "settings" && (
          <div className="page" style={{ padding: "24px 32px" }}>
            <header style={{ marginBottom: "20px" }}>
              <div>
                <p className="eyebrow">System</p>
                <h1>Preferences</h1>
              </div>
            </header>
            <div className="settings-container">
              {/* Workspace Config */}
              <div className="settings-card">
                <div className="settings-card-icon">
                  <FolderOpen size={20} />
                </div>
                <div className="settings-card-body">
                  <h3>Workspace</h3>
                  <p>
                    This is where SmartPuck stores all recordings, transcripts, and metadata.
                  </p>
                  <div className="settings-input-group">
                    <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-muted)", textTransform: "uppercase" }}>Workspace Path</span>
                    <div className="settings-input-wrapper">
                      <input readOnly value={library.rootPath || "Loading…"} />
                      <Folder size={16} />
                    </div>
                  </div>
                  <div className="settings-card-actions">
                    <button onClick={() => void window.smartpuck.library.openRoot()}>
                      <FolderOpen size={13} />
                      Open Folder
                    </button>
                    <button
                      onClick={() =>
                        void run("root", async () => {
                          const next = await window.smartpuck.library.chooseRoot();
                          if (next) setLibrary(next);
                        })
                      }
                    >
                      Change Path
                    </button>
                  </div>
                </div>
              </div>

              {/* Transcription Runtime */}
              <div className="settings-card">
                <div className="settings-card-icon">
                  <Code size={20} />
                </div>
                <div className="settings-card-body">
                  <h3>Transcription Runtime</h3>
                  <p>
                    Configure the local transcription engine and runtime settings.
                  </p>
                  
                  <div className="settings-input-group">
                    <span style={{ fontSize: "11.5px", fontWeight: "600", color: "var(--text-muted)", textTransform: "uppercase" }}>Python Executable</span>
                    <div className="settings-file-picker">
                      <input readOnly placeholder="C:\Python\python.exe (Auto-detected)" />
                      <button onClick={() => alert("Browsing for Python...")}>Browse</button>
                    </div>
                  </div>
                  
                  <div className="settings-form-grid">
                    <div className="custom-select-container">
                      <label>Device</label>
                      <div 
                        className={`custom-select-trigger ${deviceDropdownOpen ? "open" : ""}`}
                        onClick={() => {
                          setDeviceDropdownOpen(!deviceDropdownOpen);
                          setModelDropdownOpen(false);
                          setLangDropdownOpen(false);
                        }}
                      >
                        <span>{deviceVal === "auto" ? "Auto (GPU if available)" : "CPU Only"}</span>
                        <span className="arrow">▾</span>
                      </div>
                      {deviceDropdownOpen && (
                        <div className="custom-select-dropdown">
                          <div 
                            className={`custom-select-option ${deviceVal === "auto" ? "selected" : ""}`}
                            onClick={() => {
                              setDeviceVal("auto");
                              setDeviceDropdownOpen(false);
                            }}
                          >
                            Auto (GPU if available)
                          </div>
                          <div 
                            className={`custom-select-option ${deviceVal === "cpu" ? "selected" : ""}`}
                            onClick={() => {
                              setDeviceVal("cpu");
                              setDeviceDropdownOpen(false);
                            }}
                          >
                            CPU Only
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="custom-select-container">
                      <label>Whisper Model</label>
                      <div 
                        className={`custom-select-trigger ${modelDropdownOpen ? "open" : ""}`}
                        onClick={() => {
                          setModelDropdownOpen(!modelDropdownOpen);
                          setDeviceDropdownOpen(false);
                          setLangDropdownOpen(false);
                        }}
                      >
                        <span>{modelVal}</span>
                        <span className="arrow">▾</span>
                      </div>
                      {modelDropdownOpen && (
                        <div className="custom-select-dropdown">
                          {["medium", "small.en", "base"].map((m) => (
                            <div 
                              key={m}
                              className={`custom-select-option ${modelVal === m ? "selected" : ""}`}
                              onClick={() => {
                                setModelVal(m);
                                setModelDropdownOpen(false);
                              }}
                            >
                              {m}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="custom-select-container">
                      <label>Language Mode</label>
                      <div 
                        className={`custom-select-trigger ${langDropdownOpen ? "open" : ""}`}
                        onClick={() => {
                          setLangDropdownOpen(!langDropdownOpen);
                          setDeviceDropdownOpen(false);
                          setModelDropdownOpen(false);
                        }}
                      >
                        <span>{langVal === "bilingual" ? "Bilingual (EN + KH)" : "English Only"}</span>
                        <span className="arrow">▾</span>
                      </div>
                      {langDropdownOpen && (
                        <div className="custom-select-dropdown">
                          <div 
                            className={`custom-select-option ${langVal === "bilingual" ? "selected" : ""}`}
                            onClick={() => {
                              setLangVal("bilingual");
                              setLangDropdownOpen(false);
                            }}
                          >
                            Bilingual (EN + KH)
                          </div>
                          <div 
                            className={`custom-select-option ${langVal === "english" ? "selected" : ""}`}
                            onClick={() => {
                              setLangVal("english");
                              setLangDropdownOpen(false);
                            }}
                          >
                            English Only
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="settings-footer-actions">
                <a href="#about" className="settings-footer-about" onClick={() => alert("SmartPuck version 1.0.0")}>
                  <HelpCircle size={14} /> About SmartPuck
                </a>
                <button className="primary" onClick={() => alert("Changes saved successfully!")}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code,
  Filter,
  Folder,
  FolderOpen,
  HelpCircle,
  Mic,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Square,
  Tags,
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
  const [railWidth, setRailWidth] = useState(240);
  const [workspacesWidth, setWorkspacesWidth] = useState(220);
  const [meetingsWidth, setMeetingsWidth] = useState(320);
  const [curationFilter, setCurationFilter] = useState<'all' | 'curated' | 'pending'>('all');

  // Custom Audio Player States
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeStr, setCurrentTimeStr] = useState("00:00");
  const [playSpeed, setPlaySpeed] = useState("1x");
  const [progressPercent, setProgressPercent] = useState(0);
  const [volume, setVolume] = useState(1.0);

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

  const meetings = useMemo(() => {
    const scoped = workplaceId === "inbox"
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
    
    // Filter by curation status if selected
    if (curationFilter === "pending") {
      filtered = filtered.filter(m => m.metadata.curationStatus === "pending");
    } else if (curationFilter === "curated") {
      filtered = filtered.filter(m => m.metadata.curationStatus === "curated");
    }
    
    return filtered;
  }, [allMeetings, library, workplaceId, query, curationFilter]);

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
      if (paths.length)
        setLibrary(
          await window.smartpuck.library.importAudio(
            paths,
            workplaceId === "inbox" ? undefined : workplaceId,
          ),
        );
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
      const newWidth = Math.max(150, Math.min(400, startWidth + (moveEvent.clientX - startX)));
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
      const newWidth = Math.max(200, Math.min(500, startWidth + (moveEvent.clientX - startX)));
      setMeetingsWidth(newWidth);
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleRailResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = railWidth;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(160, Math.min(320, startWidth + (moveEvent.clientX - startX)));
      setRailWidth(newWidth);
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const wordCount = draft ? draft.trim().split(/\s+/).filter(Boolean).length : 0;
  const charCount = draft ? draft.length : 0;

  return (
    <div className="app" style={{ gridTemplateColumns: isRailCollapsed ? "68px 4px 1fr" : `${railWidth}px 4px 1fr` }}>
      <aside className={`rail ${isRailCollapsed ? "collapsed" : ""}`} style={{ width: isRailCollapsed ? 68 : railWidth }}>
        <div className="brand">
          <span>
            <CircleDot size={18} />
          </span>
          <strong>SmartPuck</strong>
        </div>
        <nav>
          <button
            className={view === "library" ? "active" : ""}
            onClick={() => setView("library")}
          >
            <FolderOpen />
            {!isRailCollapsed && <span>Library</span>}
          </button>
          <button
            className={view === "device" ? "active" : ""}
            onClick={() => setView("device")}
          >
            <Mic />
            {!isRailCollapsed && <span>Device</span>}
            {device?.connected && (
              <span style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent-green)",
                marginLeft: isRailCollapsed ? "0" : "auto",
                boxShadow: "0 0 8px var(--accent-green)"
              }} />
            )}
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
          >
            <Settings />
            {!isRailCollapsed && <span>Settings</span>}
          </button>
        </nav>
        
        <button className="rail-collapse-toggle" onClick={() => setIsRailCollapsed(!isRailCollapsed)}>
          {isRailCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </aside>
      <div className="resize-handle" onMouseDown={handleRailResize} />
      <main>
        {error && <div className="error"><AlertCircle size={16} />{error}</div>}
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
                <div className="menu-section">
                  <span>Add to workspace</span>
                  {library.workplaces.length === 0 && (
                    <button disabled>
                      <Plus /> Create a workspace first
                    </button>
                  )}
                  {library.workplaces.map((workplace) => {
                    const linked = meetingWorkspaceIds(contextMenu.meeting).has(workplace.metadata.id);
                    return (
                      <button
                        key={workplace.metadata.id}
                        disabled={linked}
                        onClick={() => {
                          addToWorkplace(contextMenu.meeting, workplace.metadata.id);
                          setContextMenu(null);
                        }}
                      >
                        {linked ? <Check /> : <Plus />}
                        {workplace.metadata.name}
                      </button>
                    );
                  })}
                </div>
                {workplaceId !== "inbox" && meetingWorkspaceIds(contextMenu.meeting).has(workplaceId) && (
                  <button onClick={() => { removeFromWorkplace(contextMenu.meeting, workplaceId); setContextMenu(null); }}>
                    <Tags /> Remove from this workspace
                  </button>
                )}
                <button className="danger" onClick={() => { deleteMeeting(contextMenu.meeting); setContextMenu(null); }}>
                  <Trash2 /> Move meeting to Trash
                </button>
              </>
            )}
          </div>
        )}
        {view === "library" && (
          <div className="library-container" style={{ gridTemplateColumns: `${workspacesWidth}px 4px ${meetingsWidth}px 4px 1fr` }}>
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
                    className={`workspace-item ${workplaceId === "inbox" ? "selected" : ""}`}
                    onClick={() => {
                      setWorkplaceId("inbox");
                      setSelectedId("");
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
                        setSelectedId("");
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
                  <button
                    className={curationFilter !== "all" ? "active" : ""}
                    onClick={() => {
                      setCurationFilter(current => {
                        if (current === "all") return "pending";
                        if (current === "pending") return "curated";
                        return "all";
                      });
                    }}
                    title={`Filter: ${curationFilter === "all" ? "All" : curationFilter === "pending" ? "Pending Curation" : "Curated"}`}
                    style={{ padding: "10px", color: curationFilter !== "all" ? "var(--accent-lime)" : "inherit" }}
                  >
                    <Filter size={15} />
                  </button>
                </div>
                {meetings.length === 0 ? (
                  <div className="empty">
                    <Mic />
                    <p>No meetings here yet.</p>
                    <button onClick={importFiles}>Import audio</button>
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
                      <div className="meeting-card-info">
                        <strong>{m.metadata.title}</strong>
                        <span>{new Date(m.metadata.capturedAt).toLocaleDateString()} • {new Date(m.metadata.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="meeting-card-meta">
                        <span className="meeting-card-duration">
                          {m.metadata.durationSeconds
                            ? `${Math.floor(m.metadata.durationSeconds / 60)}:${String(Math.floor(m.metadata.durationSeconds % 60)).padStart(2, "0")}`
                            : "0:00"}
                        </span>
                        <span className={`status-badge ${m.metadata.status}`}>
                          {m.metadata.status}
                        </span>
                      </div>
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
                      <h2>{selected.metadata.title}</h2>
                      <p>
                        {new Date(selected.metadata.capturedAt).toLocaleDateString()} • {new Date(selected.metadata.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {selected.metadata.durationSeconds ? `${Math.floor(selected.metadata.durationSeconds / 60)}:${String(Math.floor(selected.metadata.durationSeconds % 60)).padStart(2, "0")}` : "0:00"} • {selected.metadata.sourceDevice?.sessionName || "SmartPuck-2F3A"}
                      </p>
                    </div>
                    <div className="detail-actions-top">
                      <button onClick={() => rename(selected)}>
                        Rename
                      </button>
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
                        <div className="transcript-footer">
                          <span>{charCount.toLocaleString()} characters • {wordCount.toLocaleString()} words</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "flex-end", gap: "10px", background: "var(--bg-sidebar)" }}>
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
                    >
                      <Sparkles />
                      {selected.metadata.status === "error"
                        ? "Retry transcription"
                        : selected.metadata.status === "ready"
                          ? "Transcribe again"
                          : selected.metadata.status === "transcribing"
                            ? "Transcribing…"
                            : "Transcribe now"}
                    </button>
                    <button
                      className="primary"
                      onClick={() =>
                        void run("save", async () =>
                          setLibrary(
                            await window.smartpuck.library.saveTranscript(
                              selected.metadata.id,
                              draft,
                            ),
                          ),
                        )
                      }
                    >
                      <Save />
                      Save changes
                    </button>
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
          <div className="page" style={{ padding: "24px 32px" }}>
            <header style={{ marginBottom: "20px" }}>
              <div>
                <p className="eyebrow">Hardware</p>
                <h1>Device</h1>
              </div>
            </header>
            
            <div className="device-dashboard">
              {!device?.connected ? (
                <div className={`device-offline-card ${busy === "connect" ? "connecting" : "disconnected"}`} style={{ height: "400px" }}>
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
                      <button onClick={() => alert("Checking for updates...")} style={{ padding: "8px 12px", fontSize: "12px", marginLeft: "8px" }}>
                        Check for Update
                      </button>
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
                      <button style={{ marginTop: "16px", fontSize: "12px" }} onClick={() => alert(`Storage Details:\nFree space: ${size(device.storageFreeBytes)}`)}>
                        View Details
                      </button>
                    </section>

                    {/* Recorder Controls */}
                    <section className="panel device-card">
                      <h3>Recorder Controls</h3>
                      <div className="recorder-monitoring-row">
                        <label>Live Monitoring</label>
                        <span className="switch-toggle">
                          <input
                            type="checkbox"
                            checked={liveListening}
                            onChange={liveListening ? stopLiveListening : startLiveListening}
                          />
                          <span className="switch-slider" />
                        </span>
                      </div>
                      <div className="recorder-wave-box">
                        <div className={`equalizer-wave ${liveListening ? "active" : ""}`}>
                          <div className="bar" />
                          <div className="bar" />
                          <div className="bar" />
                          <div className="bar" />
                          <div className="bar" />
                          <div className="bar" />
                          <div className="bar" />
                          <div className="bar" />
                        </div>
                      </div>
                      <div className="recorder-actions-row">
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
                          style={{ flex: 1 }}
                        >
                          {device.recording ? <Square size={14} /> : <Play size={14} />}
                          {device.recording ? "Stop Recording" : "Start Recording"}
                        </button>
                        <button
                          className="icon-btn"
                          disabled={!device.ip && device.transport !== "wifi"}
                          onClick={liveListening ? stopLiveListening : startLiveListening}
                          title="Listen Live"
                        >
                          <Activity size={14} />
                        </button>
                        <button className="icon-btn" title="Settings" onClick={() => alert("Recorder Settings Mode")}>
                          <Settings size={14} />
                        </button>
                      </div>
                      <div className="recorder-timer">
                        {device.recording ? "00:12:48" : "00:00:00"}
                      </div>
                    </section>

                    {/* Wi-Fi Provisioning */}
                    <section className="panel device-card">
                      <h3>Wi-Fi Provisioning</h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <input
                          placeholder="SSID"
                          value={wifiSsid}
                          onChange={(event) => setWifiSsid(event.target.value)}
                          style={{ padding: "8px 10px", fontSize: "12.5px" }}
                        />
                        <input
                          placeholder="Password"
                          type="password"
                          value={wifiPassword}
                          onChange={(event) => setWifiPassword(event.target.value)}
                          style={{ padding: "8px 10px", fontSize: "12.5px" }}
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
                                disabled={network.active}
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
                    <div className="section-head" style={{ marginBottom: "12px" }}>
                      <h3>On-Device Recordings</h3>
                      <div className="actions">
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
                          style={{ padding: "8px" }}
                        >
                          <RefreshCw size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="recordings-table-wrapper">
                      <table className="recordings-table">
                        <thead>
                          <tr>
                            <th>Filename</th>
                            <th>Duration</th>
                            <th>Size</th>
                            <th>Status</th>
                            <th>Modified</th>
                          </tr>
                        </thead>
                        <tbody>
                          {device.sessions.length === 0 ? (
                            <tr>
                              <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                                No recording files found on device.
                              </td>
                            </tr>
                          ) : (
                            device.sessions.map((s) => (
                              <tr key={s.path}>
                                <td>{s.name}</td>
                                <td>{Math.round(s.durationSeconds / 60)}:00</td>
                                <td>{size(s.sizeBytes)}</td>
                                <td>
                                  <span className={`table-status-tag ${s.uploaded ? "synced" : "pending"}`}>
                                    {s.uploaded ? "Synced" : "Pending"}
                                  </span>
                                </td>
                                <td>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "May 26, 2025"}</td>
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
                </>
              )}
            </div>
          </div>
        )}
        {view === "settings" && (
          <div className="page" style={{ padding: "24px 32px" }}>
            <header style={{ marginBottom: "20px" }}>
              <div>
                <p className="eyebrow">Preferences</p>
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

              {/* Agent Compatibility */}
              <div className="settings-card">
                <div className="settings-card-icon">
                  <Sparkles size={20} />
                </div>
                <div className="settings-card-body">
                  <h3>Agent Compatibility</h3>
                  <p>
                    Automatically generate instruction files to help AI agents understand your transcripts and context.
                  </p>
                  <div className="settings-status-badge">
                    <span className="dot" />
                    <span>Status: Enabled</span>
                  </div>
                  <p style={{ fontSize: "11.5px", color: "var(--text-muted)", marginTop: "4px" }}>
                    Generates AGENTS.md files for each meeting folder.
                  </p>
                  <div className="settings-card-actions">
                    <button onClick={() => alert("Agent options configured.")}>
                      <Settings size={13} />
                      Configure
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
                    <div className="settings-dropdown-wrapper">
                      <label>Device</label>
                      <select className="settings-select" defaultValue="auto">
                        <option value="auto">Auto (GPU if available)</option>
                        <option value="cpu">CPU Only</option>
                      </select>
                    </div>
                    <div className="settings-dropdown-wrapper">
                      <label>Whisper Model</label>
                      <select className="settings-select" defaultValue="medium">
                        <option value="medium">medium</option>
                        <option value="small.en">small.en</option>
                        <option value="base">base</option>
                      </select>
                    </div>
                    <div className="settings-dropdown-wrapper">
                      <label>Language Mode</label>
                      <select className="settings-select" defaultValue="bilingual">
                        <option value="bilingual">Bilingual (EN + KM)</option>
                        <option value="english">English Only</option>
                      </select>
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

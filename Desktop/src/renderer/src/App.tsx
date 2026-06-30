import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  CircleDot,
  Copy,
  FileAudio,
  FolderOpen,
  HardDrive,
  Import,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
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
  Trash2,
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
  if (!value) return "—";
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
  const [showWorkplaces, setShowWorkplaces] = useState(true);
  const [copied, setCopied] = useState(false);
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
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return scoped;
    return allMeetings.filter((meeting) =>
      `${meeting.metadata.title}\n${meeting.metadata.summary || ""}\n${meeting.transcript}`.toLocaleLowerCase().includes(needle),
    );
  }, [allMeetings, library, workplaceId, query]);

  const inboxPending = useMemo(
    () => library.inbox.filter((meeting) => meeting.metadata.curationStatus === "pending").length,
    [library.inbox],
  );

  const selected = useMemo(
    () =>
      allMeetings.find(
        (m) => m.metadata.id === selectedId,
      ) || null,
    [allMeetings, selectedId],
  );

  useEffect(() => {
    setDraft(selected?.transcript || "");
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

  const quickAddWorkplaces = (meeting: Meeting): Workplace[] => {
    const linked = meetingWorkspaceIds(meeting);
    return library.workplaces.filter((workplace) => !linked.has(workplace.metadata.id)).slice(0, 3);
  };

  const reorderWorkplaceDrop = (targetId: string): void => {
    if (!draggingWorkplaceId || draggingWorkplaceId === targetId) return;
    const ids = library.workplaces.map((workplace) => workplace.metadata.id);
    const from = ids.indexOf(draggingWorkplaceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    void run("reorder-workplaces", async () => setLibrary(await window.smartpuck.library.reorderWorkplaces(ids)));
  };

  return (
    <div className="app">
      <aside className="rail">
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
            Library
          </button>
          <button
            className={view === "device" ? "active" : ""}
            onClick={() => setView("device")}
          >
            <Mic />
            Device
            {device?.connected && (
              <span style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent-green)",
                marginLeft: "auto",
                boxShadow: "0 0 8px var(--accent-green)"
              }} />
            )}
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
          >
            <Settings />
            Settings
          </button>
        </nav>
        <div className="rail-foot">
          <small>Local-first meeting memory</small>
        </div>
      </aside>
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
                aria-label="Workspace name"
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
          <div className="library">
            <header>
              <div>
                <p className="eyebrow">Meeting workspace</p>
                <h1>Library</h1>
              </div>
              <div className="actions">
                <div className="search-container">
                  <span style={{ position: "absolute", left: 12, color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
                    <Search size={16} />
                  </span>
                  <input
                    className="search"
                    aria-label="Search meetings"
                    placeholder="Search meetings..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <button
                  onClick={() => setShowWorkplaces(!showWorkplaces)}
                  title={showWorkplaces ? "Collapse Workspaces" : "Expand Workspaces"}
                  style={{ padding: "10px" }}
                >
                  {showWorkplaces ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                </button>
                <button onClick={openCreateWorkspace}>
                  <Plus />
                  Workspace
                </button>
                <button className="primary" onClick={importFiles}>
                  <Import />
                  Import audio
                </button>
              </div>
            </header>
            <div className="library-grid" style={{ gridTemplateColumns: showWorkplaces ? "220px minmax(300px, 380px) 1fr" : "380px 1fr" }}>
              <section className={`workplaces panel ${showWorkplaces ? "" : "collapsed"}`}>
                <h3>Workspaces</h3>
                <button
                  className={workplaceId === "inbox" ? "selected" : ""}
                  onClick={() => {
                    setWorkplaceId("inbox");
                    setSelectedId("");
                  }}
                >
                  <span>Unassigned</span>
                  <b>
                    {library.inbox.length}
                    {inboxPending > 0 ? ` · ${inboxPending} to curate` : ""}
                  </b>
                </button>
                {library.workplaces.length === 0 && (
                  <div className="workspace-hint">
                    <p>No workspaces yet.</p>
                    <button onClick={openCreateWorkspace}>
                      <Plus /> Create one
                    </button>
                  </div>
                )}
                {library.workplaces.map((w) => (
                  <button
                    key={w.metadata.id}
                    draggable
                    className={workplaceId === w.metadata.id ? "selected" : ""}
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
                    <span>{w.metadata.name}</span>
                    <b>{w.meetings.length}</b>
                  </button>
                ))}
              </section>
              <section className="meetings panel">
                <div className="section-head">
                  <h3>Meetings</h3>
                  <span>{meetings.length}</span>
                </div>
                {meetings.length === 0 ? (
                  <div className="empty">
                    <Mic />
                    <p>No meetings here yet.</p>
                    <button onClick={importFiles}>Import a recording</button>
                  </div>
                ) : (
                  meetings.map((m) => (
                    <button
                      key={m.metadata.id}
                      className={`meeting ${selectedId === m.metadata.id ? "selected" : ""}`}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setContextMenu({ type: "meeting", meeting: m, x: event.clientX, y: event.clientY });
                      }}
                      onClick={() => setSelectedId(m.metadata.id)}
                      onDoubleClick={() => rename(m)}
                    >
                      <div>
                        <strong>{m.metadata.title}</strong>
                        <small>
                          {new Date(m.metadata.capturedAt).toLocaleString()}
                        </small>
                        {quickAddWorkplaces(m).length > 0 && (
                          <span className="quick-add" onClick={(event) => event.stopPropagation()}>
                            {quickAddWorkplaces(m).map((workplace) => (
                              <em
                                key={workplace.metadata.id}
                                role="button"
                                tabIndex={0}
                                title={`Add to ${workplace.metadata.name}`}
                                onClick={() => addToWorkplace(m, workplace.metadata.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") addToWorkplace(m, workplace.metadata.id);
                                }}
                              >
                                + {workplace.metadata.name}
                              </em>
                            ))}
                          </span>
                        )}
                      </div>
                      <span className={`status ${m.metadata.status}`}>
                        {m.metadata.status === "transcribing" && m.metadata.progressPercent
                          ? `${m.metadata.status} ${m.metadata.progressPercent}%`
                          : m.metadata.status}
                      </span>
                    </button>
                  ))
                )}
              </section>
              <section className="detail panel">
                {selected ? (
                  <>
                    <div className="section-head">
                      <div>
                        <p className="eyebrow">{selected.metadata.status}</p>
                        <h2>{selected.metadata.title}</h2>
                      </div>
                      <button title="Rename" onClick={() => rename(selected)}>
                        Rename
                      </button>
                    </div>
                    <div className="meta">
                      <span>{selected.metadata.curationStatus === "pending" ? "Needs agent curation" : "Curated"}</span>
                      <span>
                        {selected.metadata.language || "Language pending"}
                      </span>
                      <span>
                        {selected.metadata.durationSeconds
                          ? `${Math.round(selected.metadata.durationSeconds / 60)} min`
                          : "Duration pending"}
                      </span>
                    </div>
                    {meetingWorkspaceIds(selected).size > 0 && (
                      <div className="workspace-tags">
                        {library.workplaces
                          .filter((workplace) => meetingWorkspaceIds(selected).has(workplace.metadata.id))
                          .map((workplace) => (
                            <span key={workplace.metadata.id}>
                              {workplace.metadata.name}
                            </span>
                          ))}
                      </div>
                    )}
                    {selected.metadata.summary && (
                      <p className="meeting-summary">{selected.metadata.summary}</p>
                    )}
                    <div className="audio-player-wrapper">
                      <audio
                        className="audio-player"
                        controls
                        preload="metadata"
                        src={`smartpuck://audio/${encodeURIComponent(selected.metadata.id)}`}
                      />
                    </div>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      spellCheck
                      placeholder="Start transcribing or edit transcript..."
                    />
                    <div className="editor-toolbar">
                      <div className="editor-stats">
                        <span>{draft ? draft.trim().split(/\s+/).filter(Boolean).length : 0} words</span>
                        <span>{draft ? draft.length : 0} characters</span>
                      </div>
                      <div className="actions">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(draft);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          title="Copy transcript"
                        >
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          {copied ? "Copied" : "Copy"}
                        </button>
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
                          Save transcript
                        </button>
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
          </div>
        )}
        {view === "device" && (
          <div className="page">
            <header>
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
                  <div className="device-header-card">
                    <div className="device-header-info">
                      <div className="device-badge-active">
                        <Mic size={24} />
                      </div>
                      <div>
                        <h2>SmartPuck Connected</h2>
                        <div className="device-meta-badges">
                          <span>{device.transport.toUpperCase()}</span>
                          {(device.network || device.baseUrl) && (
                            <span>{device.network || device.baseUrl}</span>
                          )}
                          {device.ip && <span>{device.ip}</span>}
                          <span>Firmware {device.firmwareVersion}</span>
                        </div>
                      </div>
                    </div>
                    <div className="actions">
                      <button
                        onClick={() =>
                          void run("refresh", async () =>
                            setDevice(await window.smartpuck.device.refresh())
                          )
                        }
                        title="Refresh status"
                      >
                        <RefreshCw size={14} /> Refresh
                      </button>
                    </div>
                  </div>
                  <div className="device-grid">
                    <section className="panel stat-storage">
                      <div className="panel-header-badge">
                        <h3>Storage</h3>
                        <HardDrive size={16} style={{ color: "var(--text-muted)" }} />
                      </div>
                      <strong className="storage-amount">{size(device.storageFreeBytes)} free</strong>
                      <span className="storage-sub">of {size(device.storageTotalBytes)} total capacity</span>
                      <div className="storage-progress-container" style={{ marginTop: "12px" }}>
                        <div
                          className="storage-progress-bar"
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min(
                                100,
                                ((device.storageTotalBytes - device.storageFreeBytes) /
                                  device.storageTotalBytes) *
                                  100
                              )
                            )}%`
                          }}
                        />
                      </div>
                    </section>
                    <section className="panel recorder-card">
                      <div className="panel-header-badge">
                        <h3>Recorder</h3>
                        <div className={`recorder-status-indicator ${device.recording ? "recording" : ""}`}>
                          <span></span>
                          {device.recording ? "Recording" : "Ready"}
                        </div>
                      </div>
                      <div className="recorder-status-row">
                        <strong>{device.recording ? "Active Session" : "System Idle"}</strong>
                        <div className={`equalizer-wave ${liveListening ? "active" : ""}`}>
                          <div className="bar"></div>
                          <div className="bar"></div>
                          <div className="bar"></div>
                          <div className="bar"></div>
                          <div className="bar"></div>
                          <div className="bar"></div>
                          <div className="bar"></div>
                          <div className="bar"></div>
                        </div>
                      </div>
                      <div className="actions" style={{ marginTop: "16px", gap: "10px" }}>
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
                          {device.recording ? "Stop" : "Start"}
                        </button>
                        <button
                          disabled={!device.ip && device.transport !== "wifi"}
                          onClick={liveListening ? stopLiveListening : startLiveListening}
                          style={{ flex: 1 }}
                        >
                          <Activity size={14} />
                          {liveListening ? "Stop Monitor" : "Listen Live"}
                        </button>
                      </div>
                    </section>
                    <section className="panel sessions sessions-list-panel">
                      <div className="section-head">
                        <h3>On Device Recordings</h3>
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
                          >
                            {busy === "sync-new" ? "Syncing…" : "Sync New"}
                          </button>
                          <button
                            onClick={() =>
                              void run("refresh", async () =>
                                setDevice(await window.smartpuck.device.refresh()),
                              )
                            }
                          >
                            <RefreshCw size={14} />
                          </button>
                        </div>
                      </div>
                      {device.sessions.length === 0 ? (
                        <div className="empty" style={{ minHeight: "160px" }}>
                          <FileAudio size={28} />
                          <p>No recordings found on this SmartPuck device.</p>
                        </div>
                      ) : (
                        device.sessions.map((s) => (
                          <div className="session-row" key={s.path}>
                            <div className="session-info">
                              <div className="session-icon">
                                <FileAudio size={18} />
                              </div>
                              <div className="session-meta">
                                <strong>
                                  {s.name}
                                  <span className={`sync-badge ${s.uploaded ? "uploaded" : "pending"}`}>
                                    {s.uploaded ? "Synced" : "Unsynced"}
                                  </span>
                                </strong>
                                <small>
                                  {Math.round(s.durationSeconds / 60)} min · {size(s.sizeBytes)}
                                </small>
                              </div>
                            </div>
                            <div className="actions">
                              <button
                                disabled={busy === `sync:${s.path}`}
                                onClick={() =>
                                  void run(`sync:${s.path}`, async () => {
                                    setLibrary(
                                      await window.smartpuck.device.importSession(
                                        s.path,
                                        workplaceId === "inbox"
                                          ? undefined
                                          : workplaceId,
                                      ),
                                    );
                                    setDevice(await window.smartpuck.device.refresh());
                                  })
                                }
                              >
                                {busy === `sync:${s.path}`
                                  ? "Syncing…"
                                  : s.uploaded
                                    ? "Sync Again"
                                    : "Sync"}
                              </button>
                              <button
                                onClick={() => {
                                  const name = prompt("Recording name", s.name);
                                  if (name)
                                    void run(`rename-device:${s.path}`, async () =>
                                      setDevice(await window.smartpuck.device.renameSession(s.path, name))
                                    );
                                }}
                              >
                                Rename
                              </button>
                              <button
                                className="danger"
                                disabled={!s.uploaded}
                                title={s.uploaded ? "Delete the device copy; the local meeting remains" : "Sync before deleting"}
                                onClick={() => {
                                  if (confirm(`Delete “${s.name}” from the SmartPuck? The local meeting copy will remain.`)) {
                                    void run(`delete-device:${s.path}`, async () =>
                                      setDevice(await window.smartpuck.device.deleteSession(s.path))
                                    );
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </section>
                    <section className="panel sessions wifi-section">
                      <div className="section-head">
                        <div>
                          <h3>Wi-Fi Networks</h3>
                          <small style={{ color: "var(--text-muted)", fontSize: "11px", display: "block", marginTop: "4px" }}>
                            Priority: USB-C → same-network Wi-Fi → SmartPuck fallback Wi-Fi
                          </small>
                        </div>
                      </div>
                      <div className="wifi-form">
                        <input
                          placeholder="Wi-Fi SSID"
                          value={wifiSsid}
                          onChange={(event) => setWifiSsid(event.target.value)}
                        />
                        <input
                          placeholder="Password"
                          type="password"
                          value={wifiPassword}
                          onChange={(event) => setWifiPassword(event.target.value)}
                        />
                        <button
                          className="primary"
                          onClick={() =>
                            void run("save-wifi", async () => {
                              await window.smartpuck.device.saveWifi(wifiSsid, wifiPassword);
                              setWifiPassword("");
                            })
                          }
                        >
                          Save
                        </button>
                      </div>
                      {wifiConfig?.networks.map((network) => (
                        <div className="session-row" key={network.ssid} style={{ padding: "10px 0" }}>
                          <div className="session-info">
                            <div className="session-meta">
                              <strong>{network.ssid}</strong>
                              <small>{network.active ? "Active Connection" : "Saved"}</small>
                            </div>
                          </div>
                          <button
                            disabled={network.active}
                            onClick={() =>
                              void run("remove-wifi", async () => {
                                await window.smartpuck.device.removeWifi(network.ssid);
                                setWifiConfig(await window.smartpuck.device.wifiConfig());
                              })
                            }
                          >
                            Forget
                          </button>
                        </div>
                      ))}
                      <small className="connection-note">
                        Bluetooth provisioning is not enabled in firmware yet; Desktop does not pretend it is available. USB and Wi-Fi remain fully automatic.
                      </small>
                    </section>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {view === "settings" && (
          <div className="page">
            <header>
              <div>
                <p className="eyebrow">Preferences</p>
                <h1>Settings</h1>
              </div>
            </header>
            <div className="settings-grid">
              <section className="settings panel">
                <h2>Meeting workspace</h2>
                <p>
                  SmartPuck writes plain folders, Markdown transcripts, stable
                  metadata, and agent instructions. Open this folder directly in
                  Codex or Antigravity.
                </p>
                <code>{library.rootPath || "Loading…"}</code>
                <div className="actions">
                  <button
                    onClick={() => void window.smartpuck.library.openRoot()}
                  >
                    <FolderOpen />
                    Open folder
                  </button>
                  <button
                    onClick={() =>
                      void run("root", async () => {
                        const next = await window.smartpuck.library.chooseRoot();
                        if (next) setLibrary(next);
                      })
                    }
                  >
                    Change location
                  </button>
                </div>
              </section>
              <section className="settings panel">
                <h2>Agent compatibility</h2>
                <p>
                  The workspace generates AGENTS.md, CLAUDE.md, and the SmartPuck
                  meeting skill automatically. No API keys, model provider, or MCP
                  server is required.
                </p>
              </section>
              <section className="settings panel">
                <h2>Transcription runtime</h2>
                <p>
                  V1 uses local Python and faster-whisper. Set{" "}
                  <code>SMARTPUCK_PYTHON</code> when Python is not available on
                  PATH.
                </p>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

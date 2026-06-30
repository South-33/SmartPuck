import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleDot,
  FolderOpen,
  Import,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
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
  const createWorkplace = (): void => {
    const name = prompt("Workspace name");
    if (name)
      void run("workplace", async () => {
        const next = await window.smartpuck.library.createWorkplace(name);
        setLibrary(next);
        const created = next.workplaces.find((workplace) => workplace.metadata.name === name.trim());
        if (created) {
          setWorkplaceId(created.metadata.id);
          setSelectedId("");
        }
      });
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
    const name = prompt("Workspace name", workplace.metadata.name);
    if (!name) return;
    void run("rename-workplace", async () => {
      const next = await window.smartpuck.library.renameWorkplace(workplace.metadata.id, name);
      setLibrary(next);
      setWorkplaceId(workplace.metadata.id);
    });
  };
  const deleteWorkplace = (workplace: Workplace): void => {
    if (!confirm(`Delete workspace "${workplace.metadata.name}"? Meetings will move back to Inbox; audio and transcripts stay safe.`)) return;
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
        {error && <div className="error">{error}</div>}
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
                <input
                  className="search"
                  aria-label="Search meetings"
                  placeholder="Search meetings"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button onClick={createWorkplace}>
                  <Plus />
                  Workspace
                </button>
                <button className="primary" onClick={importFiles}>
                  <Import />
                  Import audio
                </button>
              </div>
            </header>
            <div className="library-grid">
              <section className="workplaces panel">
                <h3>Workspaces</h3>
                <button
                  className={workplaceId === "inbox" ? "selected" : ""}
                  onClick={() => {
                    setWorkplaceId("inbox");
                    setSelectedId("");
                  }}
                >
                  <span>Inbox</span>
                  <b>
                    {library.inbox.length}
                    {inboxPending > 0 ? ` · ${inboxPending} to curate` : ""}
                  </b>
                </button>
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
                    <audio
                      className="audio-player"
                      controls
                      preload="metadata"
                      src={`smartpuck://audio/${encodeURIComponent(selected.metadata.id)}`}
                    />
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      spellCheck
                    />
                    <div className="detail-actions">
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
            <section className="hero panel">
              <div className={`orb ${device?.connected ? "online" : ""}`}>
                <Mic />
              </div>
              <div>
                <h2>
                  {device?.connected
                    ? "SmartPuck connected"
                    : "Connect your SmartPuck"}
                </h2>
                <p>
                  {device?.connected
                    ? `${device.transport.toUpperCase()} · ${device.network || device.baseUrl} · Firmware ${device.firmwareVersion}`
                    : "USB-C and smartpuck.local are checked automatically. You can also enter a Wi-Fi address."}
                </p>
              </div>
              <div className="connect">
                <input
                  value={deviceUrl}
                  onChange={(e) => setDeviceUrl(e.target.value)}
                />
                <button
                  className="primary"
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
            </section>
            {device?.connected && (
              <div className="device-grid">
                <section className="panel stat">
                  <small>Storage</small>
                  <strong>{size(device.storageFreeBytes)} free</strong>
                  <span>of {size(device.storageTotalBytes)}</span>
                </section>
                <section className="panel stat">
                  <small>Recorder</small>
                  <strong>{device.recording ? "Recording" : "Ready"}</strong>
                  <div className="actions">
                    <button
                      onClick={() =>
                        void run("record", async () =>
                          setDevice(
                            await window.smartpuck.device.setRecording(
                              device.recording ? "stop" : "start",
                            ),
                          ),
                        )
                      }
                    >
                      {device.recording ? "Stop" : "Start"}
                    </button>
                    <button
                      disabled={!device.ip && device.transport !== "wifi"}
                      onClick={liveListening ? stopLiveListening : startLiveListening}
                    >
                      {liveListening ? "Stop listening" : "Listen live"}
                    </button>
                  </div>
                </section>
                <section className="panel sessions">
                  <div className="section-head">
                    <h3>On device</h3>
                    <div className="actions"><button
                      disabled={busy === "sync-new" || !device.sessions.some((s) => !s.uploaded)}
                      onClick={() => void run("sync-new", async () => {
                        setLibrary(await window.smartpuck.device.importNew(workplaceId === "inbox" ? undefined : workplaceId));
                        setDevice(await window.smartpuck.device.refresh());
                      })}
                    >{busy === "sync-new" ? "Syncing…" : "Sync new"}</button><button
                      onClick={() =>
                        void run("refresh", async () =>
                          setDevice(await window.smartpuck.device.refresh()),
                        )
                      }
                    >
                      <RefreshCw />
                    </button></div>
                  </div>
                  {device.sessions.map((s) => (
                    <div className="session" key={s.path}>
                      <div>
                        <strong>{s.name}</strong>
                        <small>
                          {Math.round(s.durationSeconds / 60)} min ·{" "}
                          {size(s.sizeBytes)}
                        </small>
                      </div>
                      <div className="actions"><button
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
                            ? "Sync again"
                            : "Sync"}
                      </button><button
                        onClick={() => {
                          const name = prompt("Recording name", s.name);
                          if (name) void run(`rename-device:${s.path}`, async () => setDevice(await window.smartpuck.device.renameSession(s.path, name)));
                        }}
                      >Rename</button><button
                        disabled={!s.uploaded}
                        title={s.uploaded ? "Delete the device copy; the local meeting remains" : "Sync before deleting"}
                        onClick={() => {
                          if (confirm(`Delete “${s.name}” from the SmartPuck? The local meeting copy will remain.`)) {
                            void run(`delete-device:${s.path}`, async () => setDevice(await window.smartpuck.device.deleteSession(s.path)));
                          }
                        }}
                      >Delete</button></div>
                    </div>
                  ))}
                </section>
                <section className="panel sessions">
                  <div className="section-head"><div><h3>Connections</h3><small>Priority: USB-C → same-network Wi-Fi → SmartPuck fallback Wi-Fi</small></div></div>
                  <div className="wifi-form">
                    <input placeholder="Wi-Fi name" value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)} />
                    <input placeholder="Password" type="password" value={wifiPassword} onChange={(event) => setWifiPassword(event.target.value)} />
                    <button onClick={() => void run("save-wifi", async () => {
                      await window.smartpuck.device.saveWifi(wifiSsid, wifiPassword);
                      setWifiPassword("");
                    })}>Save and reconnect</button>
                  </div>
                  {wifiConfig?.networks.map((network) => (
                    <div className="session" key={network.ssid}>
                      <div><strong>{network.ssid}</strong><small>{network.active ? "Active" : "Saved"}</small></div>
                      <button disabled={network.active} onClick={() => void run("remove-wifi", async () => {
                        await window.smartpuck.device.removeWifi(network.ssid);
                        setWifiConfig(await window.smartpuck.device.wifiConfig());
                      })}>Forget</button>
                    </div>
                  ))}
                  <small className="connection-note">Bluetooth provisioning is not enabled in firmware yet; Desktop does not pretend it is available. USB and Wi-Fi remain fully automatic.</small>
                </section>
              </div>
            )}
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
        )}
      </main>
    </div>
  );
}

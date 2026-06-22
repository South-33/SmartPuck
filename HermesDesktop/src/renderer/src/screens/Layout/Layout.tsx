import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Chat from "../Chat/Chat";
import {
  dbItemsToChatMessages,
  type DbHistoryItem,
} from "../Chat/sessionHistory";
import {
  type ChatRun,
  mintRun,
  patchRun,
  isScratchRun,
  openSessionRunTransition,
  selectProfileRunTransition,
  findRunBySession,
  loadingSessionIds as deriveLoadingSessionIds,
} from "./chatRuns";
import { ActiveSessionsBar } from "./ActiveSessionsBar";
import Sessions from "../Sessions/Sessions";
import Agents from "../Agents/Agents";
import Discover from "../Discover/Discover";
import SidebarRecentSessions from "./SidebarRecentSessions";
import Settings from "../Settings/Settings";
import Skills from "../Skills/Skills";
import Memory from "../Memory/Memory";
import Tools from "../Tools/Tools";
import Gateway from "../Gateway/Gateway";
import Office from "../Office/Office";
import Providers from "../Providers/Providers";
import Schedules from "../Schedules/Schedules";
import Kanban from "../Kanban/Kanban";
import SmartPuck from "../SmartPuck/SmartPuck";
import RemoteNotice from "../../components/RemoteNotice";
import VerifyWarningBanner from "../../components/VerifyWarningBanner";
import {
  Settings as SettingsIcon,
  KeyRound,
  AudioLines,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Pause,
  X,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type {
  SmartPuckFolder,
  SmartPuckDeviceSession,
  SmartPuckLibrarySnapshot,
  SmartPuckRecording,
} from "../../../../shared/smartpuck-library";

type View =
  | "chat"
  | "smartpuck"
  | "discover"
  | "agents"
  | "office"
  | "providers"
  | "skills"
  | "memory"
  | "tools"
  | "schedules"
  | "kanban"
  | "gateway"
  | "settings";

const PINNED_NAV_ITEMS: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "smartpuck", icon: AudioLines, labelKey: "SmartPuck" },
];

const FOOTER_NAV_ITEMS: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "providers", icon: KeyRound, labelKey: "navigation.providers" },
  { view: "settings", icon: SettingsIcon, labelKey: "navigation.settings" },
];

const SIDEBAR_COLLAPSED_KEY = "hermes.sidebar.collapsed";
const SIDEBAR_SCROLLBAR_HIDE_MS = 700;

interface LayoutProps {
  verifyWarning?: boolean;
  onReinstall?: () => void;
  onDismissVerifyWarning?: () => void;
}

function Layout({
  verifyWarning,
  onReinstall,
  onDismissVerifyWarning,
}: LayoutProps = {}): React.JSX.Element {
  const { t } = useI18n();
  // Audio player state
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioTitle, setAudioTitle] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSourceKeyRef = useRef<string | null>(null);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handleAudioTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setAudioCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleAudioLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setAudioDuration(audioRef.current.duration);
    }
  }, []);

  const handleAudioEnded = useCallback(() => {
    setAudioPlaying(false);
    setAudioCurrentTime(0);
  }, []);

  const handlePlayPauseAudio = useCallback(async (recording: SmartPuckRecording) => {
    if (playingId === recording.id) {
      if (audioRef.current) {
        if (audioPlaying) {
          audioRef.current.pause();
          setAudioPlaying(false);
        } else {
          void audioRef.current.play().then(() => setAudioPlaying(true));
        }
      }
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeEventListener("timeupdate", handleAudioTimeUpdate);
        audioRef.current.removeEventListener("loadedmetadata", handleAudioLoadedMetadata);
        audioRef.current.removeEventListener("ended", handleAudioEnded);
      }
      setPlayingId(recording.id);
      setAudioTitle(recording.title);
      setAudioUrl(null);
      setAudioPlaying(false);
      setAudioCurrentTime(0);
      setAudioDuration(0);

      try {
        const dataUrl = await window.hermesAPI.readMediaFile(
          recording.playbackAudioPath || recording.audioPath,
        );
        if (!dataUrl) {
          setPlayingId(null);
          return;
        }
        setAudioUrl(dataUrl);
        audioSourceKeyRef.current = recording.playbackAudioPath || recording.audioPath;
        const audio = new Audio(dataUrl);
        audioRef.current = audio;
        audio.addEventListener("timeupdate", handleAudioTimeUpdate);
        audio.addEventListener("loadedmetadata", handleAudioLoadedMetadata);
        audio.addEventListener("ended", handleAudioEnded);
        void audio.play().then(() => setAudioPlaying(true));
      } catch (err) {
        console.error("Failed to play audio", err);
        setPlayingId(null);
      }
    }
  }, [playingId, audioPlaying, handleAudioTimeUpdate, handleAudioLoadedMetadata, handleAudioEnded]);

  const handlePlayDeviceAudio = useCallback(async (
    session: SmartPuckDeviceSession,
    baseUrl: string,
  ) => {
    const id = `device:${session.sessionPath}`;
    if (playingId === id && audioRef.current) {
      if (audioPlaying) {
        audioRef.current.pause();
        setAudioPlaying(false);
      } else {
        await audioRef.current.play();
        setAudioPlaying(true);
      }
      return;
    }
    audioRef.current?.pause();
    setPlayingId(id);
    setAudioTitle(session.displayName || session.name);
    setAudioUrl(null);
    setAudioPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    const response = await fetch(
      `${baseUrl}/download?path=${encodeURIComponent(session.audioPath)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(`SmartPuck returned HTTP ${response.status}.`);
    const blob = await response.blob();
    if (blob.size <= 44) throw new Error("This recording contains no playable audio.");
    const objectUrl = URL.createObjectURL(
      blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/wav" }),
    );
    setAudioUrl(objectUrl);
    audioSourceKeyRef.current = id;
    const audio = new Audio(objectUrl);
    audioRef.current = audio;
    audio.addEventListener("timeupdate", handleAudioTimeUpdate);
    audio.addEventListener("loadedmetadata", handleAudioLoadedMetadata);
    audio.addEventListener("ended", handleAudioEnded);
    await audio.play();
    setAudioPlaying(true);
  }, [audioPlaying, handleAudioEnded, handleAudioLoadedMetadata, handleAudioTimeUpdate, playingId]);

  const formatTime = useCallback((seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, []);

  const [view, setView] = useState<View>("smartpuck");
  // Multiple conversations coexist (background sessions + multi-agent). Each is
  // a ChatRun; all are mounted, only the active one is shown. Profile switches
  // preserve existing conversations and activate a scratch run for the selected
  // agent so `activeProfile` stays aligned with the visible chat transport.
  const [activeProfile, setActiveProfile] = useState("default");
  const [runs, setRuns] = useState<ChatRun[]>(() => [mintRun("default")]);
  const [activeRunId, setActiveRunId] = useState<string>(() => runs[0].runId);
  const [smartPuckLibrary, setSmartPuckLibrary] =
    useState<SmartPuckLibrarySnapshot | null>(null);
  const smartPuckFolders: SmartPuckFolder[] = smartPuckLibrary?.folders ?? [];

  useEffect(() => {
    if (!playingId || playingId.startsWith("device:") || !smartPuckLibrary) return;
    const stillExists = smartPuckLibrary.folders.some((folder) =>
      folder.recordings.some((recording) => recording.id === playingId),
    );
    if (stillExists) return;
    audioRef.current?.pause();
    audioRef.current = null;
    audioSourceKeyRef.current = null;
    setPlayingId(null);
    setAudioUrl(null);
    setAudioPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setAudioTitle("");
  }, [playingId, smartPuckLibrary]);

  useEffect(() => {
    if (!playingId || playingId.startsWith("device:") || !smartPuckLibrary) return;
    const recording = smartPuckLibrary.folders
      .flatMap((folder) => folder.recordings)
      .find((item) => item.id === playingId);
    if (!recording) return;
    const nextPath = recording.playbackAudioPath || recording.audioPath;
    if (audioSourceKeyRef.current === nextPath) return;
    const previous = audioRef.current;
    const resumeAt = previous?.currentTime || 0;
    const shouldResume = !!previous && !previous.paused;
    void window.hermesAPI.readMediaFile(nextPath).then((nextUrl) => {
      if (!nextUrl || playingId !== recording.id) return;
      previous?.pause();
      const nextAudio = new Audio(nextUrl);
      audioRef.current = nextAudio;
      audioSourceKeyRef.current = nextPath;
      setAudioUrl(nextUrl);
      nextAudio.addEventListener("timeupdate", handleAudioTimeUpdate);
      nextAudio.addEventListener("loadedmetadata", () => {
        handleAudioLoadedMetadata();
        nextAudio.currentTime = Math.min(resumeAt, nextAudio.duration || resumeAt);
      });
      nextAudio.addEventListener("ended", handleAudioEnded);
      if (shouldResume) void nextAudio.play().then(() => setAudioPlaying(true));
    });
  }, [handleAudioEnded, handleAudioLoadedMetadata, handleAudioTimeUpdate, playingId, smartPuckLibrary]);
  // While a resume's history is loading, show its spinner immediately.
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(
    null,
  );
  // Sessions whose resume is in flight — dedupes rapid double-clicks that would
  // otherwise mount two tabs for the same session (the live check straddles an
  // await, so it can't rely on `runs` state alone).
  const resumingRef = useRef<Set<string>>(new Set());
  const sidebarChatScrollRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollbarHideRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [sidebarScrollbar, setSidebarScrollbar] = useState({
    visible: false,
    scrollable: false,
    top: 0,
    height: 0,
  });

  const currentSessionId =
    runs.find((r) => r.runId === activeRunId)?.sessionId ?? null;

  const loadingSessionIds = useMemo(
    () => deriveLoadingSessionIds(runs),
    [runs],
  );

  const updateSidebarScrollbar = useCallback((visible: boolean) => {
    const root = sidebarChatScrollRef.current;
    if (!root) {
      setSidebarScrollbar((prev) =>
        prev.scrollable || prev.visible
          ? { visible: false, scrollable: false, top: 0, height: 0 }
          : prev,
      );
      return;
    }

    const scrollable = root.scrollHeight > root.clientHeight + 1;
    if (!scrollable) {
      setSidebarScrollbar((prev) =>
        prev.scrollable || prev.visible
          ? { visible: false, scrollable: false, top: 0, height: 0 }
          : prev,
      );
      return;
    }

    const trackHeight = root.clientHeight;
    const thumbHeight = Math.max(
      32,
      Math.round((root.clientHeight / root.scrollHeight) * trackHeight),
    );
    const maxTop = Math.max(0, trackHeight - thumbHeight);
    const maxScroll = Math.max(1, root.scrollHeight - root.clientHeight);
    const top = Math.round((root.scrollTop / maxScroll) * maxTop);

    setSidebarScrollbar((prev) => {
      const next = { visible, scrollable, top, height: thumbHeight };
      return prev.visible === next.visible &&
        prev.scrollable === next.scrollable &&
        prev.top === next.top &&
        prev.height === next.height
        ? prev
        : next;
    });
  }, []);

  useEffect(() => {
    const root = sidebarChatScrollRef.current;
    if (!root) return;

    const showThenHide = (): void => {
      updateSidebarScrollbar(true);
      if (sidebarScrollbarHideRef.current) {
        clearTimeout(sidebarScrollbarHideRef.current);
      }
      sidebarScrollbarHideRef.current = setTimeout(() => {
        updateSidebarScrollbar(false);
      }, SIDEBAR_SCROLLBAR_HIDE_MS);
    };

    const updateHidden = (): void => updateSidebarScrollbar(false);
    root.addEventListener("scroll", showThenHide, { passive: true });
    window.addEventListener("resize", updateHidden);
    const observer = new ResizeObserver(updateHidden);
    observer.observe(root);

    updateHidden();
    return () => {
      root.removeEventListener("scroll", showThenHide);
      window.removeEventListener("resize", updateHidden);
      observer.disconnect();
      if (sidebarScrollbarHideRef.current) {
        clearTimeout(sidebarScrollbarHideRef.current);
      }
    };
  }, [updateSidebarScrollbar]);

  // Per-profile avatar/colour, so the active-sessions bar (which only knows a
  // run's profile name) can render real avatars. Refreshed when the selected
  // profile or the current view changes — e.g. after editing on the Agents page.
  const [profileAppearance, setProfileAppearance] = useState<
    Record<string, { color?: string | null; avatar?: string | null }>
  >({});
  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .listProfiles()
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, { color?: string; avatar?: string | null }> =
          {};
        for (const p of list)
          map[p.name] = { color: p.color, avatar: p.avatar };
        setProfileAppearance(map);
      })
      .catch(() => {
        /* keep last-known appearance */
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfile, view]);
  const getAppearance = useCallback(
    (profile: string) => profileAppearance[profile] ?? {},
    [profileAppearance],
  );

  // Per-run reporters wired into each <Chat>.
  const handleRunLoading = useCallback((runId: string, loading: boolean) => {
    setRuns((prev) => patchRun(prev, runId, { loading }));
  }, []);
  const handleRunSessionId = useCallback(
    (runId: string, sessionId: string | null) => {
      setRuns((prev) => patchRun(prev, runId, { sessionId }));
    },
    [],
  );
  const handleRunTitle = useCallback((runId: string, title: string) => {
    setRuns((prev) => patchRun(prev, runId, { title }));
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  // Full-list sessions modal (opened from the sidebar "Show more" affordance or
  // the Cmd/Ctrl+K menu action). Reuses the Sessions screen inside a modal —
  // there is no longer a top-level Sessions view.
  const [sessionsModalOpen, setSessionsModalOpen] = useState(false);
  // Tabs lazy-mount on first visit, then stay mounted (display:none toggle).
  // Keeps IPC refetch / DOM rebuild off the tab-switch hot path.
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["chat", "smartpuck"]),
  );

  const refreshSmartPuckLibrary = useCallback(() => {
    void window.hermesAPI.smartPuck
      .listLibrary()
      .then(setSmartPuckLibrary)
      .catch(() => {
        /* keep the previous library snapshot */
      });
  }, []);

  useEffect(() => {
    refreshSmartPuckLibrary();
    window.addEventListener(
      "smartpuck-library-changed",
      refreshSmartPuckLibrary,
    );
    return () => {
      window.removeEventListener(
        "smartpuck-library-changed",
        refreshSmartPuckLibrary,
      );
    };
  }, [refreshSmartPuckLibrary]);
  // Remote-only mode — SSH tunnel has full access; only pure HTTP remote mode restricts screens
  const [remoteMode, setRemoteMode] = useState(false);
  // Set by the Capabilities screen's "Browse" actions to focus a Discover tab
  // (Skills → Community, or MCPs). The nonce re-fires Discover's effect.
  const [discoverFocus, setDiscoverFocus] = useState<{
    kind: "skills" | "mcps";
    nonce: number;
  } | null>(null);

  const paneStyle = (target: View): React.CSSProperties => ({
    display: view === target ? "flex" : "none",
    flex: 1,
    minHeight: 0,
    flexDirection: "column",
    overflowX: "hidden",
    overflowY: target === "smartpuck" ? "auto" : "hidden",
    scrollbarGutter: target === "smartpuck" ? "stable" : undefined,
  });

  const goTo = useCallback((v: View) => {
    setVisitedViews((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
    setView(v);
  }, []);

  const focusDiscover = useCallback(
    (kind: "skills" | "mcps") => {
      setDiscoverFocus((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }));
      goTo("discover");
    },
    [goTo],
  );

  // Re-check remote mode on tab switch (picks up Settings changes)
  useEffect(() => {
    window.hermesAPI.isRemoteOnlyMode().then(setRemoteMode);
  }, [view]);

  // Restore the last-activated profile on launch. The main process persists it
  // in ~/.hermes/active_profile (via `hermes profile use`), so the desktop
  // should reopen on that profile rather than always resetting to "default".
  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .listProfiles()
      .then((profiles) => {
        if (cancelled) return;
        const active = profiles.find((p) => p.isActive);
        if (active && active.name !== "default") {
          setActiveProfile(active.name);
          // Re-home the initial pristine run onto the restored profile so the
          // first chat runs under the right agent (no session/turn yet).
          setRuns((prev) =>
            prev.length === 1 && !prev[0].sessionId && !prev[0].loading
              ? [{ ...prev[0], profile: active.name }]
              : prev,
          );
        }
      })
      .catch(() => {
        /* fall back to the default profile */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-update state
  const [updateState, setUpdateState] = useState<
    "available" | "downloading" | "ready" | "error" | null
  >(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    // Surface a startup upgrade button as soon as GitHub reports a newer
    // release. If auto-upgrade is enabled, electron-updater also downloads in
    // the background and this state advances to downloading/ready.
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateState("available");
      setUpdateVersion(info.version);
      setUpdateError(null);
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress(
      (info) => {
        setUpdateState("downloading");
        setUpdatePercent(info.percent);
        setUpdateError(null);
      },
    );
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
      setUpdatePercent(null);
      setUpdateError(null);
    });
    const cleanupError = window.hermesAPI.onUpdateError((message) => {
      setUpdateState("error");
      setUpdateError(message);
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  async function handleUpdate(): Promise<void> {
    if (updateState === "ready") {
      // The only user action: restart into the already-downloaded update.
      await window.hermesAPI.installUpdate();
    } else if (updateState === "available" || updateState === "error") {
      // Download the available update (or retry a failed auto-download).
      // Set downloading state immediately to prevent re-entrancy.
      setUpdateState("downloading");
      setUpdatePercent(null);
      setUpdateError(null);
      try {
        const ok = await window.hermesAPI.downloadUpdate();
        if (!ok) setUpdateState("error");
        // On success, we wait for the onUpdateDownloaded callback to set "ready"
      } catch (err) {
        setUpdateError(err instanceof Error ? err.message : String(err));
        setUpdateState("error");
      }
    }
  }

  const updateButtonTitle =
    updateError ??
    (updateState === "available" && updateVersion
      ? t("common.updateAvailable", { version: updateVersion })
      : updateState === "downloading"
        ? updatePercent === null
          ? t("common.downloading", { percent: 0 })
          : t("common.downloading", { percent: updatePercent })
        : updateState === "ready"
          ? t("common.restartToUpdate")
          : updateState === "error"
            ? t("common.updateFailed")
            : undefined);

  const handleNewChat = useCallback(() => {
    // Open a fresh run WITHOUT aborting others — any in-flight session keeps
    // streaming in the background and stays reachable via the active bar. If the
    // current chat is already a blank scratch, reuse it instead of stacking
    // another empty tab.
    const active = runs.find((r) => r.runId === activeRunId);
    const folder = smartPuckFolders.find(
      (item) => item.path === active?.initialContextFolder,
    );
    if (!folder) {
      goTo("smartpuck");
      return;
    }
    const run = mintRun(activeProfile, undefined, folder.path);
    run.title = folder.name;
    setRuns((prev) => [...prev, run]);
    setActiveRunId(run.runId);
    goTo("chat");
  }, [runs, activeRunId, activeProfile, goTo, smartPuckFolders]);

  // Listen for menu IPC events (Cmd+N, Cmd+K from app menu)
  useEffect(() => {
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => {
      handleNewChat();
    });
    const cleanupSearch = window.hermesAPI.onMenuSearchSessions(() => {
      setSessionsModalOpen(true);
    });
    return () => {
      cleanupNewChat();
      cleanupSearch();
    };
  }, [handleNewChat]);

  // Esc closes the full-list sessions modal.
  useEffect(() => {
    if (!sessionsModalOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSessionsModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionsModalOpen]);

  const handleSelectProfile = useCallback(
    (name: string) => {
      // Selecting an agent is administrative: switch the active profile (the
      // component already started its gateway via setActiveProfile). Existing
      // chats remain on their original profile, but the visible chat must move
      // to a scratch run for the selected profile so the footer and transport
      // never point at different agents.
      setActiveProfile(name);
      const next = selectProfileRunTransition(runs, activeRunId, name);
      setRuns(next.runs);
      setActiveRunId(next.activeRunId);
    },
    [runs, activeRunId],
  );

  // The "Chat" affordance: start (or reuse a blank) conversation with an agent
  // and show it. This is the only path from the profile list that opens a chat.
  const handleChatWithProfile = useCallback(
    (name: string) => {
      setActiveProfile(name);
      const active = runs.find((r) => r.runId === activeRunId);
      if (active && isScratchRun(active)) {
        setRuns((prev) =>
          prev.map((r) =>
            r.runId === active.runId ? { ...r, profile: name } : r,
          ),
        );
      } else {
        const run = mintRun(name);
        setRuns((prev) => [...prev, run]);
        setActiveRunId(run.runId);
      }
      goTo("chat");
    },
    [runs, activeRunId, goTo],
  );

  const handleChatWithSmartPuckFolder = useCallback(
    (folderPath: string, folderName: string) => {
      const run = mintRun(activeProfile, undefined, folderPath);
      run.title = folderName;
      setRuns((prev) => [...prev, run]);
      setActiveRunId(run.runId);
      goTo("chat");
    },
    [activeProfile, goTo],
  );

  const handleCreateSmartPuckFolder = useCallback(async (name: string) => {
    await window.hermesAPI.smartPuck.createFolder(name);
    const next = await window.hermesAPI.smartPuck.listLibrary();
    setSmartPuckLibrary(next);
    window.dispatchEvent(new Event("smartpuck-library-changed"));
  }, []);

  const handleRenameSmartPuckFolder = useCallback(
    async (folderId: string, name: string) => {
      const renamed = await window.hermesAPI.smartPuck.renameFolder(
        folderId,
        name,
      );
      setRuns((current) =>
        current.map((run) =>
          run.initialContextFolder === renamed.path
            ? { ...run, title: renamed.name }
            : run,
        ),
      );
      const next = await window.hermesAPI.smartPuck.listLibrary();
      setSmartPuckLibrary(next);
      window.dispatchEvent(new Event("smartpuck-library-changed"));
    },
    [],
  );

  const handleRenameSmartPuckSession = useCallback(
    async (sessionId: string, title: string) => {
      await window.hermesAPI.updateSessionTitle(sessionId, title);
      setRuns((current) =>
        current.map((run) =>
          run.sessionId === sessionId ? { ...run, title } : run,
        ),
      );
    },
    [],
  );



  // Jump to an already-open run (e.g. from the active-sessions bar), switching
  // the selected profile so the rest of the app follows the agent.
  const handleActivateRun = useCallback(
    (runId: string) => {
      const run = runs.find((r) => r.runId === runId);
      if (!run) return;
      setActiveRunId(runId);
      setActiveProfile(run.profile);
      goTo("chat");
    },
    [runs, goTo],
  );

  // Close a conversation tab: stop it if it's running, drop it from the list,
  // and (if it was active) move to a neighbour. Always keep at least one chat
  // open so the chat view is never empty.
  const handleCloseRun = useCallback(
    (runId: string) => {
      window.hermesAPI.abortChat(runId);
      const idx = runs.findIndex((r) => r.runId === runId);
      const remaining = runs.filter((r) => r.runId !== runId);
      if (remaining.length === 0) {
        const fresh = mintRun(activeProfile);
        setRuns([fresh]);
        setActiveRunId(fresh.runId);
        return;
      }
      setRuns(remaining);
      if (runId === activeRunId) {
        const neighbour = remaining[Math.min(idx, remaining.length - 1)];
        setActiveRunId(neighbour.runId);
        setActiveProfile(neighbour.profile);
      }
    },
    [runs, activeRunId, activeProfile],
  );

  const handleArchiveSmartPuckFolder = useCallback(
    async (folderId: string) => {
      const folder = smartPuckFolders.find((f) => f.id === folderId);
      if (!folder) return;
      if (
        !window.confirm(
          `Are you sure you want to archive the meeting folder "${folder.name}"? This hides it from your library.`
        )
      ) {
        return;
      }
      await window.hermesAPI.smartPuck.archiveItem(folderId, "folder");
      const folderRuns = runs.filter((r) => r.initialContextFolder === folder.path);
      for (const r of folderRuns) {
        handleCloseRun(r.runId);
      }
      refreshSmartPuckLibrary();
      window.dispatchEvent(new Event("smartpuck-library-changed"));
    },
    [smartPuckFolders, runs, handleCloseRun, refreshSmartPuckLibrary],
  );

  const handleArchiveSmartPuckSession = useCallback(
    async (sessionId: string) => {
      await window.hermesAPI.smartPuck.archiveItem(sessionId, "session");
      const run = runs.find((r) => r.sessionId === sessionId);
      if (run) {
        handleCloseRun(run.runId);
      }
    },
    [runs, handleCloseRun],
  );

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      // Already open as a live run? Re-attach to it (keeps live streaming).
      const live = findRunBySession(runs, sessionId);
      if (live) {
        handleActivateRun(live.runId);
        return;
      }
      // Guard against a double-click resuming the same session twice: the live
      // check above and the setRuns below straddle an await, so without this a
      // second click would pass the stale guard and mount a duplicate tab.
      if (resumingRef.current.has(sessionId)) return;
      resumingRef.current.add(sessionId);
      setResumingSessionId(sessionId);
      try {
        const items = (await window.hermesAPI.getSessionMessages(
          sessionId,
        )) as DbHistoryItem[];
        const run = mintRun(activeProfile, dbItemsToChatMessages(items));
        run.sessionId = sessionId;
        setRuns(
          (prev) => openSessionRunTransition(prev, activeRunId, run).runs,
        );
        setActiveRunId(run.runId);
        goTo("chat");
      } finally {
        resumingRef.current.delete(sessionId);
        setResumingSessionId(null);
      }
    },
    [runs, activeRunId, handleActivateRun, activeProfile, goTo],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  }, []);

  const sidebarToggleLabel = sidebarCollapsed
    ? t("navigation.expandSidebar")
    : t("navigation.collapseSidebar");

  return (
    <div className={`layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="smartpuck-sidebar-brand" aria-label="SmartPuck">
            <AudioLines size={20} />
            <span>SMARTPUCK</span>
          </div>
          <button
            className="sidebar-collapse-toggle"
            type="button"
            onClick={toggleSidebar}
            title={sidebarToggleLabel}
            aria-label={sidebarToggleLabel}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </button>
        </div>

        <nav className="sidebar-nav sidebar-nav-pinned">
          {PINNED_NAV_ITEMS.map(({ view: v, icon: Icon, labelKey }) => {
            const label = labelKey.startsWith("navigation.")
              ? t(labelKey)
              : labelKey;
            return (
              <button
                key={v}
                className={`sidebar-nav-item ${view === v ? "active" : ""}`}
                onClick={() => goTo(v)}
                title={label}
                aria-label={label}
              >
                {(v !== "smartpuck" || sidebarCollapsed) && <Icon size={16} />}
                <span className="sidebar-nav-label">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-chat-section">
          <div className="sidebar-nav-sessions">
            <div className="sidebar-chat-scroll" ref={sidebarChatScrollRef}>
              <SidebarRecentSessions
                open={!sidebarCollapsed}
                activeProfile={activeProfile}
                currentSessionId={currentSessionId}
                loadingSessionIds={loadingSessionIds}
                resumingSessionId={resumingSessionId}
                onSelect={handleResumeSession}
                folders={smartPuckFolders}
                onNewFolderChat={handleChatWithSmartPuckFolder}
                onCreateFolder={handleCreateSmartPuckFolder}
                onRenameFolder={handleRenameSmartPuckFolder}
                onRenameSession={handleRenameSmartPuckSession}
                onArchiveFolder={handleArchiveSmartPuckFolder}
                onArchiveSession={handleArchiveSmartPuckSession}
                scrollRootRef={sidebarChatScrollRef}
              />
            </div>
            {sidebarScrollbar.scrollable && (
              <div
                className={`sidebar-chat-scrollbar ${
                  sidebarScrollbar.visible ? "visible" : ""
                }`}
                aria-hidden="true"
              >
                <div
                  className="sidebar-chat-scrollbar-thumb"
                  style={{
                    height: sidebarScrollbar.height,
                    transform: `translateY(${sidebarScrollbar.top}px)`,
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          {/* Show an upgrade affordance at startup when GitHub has a newer
              release; it becomes a restart action once downloaded. */}
          {updateState && (
            <button
              className={`sidebar-update-btn ${
                updateState === "error" ? "error" : ""
              }`}
              onClick={handleUpdate}
              disabled={updateState === "downloading"}
              title={updateButtonTitle}
              aria-label={updateButtonTitle}
            >
              <Download size={13} />
              {updateState === "available" && (
                <span>
                  {updateVersion
                    ? t("common.updateAvailable", { version: updateVersion })
                    : t("common.updateAvailable", { version: "" })}
                </span>
              )}
              {updateState === "downloading" && (
                <span>
                  {t("common.downloading", { percent: updatePercent ?? 0 })}
                </span>
              )}
              {updateState === "ready" && (
                <span>{t("common.restartToUpdate")}</span>
              )}
              {updateState === "error" && (
                <span>{t("common.updateFailed")}</span>
              )}
            </button>
          )}
          <div className="sidebar-footer-actions" aria-label="Workspace tools">
            {FOOTER_NAV_ITEMS.map(({ view: v, icon: Icon, labelKey }) => (
              <button
                key={v}
                className={`sidebar-footer-action ${view === v ? "active" : ""}`}
                onClick={() => goTo(v)}
                aria-label={t(labelKey)}
                data-tooltip={t(labelKey)}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="content">
        {/* Doubles as the window drag strip — keep it first so it owns the top
            band; the warning banner (if any) sits just below it. */}
        <ActiveSessionsBar
          runs={runs}
          activeRunId={activeRunId}
          onSelect={handleActivateRun}
          onClose={handleCloseRun}
          onNew={handleNewChat}
          getAppearance={getAppearance}
        />
        {verifyWarning && onReinstall && onDismissVerifyWarning && (
          <VerifyWarningBanner
            onReinstall={onReinstall}
            onDismiss={onDismissVerifyWarning}
          />
        )}
        <div style={paneStyle("chat")}>
          {runs.map((run) => (
            <div
              key={run.runId}
              style={{
                display:
                  view === "chat" && run.runId === activeRunId
                    ? "flex"
                    : "none",
                flex: 1,
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <Chat
                runId={run.runId}
                initialMessages={run.seed}
                initialSessionId={run.sessionId}
                active={run.runId === activeRunId}
                profile={run.profile}
                onNewChat={handleNewChat}
                onOpenDiagnose={() => goTo("settings")}
                onLoadingChange={handleRunLoading}
                onSessionIdChange={handleRunSessionId}
                onTitleChange={handleRunTitle}
                initialContextFolder={run.initialContextFolder}
              />
            </div>
          ))}
        </div>

        {visitedViews.has("smartpuck") && (
          <div style={paneStyle("smartpuck")}>
            {remoteMode ? (
              <RemoteNotice feature="SmartPuck" />
            ) : (
              <SmartPuck
                playingId={playingId}
                audioPlaying={audioPlaying}
                onPlayPauseAudio={handlePlayPauseAudio}
                audioUrl={audioUrl}
                onPlayDeviceAudio={handlePlayDeviceAudio}
              />
            )}
          </div>
        )}

        {sessionsModalOpen && (
          <div
            className="models-modal-overlay"
            onClick={() => setSessionsModalOpen(false)}
          >
            <div
              className="sessions-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <Sessions
                onResumeSession={(id) => {
                  setSessionsModalOpen(false);
                  void handleResumeSession(id);
                }}
                onNewChat={() => {
                  setSessionsModalOpen(false);
                  handleNewChat();
                }}
                currentSessionId={currentSessionId}
                visible={sessionsModalOpen}
              />
            </div>
          </div>
        )}

        {visitedViews.has("discover") && (
          <div style={paneStyle("discover")}>
            {remoteMode ? (
              <RemoteNotice feature="Discover" />
            ) : (
              <Discover
                profile={activeProfile}
                visible={view === "discover"}
                focusKind={discoverFocus ?? undefined}
              />
            )}
          </div>
        )}

        {visitedViews.has("agents") && (
          <div style={paneStyle("agents")}>
            {remoteMode ? (
              <RemoteNotice feature="Profiles" />
            ) : (
              <Agents
                activeProfile={activeProfile}
                onSelectProfile={handleSelectProfile}
                onChatWith={handleChatWithProfile}
              />
            )}
          </div>
        )}

        {visitedViews.has("office") && (
          <div style={paneStyle("office")}>
            <Office profile={activeProfile} visible={view === "office"} />
          </div>
        )}

        {visitedViews.has("providers") && (
          <div style={paneStyle("providers")}>
            {remoteMode ? (
              <RemoteNotice feature="Providers" />
            ) : (
              <Providers
                profile={activeProfile}
                visible={view === "providers"}
              />
            )}
          </div>
        )}

        {visitedViews.has("skills") && (
          <div style={paneStyle("skills")}>
            {remoteMode ? (
              <RemoteNotice feature="Skills" />
            ) : (
              <Skills profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("memory") && (
          <div style={paneStyle("memory")}>
            {remoteMode ? (
              <RemoteNotice feature="Memory" />
            ) : (
              <Memory profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("tools") && (
          <div style={paneStyle("tools")}>
            <Tools
              profile={activeProfile}
              showPlatformToolsets={!remoteMode}
              remoteMode={remoteMode}
              visible={view === "tools"}
              onBrowseSkills={() => focusDiscover("skills")}
              onBrowseMcps={() => focusDiscover("mcps")}
            />
          </div>
        )}

        {visitedViews.has("schedules") && (
          <div style={paneStyle("schedules")}>
            <Schedules profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("kanban") && (
          <div style={paneStyle("kanban")}>
            {remoteMode ? (
              <RemoteNotice feature="Kanban" />
            ) : (
              <Kanban profile={activeProfile} visible={view === "kanban"} />
            )}
          </div>
        )}

        {visitedViews.has("gateway") && (
          <div style={paneStyle("gateway")}>
            {remoteMode ? (
              <RemoteNotice feature="Gateway" />
            ) : (
              <Gateway profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("settings") && (
          <div style={paneStyle("settings")}>
            <Settings profile={activeProfile} />
          </div>
        )}

        {playingId && audioUrl && (
          <div className="smartpuck-audio-player-bar" style={{
            flexShrink: 0,
            background: "var(--bg-secondary)",
            borderTop: "1px solid var(--border)",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            boxShadow: "0 -4px 12px rgba(0, 0, 0, 0.15)",
            zIndex: 10
          }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Now Playing
              </span>
              <strong style={{ fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {audioTitle || "Audio"}
              </strong>
            </div>

            <div style={{ flex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                className="smartpuck-recording-icon"
                onClick={async () => {
                  if (audioRef.current) {
                    if (audioPlaying) {
                      audioRef.current.pause();
                      setAudioPlaying(false);
                    } else {
                      try {
                        await audioRef.current.play();
                        setAudioPlaying(true);
                      } catch (e) {
                        console.error(e);
                      }
                    }
                  }
                }}
                style={{
                  width: 32,
                  height: 32,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "var(--radius-sm)",
                  background: "color-mix(in srgb, var(--accent) 12%, var(--bg-primary))",
                  color: "var(--accent)",
                  border: "none",
                  cursor: "pointer"
                }}
              >
                {audioPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", maxWidth: 500 }}>
                <span style={{ fontSize: 11, color: "var(--text-secondary)", minWidth: 35, textAlign: "right" }}>
                  {formatTime(audioCurrentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={audioDuration || 100}
                  value={audioCurrentTime}
                  className="smartpuck-audio-slider"
                  onChange={(e) => {
                    const t = parseFloat(e.target.value);
                    setAudioCurrentTime(t);
                    if (audioRef.current) audioRef.current.currentTime = t;
                  }}
                  style={{
                    WebkitAppearance: "none",
                    width: "100%",
                    height: 4,
                    borderRadius: 2,
                    background: "var(--border)",
                    outline: "none",
                    cursor: "pointer"
                  }}
                />
                <span style={{ fontSize: 11, color: "var(--text-secondary)", minWidth: 35 }}>
                  {formatTime(audioDuration)}
                </span>
              </div>
            </div>

            <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="smartpuck-icon-btn"
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.pause();
                  }
                  setPlayingId(null);
                  setAudioUrl(null);
                  setAudioPlaying(false);
                }}
                title="Close player"
                aria-label="Close player"
                style={{
                  width: 32,
                  height: 32,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  cursor: "pointer"
                }}
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default Layout;

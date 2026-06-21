"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Streamdown } from "streamdown";
import {
  AlertCircle,
  Archive,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  CircleHelp,
  Download,
  FileText,
  Folder,
  GraduationCap,
  Grip,
  HelpCircle,
  LoaderCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Plus,
  Radio,
  Search,
  Settings,
  Share2,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import type {
  ChatAttachment,
  DashboardData,
  DeviceTransport,
  MeetingMessage,
  MeetingRecord,
  WorkspaceShellMode,
} from "@/lib/workspace-types";
import {
  buildOptimisticChatTurn,
  deriveComposerSendState,
  deriveMeetingStatusPill,
  mergeServerAndOptimisticMessages,
  removeOptimisticChatTurn,
  settleOptimisticChatTurnWithError,
  type MeetingStatusPill,
} from "@/lib/smartpuck-chat";
import {
  deletePuckSession,
  downloadPuckSessionBlob,
  deletePuckWifiNetwork,
  fetchPuckWifiConfig,
  fetchWithTimeout,
  formatTranscriptionText,
  getDeviceSessionKey,
  getSessionImportKey,
  getTranscriptionDurationMinutes,
  normalizePuckBaseUrl,
  normalizeSmartPuckSessions,
  savePuckWifiNetwork,
  type SmartPuckSession,
  type SmartPuckStatus,
  type SmartPuckWifiConfig,
} from "@/lib/smartpuck-device";

type WorkspaceShellProps = {
  dashboard: DashboardData;
  liveMessages?: MeetingMessage[] | null;
  mode: WorkspaceShellMode;
  isMutating: boolean;
  fallbackFolderId: string | null;
  initialPuckAddress?: string | null;
  onCreateFolder: (name: string) => Promise<string | void> | string | void;
  onDeleteFolder: (folderId: string) => void | Promise<void>;
  onCreateChat: (folderId: string) => Promise<string | void> | string | void;
  onConnectDevice: (
    folderId: string,
    transport: DeviceTransport,
  ) => Promise<string | void> | string | void;
  onSelectMeeting: (meetingId: string) => void;
  onDeleteMeeting: (meetingId: string) => void | Promise<void>;
  onSendMessage: (meetingId: string, body: string, privateContext?: string) => void | Promise<void>;
  onCreateMeetingWithAudio?: (args: {
    folderId: string;
    title: string;
    transport: DeviceTransport;
    audioFileId?: string;
    audioFileName?: string;
    transcriptText: string;
    transcriptJson?: string;
    deviceSessionKey?: string;
    deviceSessionPath?: string;
    durationLabel: string;
    transferredMb: number;
    audioHours: number;
  }) => Promise<string>;
};

type WorkspaceView =
  | "recent-sessions"
  | "new-recording"
  | "archives"
  | "lecture-series"
  | "help"
  | "settings";

type WorkspaceTab = "dashboard" | "transcripts" | "device";
type PuckConnectionState = "idle" | "checking" | "connected" | "listening" | "recording" | "error";
type TranscriptionProfile = "auto" | "english-fast" | "khmer-better" | "khmer-tiny" | "high-quality";
type ImportStatus = {
  state: "idle" | "working" | "done" | "error";
  message: string;
  detail?: string;
  meetingId?: string;
};
const DEFAULT_PUCK_ADDRESS = "http://192.168.4.1";

const TRANSCRIPTION_PROFILES: Array<{
  id: TranscriptionProfile;
  label: string;
  hint: string;
}> = [
  { id: "auto", label: "Auto", hint: "Routes by language" },
  { id: "english-fast", label: "English fast", hint: "Small English model" },
  { id: "khmer-better", label: "Khmer better", hint: "Specialist model" },
  { id: "khmer-tiny", label: "Khmer tiny", hint: "Lower resource" },
  { id: "high-quality", label: "High quality", hint: "Turbo fallback" },
];

const ARCHIVE_ITEMS = [
  {
    icon: "folder" as const,
    title: "Q2 Earnings Prep",
    meta: "Last accessed 3 months ago - 4 sessions",
  },
  {
    icon: "document" as const,
    title: "Product Dev Lifecycle v1",
    meta: "Archived Oct 2023 - 12 transcripts",
  },
  {
    icon: "folder" as const,
    title: "2022 Marketing Retreat",
    meta: "Archived Jan 2023 - 2 session files",
  },
];

const ICON_MAP: Record<string, React.ReactNode> = {
  sparkles: <Sparkles className="h-4 w-4 opacity-60" />,
  grip: <Grip className="h-4 w-4 opacity-60" />,
  search: <Search className="h-4 w-4 opacity-60" />,
  settings: <Settings className="h-4 w-4 opacity-60" />,
  help: <HelpCircle className="h-4 w-4 opacity-60" />,
  alert: <AlertCircle className="h-4 w-4 opacity-60 text-amber-500" />,
};

const LECTURE_CARDS = [
  {
    title: "Navigating Market Shifts",
    category: "Leadership",
    duration: "45 MIN",
    description: "Guest lecture on dynamic pricing models during economic downturns.",
    background:
      "linear-gradient(135deg, rgba(15,23,42,0.18), rgba(255,255,255,0.05)), radial-gradient(circle at 20% 20%, rgba(255,255,255,0.8), transparent 30%), linear-gradient(135deg, #cbd5e1, #94a3b8)",
  },
  {
    title: "Design Systems v2",
    category: "Design",
    duration: "1H 15M",
    description: "Workshop on migrating our legacy CSS into the new Figma design system.",
    background:
      "linear-gradient(135deg, rgba(15,23,42,0.08), rgba(255,255,255,0.08)), radial-gradient(circle at 70% 25%, rgba(255,255,255,0.65), transparent 32%), linear-gradient(135deg, #e5e7eb, #94a3b8)",
  },
  {
    title: "Microservices at Scale",
    category: "Engineering",
    duration: "50 MIN",
    description: "Deep dive into deploying Kubernetes clusters for parallel processing.",
    background:
      "linear-gradient(135deg, rgba(15,23,42,0.2), rgba(255,255,255,0.06)), radial-gradient(circle at 45% 30%, rgba(255,255,255,0.65), transparent 28%), linear-gradient(135deg, #dbeafe, #64748b)",
  },
];

const HELP_ITEMS = [
  {
    title: "How does SmartPuck synthesize insights?",
    body: "",
    open: false,
  },
  {
    title: "Can I export transcripts to Notion?",
    body:
      'Yes. You can export any transcript or summary directly to Notion, Google Docs, or download it as a PDF. Click the "Export" button in the top right header of any session.',
    open: true,
  },
  {
    title: "Where are my archives stored?",
    body: "",
    open: false,
  },
];

const ATTACHMENT_TEXT_TYPES = new Set([
  "application/json",
  "application/pdf",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

const MAX_ATTACHMENT_PREVIEW_CHARS = 2500;
const MOTION_EXIT_MS = 120;
const DRAFT_STORAGE_PREFIX = "smartpuck:chat-draft:";
const REMOVED_STARTER_MESSAGE =
  "New chat saved. Ask me about SmartPuck's offline recorder, hardware prototype, transcript pipeline, image context, structured notes, or future roadmap.";
export function WorkspaceShell({
  dashboard,
  liveMessages,
  mode,
  isMutating,
  fallbackFolderId,
  initialPuckAddress,
  onCreateFolder,
  onDeleteFolder,
  onCreateChat,
  onConnectDevice,
  onSelectMeeting,
  onDeleteMeeting,
  onSendMessage,
  onCreateMeetingWithAudio,
}: WorkspaceShellProps) {
  const [activeView, setActiveView] = useState<WorkspaceView>("recent-sessions");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("dashboard");
  const animatedTab = useAnimatedValue(activeTab, MOTION_EXIT_MS);
  const animatedView = useAnimatedValue(activeView, MOTION_EXIT_MS);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>([]);
  const [draftFolder, setDraftFolder] = useState("");
  const [creatingChatFolderId, setCreatingChatFolderId] = useState<string | null>(null);
  const [deletingMeetingId, setDeletingMeetingId] = useState<string | null>(null);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [pendingMessagesByMeeting, setPendingMessagesByMeeting] = useState<Record<string, MeetingMessage[]>>({});
  const [sendingMeetingId, setSendingMeetingId] = useState<string | null>(null);
  const [showFolderComposer, setShowFolderComposer] = useState(false);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    dashboard.folders.forEach((folder, index) => {
      initial[folder.id] = folder.id === dashboard.activeMeeting?.folderId || index === 0;
    });
    return initial;
  });
  const [pendingTransport, setPendingTransport] = useState<DeviceTransport>("wifi");
  const [showInlineFolderCreator, setShowInlineFolderCreator] = useState(false);
  const [inlineFolderName, setInlineFolderName] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus>({
    state: "idle",
    message: "Ready to import audio.",
  });
  const setTranscriptionProgressMessage = useCallback((message: string) => {
    setImportStatus((current) =>
      current.state === "done"
        ? current
        : {
            ...current,
            state: "working",
            message,
          },
    );
  }, []);
  const [transcriptionServerState, setTranscriptionServerState] = useState<"unknown" | "ready" | "offline">("unknown");
  const [transcriptionProfile, setTranscriptionProfile] = useState<TranscriptionProfile>("auto");
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const [importFolderId, setImportFolderId] = useState(fallbackFolderId || "");
  const [isImportFolderMenuOpen, setIsImportFolderMenuOpen] = useState(false);
  const [prevFallbackFolderId, setPrevFallbackFolderId] = useState(fallbackFolderId);
  if (fallbackFolderId !== prevFallbackFolderId) {
    setPrevFallbackFolderId(fallbackFolderId);
    setImportFolderId(fallbackFolderId || "");
  }
  const [puckAddress, setPuckAddress] = useState(DEFAULT_PUCK_ADDRESS);
  const [showPuckAddressEditor, setShowPuckAddressEditor] = useState(false);
  const [puckState, setPuckState] = useState<PuckConnectionState>("idle");
  const [puckStatus, setPuckStatus] = useState("SmartPuck will be detected automatically when it is on the same network.");
  const [latestPuckStatus, setLatestPuckStatus] = useState<SmartPuckStatus | null>(null);
  const [puckWifiConfig, setPuckWifiConfig] = useState<SmartPuckWifiConfig | null>(null);
  const [wifiSetupSsid, setWifiSetupSsid] = useState("");
  const [wifiSetupPassword, setWifiSetupPassword] = useState("");
  const [wifiSetupMessage, setWifiSetupMessage] = useState("");
  const [isSavingWifiSetup, setIsSavingWifiSetup] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingBytes, setRecordingBytes] = useState(0);
  const [recordingDownloadUrl, setRecordingDownloadUrl] = useState<string | null>(null);
  const [recordingFileName, setRecordingFileName] = useState<string | null>(null);
  const [isLinkingRecording, setIsLinkingRecording] = useState(false);
  const [puckSessions, setPuckSessions] = useState<SmartPuckSession[]>([]);
  const [isLoadingPuckSessions, setIsLoadingPuckSessions] = useState(false);
  const [importingSessionPath, setImportingSessionPath] = useState<string | null>(null);
  const [importedSessionKeys, setImportedSessionKeys] = useState<Set<string>>(() => new Set());
  const [isDeviceRecordingActionPending, setIsDeviceRecordingActionPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isSendingRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamChunksRef = useRef<Uint8Array[]>([]);
  const streamPcmBytesRef = useRef(0);
  const streamHeaderBytesToSkipRef = useRef(44);
  const recordingEnabledRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const activeAudioSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const activeMeeting = dashboard.activeMeeting
    ? { ...dashboard.activeMeeting, messages: liveMessages ?? dashboard.activeMeeting.messages }
    : null;
  const activeMeetingId = activeMeeting?.id ?? null;
  const currentPuckBaseUrl = useMemo(() => {
    return normalizePuckBaseUrl(puckAddress, DEFAULT_PUCK_ADDRESS);
  }, [puckAddress]);
  const activePendingMessages = activeMeetingId ? (pendingMessagesByMeeting[activeMeetingId] ?? []) : [];
  const visibleFolders = useMemo(() => dashboard.folders, [dashboard.folders]);
  const autoCheckedPuckAddressRef = useRef<string | null>(null);

  const normalizedPuckBaseUrl = useCallback(() => {
    const trimmed = puckAddress.trim();
    if (!trimmed) {
      throw new Error("Enter the SmartPuck IP address first.");
    }

    return currentPuckBaseUrl;
  }, [currentPuckBaseUrl, puckAddress]);

  const rememberImportedSession = useCallback(
    (baseUrl: string, sessionPath: string) => {
      const key = getSessionImportKey(baseUrl, sessionPath);
      window.localStorage.setItem(key, "1");
      setImportedSessionKeys((current) => new Set(current).add(key));
    },
    [],
  );

  const refreshPuckSessions = useCallback(
    async (baseUrl: string) => {
      setIsLoadingPuckSessions(true);
      try {
        const response = await fetchWithTimeout(`${baseUrl}/sessions`, 4000);
        if (!response.ok) {
          setPuckSessions([]);
          return;
        }

        const sessions = normalizeSmartPuckSessions(await response.json());
        setPuckSessions(sessions);
        setImportedSessionKeys(() => {
          const next = new Set<string>();
          sessions.forEach((session) => {
            const key = getSessionImportKey(baseUrl, session.sessionPath);
            if (session.uploaded || window.localStorage.getItem(key) === "1") {
              next.add(key);
            }
          });
          return next;
        });
      } catch {
        setPuckSessions([]);
      } finally {
        setIsLoadingPuckSessions(false);
      }
    },
    [],
  );

  const refreshPuckWifiConfig = useCallback(async (baseUrl: string) => {
    try {
      const config = await fetchPuckWifiConfig(baseUrl);
      setPuckWifiConfig(config);
      setWifiSetupMessage("");
    } catch {
      setPuckWifiConfig(null);
    }
  }, []);

  const checkTranscriptionServer = useCallback(async () => {
    try {
      const response = await fetch("http://127.0.0.1:8000/health", { cache: "no-store" });
      setTranscriptionServerState(response.ok ? "ready" : "offline");
    } catch {
      setTranscriptionServerState("offline");
    }
  }, []);

  const checkPuckConnection = useCallback(async () => {
    setPuckState("checking");
    setPuckStatus("Checking SmartPuck over Wi-Fi...");

    try {
      const baseUrl = normalizedPuckBaseUrl();
      const response = await fetchWithTimeout(`${baseUrl}/status`, 5000);
      if (!response.ok) {
        throw new Error(`SmartPuck returned HTTP ${response.status}.`);
      }

        const status = (await response.json()) as SmartPuckStatus;
      window.localStorage.setItem("smartpuck:puck-address", baseUrl);
      setLatestPuckStatus(status);
      setPuckAddress(baseUrl);
      setShowPuckAddressEditor(false);
      setPuckState("connected");
      const statusText = `Connected. ${status.network ?? "SmartPuck Wi-Fi"} - ${status.storage ?? "audio stream ready"}.`;
      setPuckStatus(statusText);
      await refreshPuckWifiConfig(baseUrl);
      await refreshPuckSessions(baseUrl);
    } catch (error) {
      setPuckState("error");
      setShowPuckAddressEditor(true);
      setPuckStatus(error instanceof Error ? error.message : "Could not reach SmartPuck.");
    }
  }, [normalizedPuckBaseUrl, refreshPuckSessions, refreshPuckWifiConfig]);

  const autoFindPuck = useCallback(async () => {
    const candidates = [
      initialPuckAddress,
      typeof window !== "undefined" ? window.localStorage.getItem("smartpuck:puck-address") : null,
      "http://smartpuck.local",
      DEFAULT_PUCK_ADDRESS,
    ].filter((candidate): candidate is string => Boolean(candidate));
    const uniqueCandidates = Array.from(new Set(candidates.map((candidate) => candidate.replace(/\/+$/, ""))));

    setPuckState("checking");
    setPuckStatus("Looking for SmartPuck over local Wi-Fi...");

    for (const candidate of uniqueCandidates) {
      try {
        const response = await fetchWithTimeout(`${candidate}/status`, 2500);
        if (!response.ok) {
          continue;
        }

      const status = (await response.json()) as SmartPuckStatus;
        window.localStorage.setItem("smartpuck:puck-address", candidate);
        setLatestPuckStatus(status);
        setPuckAddress(candidate);
        setShowPuckAddressEditor(false);
        setPuckState("connected");
        setPuckStatus(`SmartPuck found. ${status.network ?? "Local Wi-Fi"} - ${status.storage ?? "audio ready"}.`);
        await refreshPuckWifiConfig(candidate);
        await refreshPuckSessions(candidate);
        return;
      } catch {
        // Try the next known local address.
      }
    }

    setPuckState("error");
    setPuckStatus("No SmartPuck found yet. Import an audio file, or enter the device address manually.");
  }, [initialPuckAddress, refreshPuckSessions, refreshPuckWifiConfig]);

  const refreshPuckStatus = useCallback(async () => {
    const baseUrl = normalizedPuckBaseUrl();
    const response = await fetchWithTimeout(`${baseUrl}/status`, 4000);
    if (!response.ok) {
      throw new Error(`SmartPuck returned HTTP ${response.status}.`);
    }
    const status = (await response.json()) as SmartPuckStatus;
    setLatestPuckStatus(status);
    if (status.recording) {
      setPuckStatus(`SmartPuck is recording on-device. ${formatBytes(status.audioSize ?? 0)} captured.`);
    } else if (status.lastError) {
      setPuckStatus(status.lastError);
    } else {
      setPuckStatus(`Connected. ${status.network ?? "SmartPuck Wi-Fi"} - ${status.storage ?? "audio stream ready"}.`);
    }
    return status;
  }, [normalizedPuckBaseUrl]);

  async function startDeviceRecording() {
    if (isDeviceRecordingActionPending || isTranscribing) {
      return;
    }

    setIsDeviceRecordingActionPending(true);
    setPuckStatus("Starting recording on SmartPuck...");
    try {
      const baseUrl = normalizedPuckBaseUrl();
      const response = await fetchWithTimeout(`${baseUrl}/start_record`, 7000);
      if (!response.ok) {
        throw new Error(`SmartPuck could not start recording (${response.status}).`);
      }
      await refreshPuckStatus();
      await refreshPuckSessions(baseUrl);
    } catch (error) {
      setPuckStatus(error instanceof Error ? error.message : "Could not start SmartPuck recording.");
    } finally {
      setIsDeviceRecordingActionPending(false);
    }
  }

  async function stopDeviceRecording() {
    if (isDeviceRecordingActionPending || isTranscribing) {
      return;
    }

    setIsDeviceRecordingActionPending(true);
    setPuckStatus("Stopping SmartPuck recording...");
    try {
      const baseUrl = normalizedPuckBaseUrl();
      const response = await fetchWithTimeout(`${baseUrl}/stop_record`, 10000);
      if (!response.ok) {
        throw new Error(`SmartPuck could not stop recording (${response.status}).`);
      }
      await refreshPuckStatus();
      await refreshPuckSessions(baseUrl);
      setPuckStatus("Recording saved on SmartPuck. Import it when you are ready.");
    } catch (error) {
      setPuckStatus(error instanceof Error ? error.message : "Could not stop SmartPuck recording.");
    } finally {
      setIsDeviceRecordingActionPending(false);
    }
  }

  async function saveWifiSetup() {
    const ssid = wifiSetupSsid.trim();
    if (!ssid) {
      setWifiSetupMessage("Enter the Wi-Fi name first.");
      return;
    }

    setIsSavingWifiSetup(true);
    setWifiSetupMessage("Saving Wi-Fi to SmartPuck...");
    try {
      await savePuckWifiNetwork(currentPuckBaseUrl, ssid, wifiSetupPassword);
      setWifiSetupPassword("");
      setWifiSetupMessage("Saved. SmartPuck is restarting. Use Find after it rejoins Wi-Fi.");
      setPuckStatus("Wi-Fi saved. SmartPuck is restarting and will reconnect automatically if the network is reachable.");
      setPuckState("idle");
      setPuckSessions([]);
    } catch (error) {
      setWifiSetupMessage(error instanceof Error ? error.message : "Could not save Wi-Fi.");
    } finally {
      setIsSavingWifiSetup(false);
    }
  }

  async function deleteWifiSetup(ssid: string) {
    setIsSavingWifiSetup(true);
    setWifiSetupMessage(`Removing ${ssid}...`);
    try {
      await deletePuckWifiNetwork(currentPuckBaseUrl, ssid);
      await refreshPuckWifiConfig(currentPuckBaseUrl);
      setWifiSetupMessage(`Removed ${ssid}.`);
    } catch (error) {
      setWifiSetupMessage(error instanceof Error ? error.message : "Could not remove Wi-Fi.");
    } finally {
      setIsSavingWifiSetup(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    const loadDraft = () => {
      if (cancelled) {
        return;
      }
      if (!activeMeetingId || typeof window === "undefined") {
        setDraftMessage("");
        return;
      }

      setDraftMessage(window.localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${activeMeetingId}`) ?? "");
    };

    loadDraft();
    return () => {
      cancelled = true;
    };
  }, [activeMeetingId]);

  useEffect(() => {
    if (!activeMeetingId || typeof window === "undefined") {
      return;
    }

    const draftKey = `${DRAFT_STORAGE_PREFIX}${activeMeetingId}`;
    const timer = window.setTimeout(() => {
      if (draftMessage.trim()) {
        window.localStorage.setItem(draftKey, draftMessage);
      } else {
        window.localStorage.removeItem(draftKey);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeMeetingId, draftMessage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const saved = window.localStorage.getItem("smartpuck:puck-address");
    const target = saved || initialPuckAddress || DEFAULT_PUCK_ADDRESS;
    const timeout = setTimeout(() => {
      setPuckAddress(target);
    }, 0);
    return () => clearTimeout(timeout);
  }, [initialPuckAddress]);

  useEffect(() => {
    if (
      activeView !== "new-recording" ||
      puckState !== "idle" ||
      autoCheckedPuckAddressRef.current === "auto"
    ) {
      return;
    }

    autoCheckedPuckAddressRef.current = "auto";
    void checkTranscriptionServer();
    void autoFindPuck();
  }, [activeView, puckState, autoFindPuck, checkTranscriptionServer]);

  useEffect(() => {
    if (puckState !== "recording" || recordingStartedAt === null) {
      return;
    }

    const interval = window.setInterval(() => {
      setRecordingBytes(streamPcmBytesRef.current);
    }, 250);

    return () => window.clearInterval(interval);
  }, [puckState, recordingStartedAt]);

  useEffect(() => {
    if (activeView !== "new-recording" || !latestPuckStatus?.recording) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshPuckStatus().catch(() => {
        setPuckStatus("SmartPuck is recording, but the status check dropped. It will refresh when the connection returns.");
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [activeView, latestPuckStatus?.recording, refreshPuckStatus]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      activeAudioSourcesRef.current.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Sources may already have ended naturally.
        }
      });
      void audioContextRef.current?.close();
      if (recordingDownloadUrl) {
        URL.revokeObjectURL(recordingDownloadUrl);
      }
    };
  }, [recordingDownloadUrl]);



  function isFolderOpen(folderId: string) {
    if (openFolders[folderId] !== undefined) {
      return openFolders[folderId];
    }
    const index = visibleFolders.findIndex((f) => f.id === folderId);
    return folderId === dashboard.activeMeeting?.folderId || index === 0;
  }

  function toggleFolder(folderId: string) {
    setOpenFolders((current) => ({
      ...current,
      [folderId]: !isFolderOpen(folderId),
    }));
  }

  async function submitFolder() {
    const trimmed = draftFolder.trim();
    if (!trimmed) {
      return;
    }

    await onCreateFolder(trimmed);
    setDraftFolder("");
    setShowFolderComposer(false);
  }

  function openMeeting(meetingId: string) {
    setDraftAttachments([]);
    setActiveView("recent-sessions");
    setActiveTab("dashboard");
    onSelectMeeting(meetingId);
  }

  async function deleteMeeting(meetingId: string) {
    setDeletingMeetingId(meetingId);
    try {
      await Promise.resolve(onDeleteMeeting(meetingId));
    } finally {
      setDeletingMeetingId(null);
    }
  }

  async function deleteFolder(folderId: string) {
    setDeletingFolderId(folderId);
    try {
      await Promise.resolve(onDeleteFolder(folderId));
      setOpenFolders((current) => {
        const next = { ...current };
        delete next[folderId];
        return next;
      });
    } finally {
      setDeletingFolderId(null);
    }
  }

  async function createChat(folderId: string) {
    setCreatingChatFolderId(folderId);
    setOpenFolders((current) => ({ ...current, [folderId]: true }));
    setActiveView("recent-sessions");
    setActiveTab("dashboard");

    try {
      const meetingId = await Promise.resolve(onCreateChat(folderId));
      if (typeof meetingId === "string") {
        onSelectMeeting(meetingId);
      }
    } finally {
      setCreatingChatFolderId(null);
    }
  }

  function showNewRecording() {
    setActiveView("new-recording");
    setPendingTransport("wifi");
    setImportFolderId(fallbackFolderId || "");
    setIsImportFolderMenuOpen(false);
    setImportStatus({ state: "idle", message: "Ready to import audio." });
    setTranscriptionError("");
    setPuckState("idle");
    setPuckStatus("SmartPuck will be detected automatically when it is on the same network.");
    autoCheckedPuckAddressRef.current = null;
  }

  function closeNewRecording() {
    if (puckState === "recording") {
      stopComputerRecording();
    }
    if (puckState === "listening") {
      stopLiveListening();
    }
    setActiveView("recent-sessions");
    setActiveTab("dashboard");
  }



  async function startLiveListening(recordImmediately = false) {
    if (puckState === "listening" || puckState === "recording") {
      return;
    }

    let abortController: AbortController | null = null;
    try {
      const baseUrl = normalizedPuckBaseUrl();
      const controller = new AbortController();
      abortController = controller;
      streamAbortRef.current = abortController;
      const connectTimeout = window.setTimeout(() => controller.abort(), 8000);
      streamHeaderBytesToSkipRef.current = 44;
      setPuckState(recordImmediately ? "recording" : "listening");
      setPuckStatus(
        recordImmediately
          ? "Listening live and recording SmartPuck audio to this browser..."
          : "Listening live to the SmartPuck Wi-Fi stream.",
      );
      window.localStorage.setItem("smartpuck:puck-address", baseUrl);
      setPuckAddress(baseUrl);
      await ensureAudioContext();

      if (recordImmediately) {
        beginRecordingBuffer();
      }

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/stream`, {
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
          processStreamChunk(value);
        }
      }

      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
        if (recordingEnabledRef.current) {
          stopComputerRecording();
        }
        setPuckState("connected");
        setPuckStatus("SmartPuck stream ended.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (abortController && streamAbortRef.current === abortController) {
          streamAbortRef.current = null;
          setPuckState("error");
          setPuckStatus("SmartPuck did not answer in time. Check the IP address and Wi-Fi network.");
        }
        return;
      }
      setPuckState("error");
      setPuckStatus(error instanceof Error ? error.message : "SmartPuck stream stopped unexpectedly.");
    }
  }

  function beginRecordingBuffer() {
    if (recordingDownloadUrl) {
      URL.revokeObjectURL(recordingDownloadUrl);
    }

    recordingEnabledRef.current = true;
    streamChunksRef.current = [];
    streamPcmBytesRef.current = 0;
    setRecordingDownloadUrl(null);
    setRecordingFileName(null);
    setRecordingBytes(0);
    setRecordingStartedAt(Date.now());
  }

  function processStreamChunk(chunk: Uint8Array) {
    let start = 0;
    if (streamHeaderBytesToSkipRef.current > 0) {
      const skipped = Math.min(streamHeaderBytesToSkipRef.current, chunk.byteLength);
      streamHeaderBytesToSkipRef.current -= skipped;
      start = skipped;
    }

    if (start >= chunk.byteLength) {
      return;
    }

    const pcmChunk = chunk.slice(start);
    playPcmChunk(pcmChunk);
    if (recordingEnabledRef.current) {
      appendRecordingChunk(pcmChunk);
    }
  }

  function appendRecordingChunk(pcmChunk: Uint8Array) {
    streamChunksRef.current.push(pcmChunk);
    streamPcmBytesRef.current += pcmChunk.byteLength;
    setRecordingBytes(streamPcmBytesRef.current);
  }

  function stopComputerRecording() {
    recordingEnabledRef.current = false;
    setRecordingStartedAt(null);

    const pcmBytes = streamPcmBytesRef.current;
    if (pcmBytes <= 0) {
      setPuckState(streamAbortRef.current ? "listening" : "connected");
      setPuckStatus("Recording stopped before audio arrived.");
      return;
    }

    const wavBlob = buildWavBlob(streamChunksRef.current, pcmBytes);
    const url = URL.createObjectURL(wavBlob);
    const fileName = `smartpuck-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
    setRecordingDownloadUrl(url);
    setRecordingFileName(fileName);
    setRecordingBytes(pcmBytes);
    setPuckState(streamAbortRef.current ? "listening" : "connected");
    setPuckStatus("Recording saved. Linking a Wi-Fi capture shell to the selected folder...");
    void linkSavedRecordingToFolder();
  }

  async function linkSavedRecordingToFolder() {
    const folderId = importFolderId || fallbackFolderId;
    if (!folderId || isLinkingRecording) {
      setPuckStatus("Recording saved. Download the WAV to keep it on this computer.");
      return;
    }

    setIsLinkingRecording(true);
    setOpenFolders((current) => ({ ...current, [folderId]: true }));
    try {
      const meetingId = await Promise.resolve(onConnectDevice(folderId, "wifi"));
      if (typeof meetingId === "string") {
        onSelectMeeting(meetingId);
      }
      setPuckStatus("Recording saved and linked to the selected folder. Download the WAV to keep it.");
    } catch (error) {
      setPuckStatus(
        error instanceof Error
          ? `Recording saved, but folder link failed: ${error.message}`
          : "Recording saved, but folder link failed.",
      );
    } finally {
      setIsLinkingRecording(false);
    }
  }

  function stopLiveListening() {
    if (puckState === "recording") {
      stopComputerRecording();
    }

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
    setPuckState("connected");
    setPuckStatus("Live stream stopped.");
  }

  async function ensureAudioContext() {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("This browser does not support Web Audio playback.");
    }
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor({ sampleRate: 16000 });
      nextPlaybackTimeRef.current = audioContextRef.current.currentTime + 0.05;
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
  }

  function playPcmChunk(pcmChunk: Uint8Array) {
    const audioContext = audioContextRef.current;
    if (!audioContext || pcmChunk.byteLength < 2) {
      return;
    }

    const sampleCount = Math.floor(pcmChunk.byteLength / 2);
    const audioBuffer = audioContext.createBuffer(1, sampleCount, 16000);
    const channel = audioBuffer.getChannelData(0);
    const view = new DataView(pcmChunk.buffer, pcmChunk.byteOffset, sampleCount * 2);

    for (let i = 0; i < sampleCount; i += 1) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    const startAt = Math.max(audioContext.currentTime + 0.02, nextPlaybackTimeRef.current);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + audioBuffer.duration;
    activeAudioSourcesRef.current.push(source);
    source.onended = () => {
      activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter((item) => item !== source);
    };
  }

  async function handleCreateInlineFolder() {
    const trimmed = inlineFolderName.trim();
    if (!trimmed || isMutating) {
      return;
    }

    try {
      const folderId = await Promise.resolve(onCreateFolder(trimmed));
      if (folderId) {
        setImportFolderId(folderId);
      }
      setInlineFolderName("");
      setShowInlineFolderCreator(false);
    } catch (error) {
      console.error("Failed to create inline folder", error);
    }
  }

  async function handleAudioFileSelect(
    file: File,
    sourceSession?: { baseUrl: string; sessionPath: string },
  ) {
    const folderId = importFolderId || fallbackFolderId;
    if (!folderId) {
      alert("Please select or create a folder to save this recording to.");
      return;
    }

    setIsTranscribing(true);
    setTranscriptionError("");
    setTranscriptionProgressMessage("Preparing local transcription...");
    setImportStatus({
      state: "working",
      message: "Preparing local transcription...",
      detail: `${file.name} - ${formatBytes(file.size)}`,
    });

    try {
      const transcription = await transcribeAudioFile(file, setTranscriptionProgressMessage);
      setTranscriptionProgressMessage("Transcription complete. Saving transcript...");
      setImportStatus({
        state: "working",
        message: "Saving transcript to the selected folder...",
        detail: `${file.name} - ${formatBytes(file.size)}`,
      });

      const transcriptText = formatTranscriptionText(transcription);

      setTranscriptionProgressMessage("Saving meeting record...");

      if (onCreateMeetingWithAudio) {
        const durationMin = getTranscriptionDurationMinutes(transcription);
        const durationStr = durationMin > 0 
          ? `${Math.round(durationMin)}m`
          : "0m";

        const meetingId = await onCreateMeetingWithAudio({
          folderId,
          title: file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "),
          transport: pendingTransport,
          audioFileName: file.name,
          transcriptText,
          transcriptJson: JSON.stringify(transcription),
          deviceSessionKey: sourceSession
            ? getDeviceSessionKey(sourceSession.baseUrl, sourceSession.sessionPath)
            : undefined,
          deviceSessionPath: sourceSession?.sessionPath,
          durationLabel: durationStr,
          transferredMb: Math.round(file.size / 1024 / 1024),
          audioHours: Number((durationMin / 60).toFixed(2)),
        });

        setImportStatus({
          state: "done",
          message: "Transcript saved to the selected folder.",
          detail: `${file.name} - ${durationStr} - ${formatBytes(file.size)}`,
          meetingId,
        });
      }

      if (sourceSession) {
        rememberImportedSession(sourceSession.baseUrl, sourceSession.sessionPath);
        try {
          await fetchWithTimeout(
            `${sourceSession.baseUrl}/session_uploaded?path=${encodeURIComponent(sourceSession.sessionPath)}`,
            3000,
            { method: "POST" },
          );
        } catch {
          // The local browser memory still prevents accidental double-imports if the marker write fails.
        }
        await refreshPuckSessions(sourceSession.baseUrl);
      }

      setPuckStatus("Import complete. The transcript is saved in the selected folder.");
    } catch (err) {
      const error = err as Error;
      console.error(error);
      setTranscriptionError(
        error.message ||
          "Failed to process transcription. Make sure the local transcription server is running on port 8000.",
      );
      setPuckStatus("Import paused. Local transcription is unavailable.");
      setImportStatus({
        state: "error",
        message: "Import paused.",
        detail: error.message || "Failed to process transcription.",
      });
    } finally {
      setIsTranscribing(false);
      setImportingSessionPath(null);
    }
  }

  async function transcribeAudioFile(file: File, onProgress: (message: string) => void) {
    if (transcriptionServerState !== "ready") {
      onProgress("Checking the local SmartPuck worker...");
      setImportStatus({
        state: "working",
        message: "Checking the local SmartPuck worker...",
        detail: "The worker must be running on this laptop.",
      });
      try {
        const health = await fetch("http://127.0.0.1:8000/health", { cache: "no-store" });
        if (!health.ok) {
          throw new Error("Health check failed");
        }
        setTranscriptionServerState("ready");
      } catch {
        setTranscriptionServerState("offline");
        throw new Error(
          "Local transcription worker is not running. Start the SmartPuck worker on this laptop, then import again.",
        );
      }
    }

    onProgress("Sending audio to the local SmartPuck worker...");
    setImportStatus({
      state: "working",
      message: "Transcribing locally...",
      detail: `${file.name} - ${formatBytes(file.size)}. This can take a while for long audio.`,
    });
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`http://127.0.0.1:8000/transcribe?model_name=${transcriptionProfile}`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Local transcription server returned ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  function handleAudioFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      void handleAudioFileSelect(file);
    }
  }

  async function importPuckSession(session: SmartPuckSession) {
    const folderId = importFolderId || fallbackFolderId;
    if (!folderId || isTranscribing || importingSessionPath) {
      return;
    }

    const baseUrl = normalizedPuckBaseUrl();
    const importKey = getSessionImportKey(baseUrl, session.sessionPath);
    if (session.uploaded || importedSessionKeys.has(importKey)) {
      setPuckStatus("That SmartPuck session is already imported.");
      return;
    }

    setPendingTransport("wifi");
    setImportingSessionPath(session.sessionPath);
    setTranscriptionProgressMessage("Downloading recording from SmartPuck...");
    setImportStatus({
      state: "working",
      message: "Downloading recording from SmartPuck...",
      detail: `${formatDuration(session.durationSeconds)} - ${formatBytes(session.sizeBytes)}`,
    });

    try {
      const blob = await downloadPuckSessionBlob({
        baseUrl,
        session,
        onProgress: (downloadedBytes, totalBytes) => {
          setTranscriptionProgressMessage("Downloading recording from SmartPuck...");
          setImportStatus({
            state: "working",
            message: "Downloading recording from SmartPuck...",
            detail: `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`,
          });
        },
      });
      const fileName = `${session.name || "smartpuck-session"}.wav`;
      const file = new File([blob], fileName, { type: "audio/wav" });
      await handleAudioFileSelect(file, { baseUrl, sessionPath: session.sessionPath });
    } catch (error) {
      setImportingSessionPath(null);
      setIsTranscribing(false);
      alert(error instanceof Error ? error.message : "Failed to import the SmartPuck recording.");
    }
  }

  async function removePuckSession(session: SmartPuckSession) {
    const baseUrl = normalizedPuckBaseUrl();
    const importKey = getSessionImportKey(baseUrl, session.sessionPath);
    const alreadyImported = session.uploaded || importedSessionKeys.has(importKey);
    const message = alreadyImported
      ? `Remove ${session.name} from SmartPuck?`
      : `Delete ${session.name} without importing it first? This is useful for test clips, but it cannot be undone.`;

    if (!window.confirm(message)) {
      return;
    }

    try {
      await deletePuckSession(baseUrl, session.sessionPath, !alreadyImported);
      setPuckStatus(`${session.name} removed from SmartPuck.`);
      await refreshPuckSessions(baseUrl);
    } catch (error) {
      setPuckStatus(error instanceof Error ? error.message : "Could not remove the SmartPuck recording.");
    }
  }

  function triggerAudioImport() {
    audioFileInputRef.current?.click();
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeMeeting) {
      return;
    }
    if (isSendingRef.current) {
      return;
    }

    const trimmed = draftMessage.trim();
    if (!trimmed && draftAttachments.length === 0) {
      return;
    }

    setDraftMessage("");
    const attachments = draftAttachments;
    setDraftAttachments([]);
    const privateAttachmentContext = buildAttachmentContext(attachments);
    const optimisticTurn = buildOptimisticChatTurn({
      meetingId: activeMeeting.id,
      body: trimmed || "Attached context",
      attachments,
    });
    setPendingMessagesByMeeting((current) => ({
      ...current,
      [activeMeeting.id]: [...(current[activeMeeting.id] ?? []), ...optimisticTurn.messages],
    }));
    isSendingRef.current = true;
    setSendingMeetingId(activeMeeting.id);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${activeMeeting.id}`);
      }
      await onSendMessage(activeMeeting.id, trimmed || "Attached context", privateAttachmentContext);
      setPendingMessagesByMeeting((current) => ({
        ...current,
        [activeMeeting.id]: removeOptimisticChatTurn(current[activeMeeting.id] ?? [], optimisticTurn),
      }));
    } catch (error) {
      setPendingMessagesByMeeting((current) => ({
        ...current,
        [activeMeeting.id]: settleOptimisticChatTurnWithError({
          messages: current[activeMeeting.id] ?? [],
          turn: optimisticTurn,
          error,
        }),
      }));
    } finally {
      isSendingRef.current = false;
      setSendingMeetingId(null);
    }
  }

  async function attachFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    await attachSelectedFiles(files);
  }

  async function attachSelectedFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    const nextAttachments = await Promise.all(files.slice(0, 6).map(readDraftAttachment));
    setDraftAttachments((current) => [...current, ...nextAttachments].slice(-8));
  }

  function removeDraftAttachment(id: string) {
    setDraftAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  const headerTabsVisible = activeView === "recent-sessions";

  return (
    <div className="flex min-h-screen flex-col bg-white text-on-background lg:h-screen lg:flex-row lg:overflow-hidden">
      <aside className="scrollbar-subtle z-30 flex w-full flex-col border-b border-gray-100 bg-[#fbfbfd]/80 px-3 pb-3 pt-6 backdrop-blur-md lg:h-screen lg:w-72 lg:flex-shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="mb-5 flex-shrink-0 px-3">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm">
              <Mic className="h-4 w-4 text-black" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold tracking-tight text-black">SmartPuck</h1>
              <p className="font-display text-[9px] font-bold uppercase tracking-[0.35em] text-gray-400">
                Companion AI
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={showNewRecording}
            className="liquid-mercury-soft w-full rounded-full border border-white/20 px-4 py-3 text-sm font-bold text-black shadow-md active:scale-95 hover:brightness-105"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" />
              New Recording
            </span>
          </button>
        </div>

        <div className="mb-1 flex items-center justify-between px-3">
          <span className="font-display text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400">
            My Folders
          </span>
          <button
            type="button"
            onClick={() => setShowFolderComposer((current) => !current)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-black"
            aria-label="Create folder"
            title="New Folder"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <nav className="scrollbar-subtle flex-1 overflow-y-auto px-3 py-2" aria-label="Folder navigation">
          {showFolderComposer ? (
            <div className="mb-3 rounded-[1.25rem] border border-gray-100 bg-white/80 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="flex gap-2">
                <input
                  value={draftFolder}
                  onChange={(event) => setDraftFolder(event.target.value)}
                  placeholder="New folder"
                  className="min-w-0 flex-1 rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700 outline-none focus:border-gray-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    void submitFolder();
                  }}
                  disabled={!draftFolder.trim() || isMutating}
                  className="rounded-full bg-[#8d9098] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          ) : null}

          <div className="space-y-0.5">
            {visibleFolders.map((folder) => (
              <div key={folder.id} className="folder-group">
                <div className="mb-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder.id)}
                    aria-expanded={isFolderOpen(folder.id)}
                    className="group flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-gray-700 hover:bg-white/60 hover:text-black"
                  >
                    <Folder className="h-4 w-4 flex-shrink-0 text-gray-400 transition-colors group-hover:text-black" />
                    <span className="min-w-0 flex-1 truncate text-left font-display text-[11px] font-bold uppercase tracking-[0.1em]">
                      {folder.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void createChat(folder.id);
                    }}
                    disabled={creatingChatFolderId === folder.id || isMutating}
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-white hover:text-black disabled:cursor-wait disabled:opacity-40"
                    aria-label={`Start new chat in ${folder.name}`}
                    title={`Start new chat in ${folder.name}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void deleteFolder(folder.id);
                    }}
                    disabled={deletingFolderId === folder.id || isMutating}
                    className={clsx(
                      "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-gray-300 opacity-70 transition hover:bg-red-50 hover:text-red-500",
                      deletingFolderId === folder.id ? "cursor-wait opacity-100" : "",
                    )}
                    aria-label={`Delete folder ${folder.name}`}
                    title={`Delete folder ${folder.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div
                  className="overflow-hidden pl-4 transition-all duration-200"
                  style={{
                    maxHeight: isFolderOpen(folder.id)
                      ? `${Math.max(folder.meetings.length, 1) * 52 + 56}px`
                      : "0px",
                  }}
                >
                  {creatingChatFolderId === folder.id ? (
                    <div className="mb-1 flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-[11px] font-medium text-gray-400 shadow-sm">
                      <Sparkles className="h-4 w-4" />
                      Saving new chat...
                    </div>
                  ) : null}

                  {folder.meetings.length === 0 ? (
                    <p className="px-3 py-2 text-[10px] italic text-gray-400">No recordings yet.</p>
                  ) : null}

                  <div className="space-y-0.5">
                    {folder.meetings.map((meeting) => {
                      const isActive =
                        dashboard.activeMeetingId === meeting.id && activeView === "recent-sessions";
                      const statusPill = deriveMeetingStatusPill(
                        meeting,
                        pendingMessagesByMeeting[meeting.id] ?? [],
                      );

                      return (
                        <div
                          key={meeting.id}
                          className={clsx(
                            "meeting-link group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-all duration-200",
                            isActive
                              ? "bg-white text-black shadow-sm"
                              : "text-gray-500 hover:bg-white/70 hover:text-black",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => openMeeting(meeting.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <Mic
                              className={clsx(
                                "h-4 w-4 flex-shrink-0",
                                isActive ? "text-black" : "text-gray-300 group-hover:text-gray-500",
                              )}
                            />
                            <span className="flex-1 truncate text-[11px] font-medium">{meeting.title}</span>
                            {statusPill ? (
                              <MeetingStatusBadge pill={statusPill} />
                            ) : (
                              <span className="font-display text-[9px] text-gray-300">{meeting.durationLabel}</span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void deleteMeeting(meeting.id);
                            }}
                            aria-label={`Delete ${meeting.title}`}
                            title={`Delete ${meeting.title}`}
                            className={clsx(
                              "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-gray-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100",
                              deletingMeetingId === meeting.id ? "cursor-wait opacity-100" : "",
                            )}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="flex-shrink-0 space-y-0.5 border-t border-gray-100 px-3 pt-2">
          <SidebarNavItem
            icon={<Archive className="h-4 w-4" />}
            label="Archives"
            active={activeView === "archives"}
            onClick={() => setActiveView("archives")}
          />
          <SidebarNavItem
            icon={<GraduationCap className="h-4 w-4" />}
            label="Lecture Series"
            active={activeView === "lecture-series"}
            onClick={() => setActiveView("lecture-series")}
          />
          <SidebarNavItem
            icon={<HelpCircle className="h-4 w-4" />}
            label="Help"
            active={activeView === "help"}
            onClick={() => setActiveView("help")}
          />
          <SidebarNavItem
            icon={<Settings className="h-4 w-4" />}
            label="Settings"
            active={activeView === "settings"}
            onClick={() => setActiveView("settings")}
          />
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col bg-white lg:h-screen lg:overflow-hidden">
        <header className="z-20 flex h-20 flex-shrink-0 items-center justify-between border-b border-gray-100 bg-white/70 px-6 backdrop-blur-2xl lg:px-10">
          <div className="flex items-center gap-10">
            {headerTabsVisible ? (
              <nav id="header-tabs" className="hidden items-center gap-8 md:flex">
                <HeaderTab
                  active={activeTab === "dashboard"}
                  label="Chat"
                  onClick={() => setActiveTab("dashboard")}
                />
                <HeaderTab
                  active={activeTab === "transcripts"}
                  label="Transcription"
                  onClick={() => setActiveTab("transcripts")}
                />
                <HeaderTab
                  active={activeTab === "device"}
                  label="Device Battery"
                  onClick={() => setActiveTab("device")}
                />
              </nav>
            ) : (
              <div>
                <p className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
                  {eyebrowForView(activeView)}
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-black">
                  {titleForView(activeView)}
                </h2>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 lg:gap-5">
            <button
              type="button"
              className="chrome-shimmer-border rounded-full bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-black hover:bg-gray-50 lg:px-6"
            >
              Export
            </button>
            <div className="flex gap-1">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:bg-gray-50 hover:text-black"
                aria-label="Share"
              >
                <Share2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:bg-gray-50 hover:text-black"
                aria-label="More"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {animatedView.value === "recent-sessions" ? (
            <div
              id="view-recent-sessions"
              className={clsx(
                "flex h-full min-h-0 w-full flex-col",
                animatedView.isExiting ? "workspace-panel-exit" : "workspace-panel",
              )}
            >
              <AnimatedTabPanel
                activeTab={animatedTab.value}
                isExiting={animatedTab.isExiting}
                activeMeeting={activeMeeting}
                puckStatus={latestPuckStatus}
                draftMessage={draftMessage}
                draftAttachments={draftAttachments}
                pendingMessages={activePendingMessages}
                onDraftMessageChange={setDraftMessage}
                onAttachClick={() => fileInputRef.current?.click()}
                onAttachmentInputChange={attachFiles}
                onAttachFiles={attachSelectedFiles}
                onRemoveDraftAttachment={removeDraftAttachment}
                onSubmitMessage={submitMessage}
                isMutating={isMutating}
                isSending={sendingMeetingId === activeMeetingId}
                fileInputRef={fileInputRef}
                mode={mode}
              />
            </div>
          ) : null}

          {animatedView.value === "new-recording" ? (
            <div
              id="view-new-recording"
              className={clsx(
                "flex h-[calc(100vh-5rem)] w-full flex-col overflow-y-auto bg-[#f8f9fa] px-5 py-6 lg:h-full lg:px-8 lg:py-7",
                animatedView.isExiting ? "workspace-panel-exit" : "workspace-panel",
              )}
            >
              <input
                ref={audioFileInputRef}
                type="file"
                className="sr-only"
                onChange={handleAudioFileChange}
                accept=".mp3,.wav,.m4a"
              />
              <div id="nr-connect" className="mx-auto flex w-full max-w-6xl flex-col gap-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="space-y-1">
                      <p className="font-display text-[10px] font-bold uppercase tracking-[0.25em] text-gray-400">
                        SmartPuck auto-detect + local transcription
                      </p>
                      <h2 className="font-display text-3xl font-bold tracking-tight text-black">
                        New Recording
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={closeNewRecording}
                      className="self-start rounded-full border border-gray-200 bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-gray-500 hover:border-gray-400 hover:text-black sm:self-auto"
                    >
                      Cancel
                    </button>
                  </div>

                  {transcriptionError ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium leading-6 text-amber-900">
                      {transcriptionError}
                    </div>
                  ) : null}

                  <div className="grid w-full gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.85fr)]">
                    <section className="rounded-[1.5rem] border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="space-y-4">
                        {showPuckAddressEditor ? (
                          <div className="flex flex-col gap-3 sm:flex-row">
                            <label className="min-w-0 flex-1">
                              <span className="sr-only">SmartPuck address</span>
                              <input
                                type="text"
                                value={puckAddress}
                                onChange={(event) => setPuckAddress(event.target.value)}
                                disabled={puckState === "recording"}
                                placeholder="http://192.168.4.1"
                                className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 font-mono text-sm text-gray-950 outline-none focus:border-gray-400 disabled:cursor-not-allowed disabled:text-gray-400"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                void checkPuckConnection();
                              }}
                              disabled={puckState === "checking" || puckState === "recording"}
                              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-black px-5 text-xs font-bold uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                            >
                              <Wifi className="h-4 w-4" />
                              Check
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white text-black shadow-sm">
                                <Wifi className="h-4 w-4" />
                              </span>
                              <div className="min-w-0">
                                <p className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                                  SmartPuck stream
                                </p>
                                <p className="truncate text-sm font-medium text-gray-700">
                                  {initialPuckAddress ? "Using saved Convex device address" : "Using default AP fallback"}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setShowPuckAddressEditor(true)}
                                disabled={puckState === "recording"}
                                className="h-10 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-black disabled:cursor-not-allowed disabled:text-gray-300"
                              >
                                Manual
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void autoFindPuck();
                                }}
                                disabled={puckState === "checking" || puckState === "recording"}
                                className="h-10 rounded-xl bg-black px-4 text-xs font-bold uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                              >
                                Find
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-gray-50 p-4">
                          <span
                            className={clsx(
                              "mt-1 h-2.5 w-2.5 rounded-full",
                              puckState === "recording" || latestPuckStatus?.recording
                                ? "bg-red-500"
                                : puckState === "connected" || puckState === "listening"
                                  ? "bg-emerald-500"
                                  : puckState === "error"
                                    ? "bg-amber-500"
                                    : "bg-gray-300",
                            )}
                          />
                          <p className="min-w-0 text-sm leading-6 text-gray-600">{puckStatus}</p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <SyncStatCard
                            label="Device"
                            value={latestPuckStatus?.recording ? "Recording" : puckState === "connected" ? "Ready" : sentenceCase(puckState)}
                          />
                          <SyncStatCard
                            label="Captured"
                            value={formatBytes(latestPuckStatus?.audioSize ?? recordingBytes)}
                          />
                          <SyncStatCard
                            label="Network"
                            value={puckWifiConfig?.activeSsid || latestPuckStatus?.network?.replace("Wi-Fi: ", "") || "Unknown"}
                          />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <button
                            type="button"
                            onClick={() => {
                              void startDeviceRecording();
                            }}
                            disabled={
                              isDeviceRecordingActionPending ||
                              isTranscribing ||
                              latestPuckStatus?.recording === true ||
                              puckState === "checking"
                            }
                            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-xs font-bold uppercase tracking-widest text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            <Mic className="h-4 w-4" />
                            Record
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void stopDeviceRecording();
                            }}
                            disabled={
                              isDeviceRecordingActionPending ||
                              isTranscribing ||
                              latestPuckStatus?.recording !== true
                            }
                            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-black px-4 text-xs font-bold uppercase tracking-widest text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            <Square className="h-4 w-4" />
                            Stop
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void refreshPuckStatus()
                                .then(() => refreshPuckSessions(currentPuckBaseUrl))
                                .catch((error) => {
                                  setPuckStatus(error instanceof Error ? error.message : "Could not refresh SmartPuck.");
                                });
                            }}
                            disabled={isDeviceRecordingActionPending || isTranscribing || puckState === "checking"}
                            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold uppercase tracking-widest text-gray-600 hover:text-black disabled:cursor-not-allowed disabled:text-gray-300"
                          >
                            <Radio className="h-4 w-4" />
                            Check
                          </button>
                        </div>

                        {puckState === "connected" || puckWifiConfig ? (
                          <div className="rounded-2xl border border-gray-100 bg-white p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                                  Wi-Fi setup
                                </p>
                                <p className="mt-1 text-xs leading-5 text-gray-500">
                                  {puckWifiConfig
                                    ? puckWifiConfig.mode === "ap"
                                      ? "SmartPuck is in direct Wi-Fi setup mode."
                                      : `SmartPuck is on ${puckWifiConfig.activeSsid || puckWifiConfig.network}.`
                                    : "Connect to SmartPuck to manage saved Wi-Fi."}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  void refreshPuckWifiConfig(currentPuckBaseUrl);
                                }}
                                disabled={isSavingWifiSetup}
                                className="h-8 rounded-lg border border-gray-200 px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-black disabled:cursor-not-allowed disabled:text-gray-300"
                              >
                                Refresh
                              </button>
                            </div>

                            {puckWifiConfig?.networks.length ? (
                              <div className="mt-3 space-y-1.5">
                                {puckWifiConfig.networks.map((network) => (
                                  <div
                                    key={network.ssid}
                                    className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2"
                                  >
                                    <Wifi className="h-3.5 w-3.5 text-gray-400" />
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-700">
                                      {network.ssid}
                                    </span>
                                    {network.active ? (
                                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-700">
                                        Active
                                      </span>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void deleteWifiSetup(network.ssid);
                                      }}
                                      disabled={isSavingWifiSetup}
                                      className="h-7 rounded-lg px-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:bg-white hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-400">
                                No saved Wi-Fi networks yet.
                              </p>
                            )}

                            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                              <input
                                type="text"
                                value={wifiSetupSsid}
                                onChange={(event) => setWifiSetupSsid(event.target.value)}
                                placeholder="Wi-Fi name"
                                className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-900 outline-none focus:border-gray-400"
                              />
                              <input
                                type="password"
                                value={wifiSetupPassword}
                                onChange={(event) => setWifiSetupPassword(event.target.value)}
                                placeholder="Password"
                                className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-900 outline-none focus:border-gray-400"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  void saveWifiSetup();
                                }}
                                disabled={isSavingWifiSetup || !wifiSetupSsid.trim()}
                                className="h-11 rounded-xl bg-black px-4 text-xs font-bold uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                              >
                                {isSavingWifiSetup ? "Saving" : "Save"}
                              </button>
                            </div>
                            {wifiSetupMessage ? (
                              <p className="mt-2 text-xs leading-5 text-gray-500">{wifiSetupMessage}</p>
                            ) : null}
                          </div>
                        ) : null}

                      </div>
                    </section>

                    <section className="rounded-[1.5rem] border border-gray-200 bg-white p-5 shadow-sm">
                      <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                        Save Session To Folder
                      </label>
                      <div className="flex gap-2">
                        <div className="relative min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setIsImportFolderMenuOpen((open) => !open)}
                            className="flex h-12 w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 text-left text-sm font-semibold text-gray-900 outline-none transition focus:border-gray-400"
                          >
                            <span className="min-w-0 truncate">
                              {visibleFolders.find((folder) => folder.id === importFolderId)?.name ?? "Choose folder"}
                            </span>
                            <ChevronDown
                              className={clsx(
                                "h-4 w-4 flex-shrink-0 text-gray-500 transition-transform",
                                isImportFolderMenuOpen ? "rotate-180" : "",
                              )}
                            />
                          </button>
                          {isImportFolderMenuOpen ? (
                            <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
                              {visibleFolders.map((folder) => (
                                <button
                                  key={folder.id}
                                  type="button"
                                  onClick={() => {
                                    setImportFolderId(folder.id);
                                    setIsImportFolderMenuOpen(false);
                                  }}
                                  className={clsx(
                                    "flex h-10 w-full items-center rounded-lg px-3 text-left text-sm font-semibold",
                                    folder.id === importFolderId
                                      ? "bg-gray-100 text-black"
                                      : "text-gray-600 hover:bg-gray-50 hover:text-black",
                                  )}
                                >
                                  <span className="min-w-0 truncate">{folder.name}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowInlineFolderCreator(!showInlineFolderCreator)}
                          className="h-12 px-4 rounded-xl border border-gray-200 bg-white text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-black hover:bg-gray-50"
                        >
                          New Folder
                        </button>
                      </div>

                      {showInlineFolderCreator ? (
                        <div className="mt-3 flex gap-2 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
                          <input
                            type="text"
                            value={inlineFolderName}
                            onChange={(e) => setInlineFolderName(e.target.value)}
                            placeholder="Folder name (e.g. Finance)"
                            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-gray-400"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void handleCreateInlineFolder();
                            }}
                            disabled={!inlineFolderName.trim() || isMutating}
                            className="rounded-lg bg-black px-4 py-2 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50"
                          >
                            Create
                          </button>
                        </div>
                      ) : null}
                      </div>

                      <div className="mt-4">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          Transcription Mode
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {TRANSCRIPTION_PROFILES.map((profile) => (
                            <button
                              key={profile.id}
                              type="button"
                              onClick={() => setTranscriptionProfile(profile.id)}
                              className={clsx(
                                "rounded-xl border px-3 py-2 text-left transition",
                                transcriptionProfile === profile.id
                                  ? "border-black bg-black text-white"
                                  : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-white",
                              )}
                            >
                              <span className="block text-xs font-bold uppercase tracking-widest">
                                {profile.label}
                              </span>
                              <span
                                className={clsx(
                                  "mt-1 block text-[11px]",
                                  transcriptionProfile === profile.id ? "text-white/65" : "text-gray-400",
                                )}
                              >
                                {profile.hint}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={triggerAudioImport}
                        disabled={isTranscribing}
                        className="mt-4 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-7 text-center transition-colors hover:border-gray-400"
                      >
                        <Upload className="mb-3 h-7 w-7 text-gray-400" />
                        <p className="text-sm font-semibold text-gray-700">Upload audio from this computer</p>
                        <p className="mt-1 text-xs text-gray-400">
                          WAV, MP3, or M4A.{" "}
                          {transcriptionServerState === "ready"
                            ? "The local worker will transcribe it."
                            : "Start the local worker before importing."}
                        </p>
                      </button>

                      <ImportStatusPanel
                        status={importStatus}
                        isWorking={isTranscribing}
                        onOpenMeeting={(meetingId) => {
                          setActiveView("recent-sessions");
                          setActiveTab("dashboard");
                          onSelectMeeting(meetingId);
                        }}
                      />

                      {recordingDownloadUrl && recordingFileName ? (
                        <a
                          href={recordingDownloadUrl}
                          download={recordingFileName}
                          className="mt-4 flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white text-xs font-bold uppercase tracking-widest text-black hover:border-gray-400"
                        >
                          <Download className="h-4 w-4" />
                          Download Browser WAV
                        </a>
                      ) : null}

                      {puckState === "connected" || puckState === "listening" || puckState === "recording" || latestPuckStatus ? (
                        <div className="mt-4 rounded-2xl border border-gray-100 bg-white">
                          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                            <div>
                              <p className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                                Device recordings
                              </p>
                              <p className="text-xs text-gray-500">
                                {isLoadingPuckSessions
                                  ? "Checking SmartPuck..."
                                  : puckSessions.length > 0
                                    ? "Import, remove, or leave recordings on the device."
                                    : "No saved recordings found on the device."}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                void refreshPuckSessions(currentPuckBaseUrl);
                              }}
                              disabled={isLoadingPuckSessions || isTranscribing}
                              className="h-9 rounded-xl border border-gray-200 px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-black disabled:cursor-not-allowed disabled:text-gray-300"
                            >
                              Refresh
                            </button>
                          </div>
                          {puckSessions.length > 0 ? (
                            <div className="max-h-64 overflow-y-auto p-2">
                              {puckSessions.map((session) => {
                                const importKey = getSessionImportKey(currentPuckBaseUrl, session.sessionPath);
                                const alreadyImported = session.uploaded || importedSessionKeys.has(importKey);
                                const isImportingThis = importingSessionPath === session.sessionPath;
                                const canImport = !alreadyImported && !isTranscribing && !importingSessionPath && session.sizeBytes > 44;

                                return (
                                  <div
                                    key={session.sessionPath}
                                    className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-50"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-semibold text-gray-900">
                                        {(session.displayName || session.name).replace(/_/g, " ")}
                                      </p>
                                      <p className="truncate text-xs text-gray-400">
                                        {formatDuration(session.durationSeconds)} - {formatBytes(session.sizeBytes)} -{" "}
                                        {session.network || puckWifiConfig?.activeSsid || latestPuckStatus?.network || session.storageMode}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void importPuckSession(session);
                                      }}
                                      disabled={!canImport}
                                      className={clsx(
                                        "h-9 rounded-xl px-3 text-[10px] font-bold uppercase tracking-widest",
                                        alreadyImported
                                          ? "bg-emerald-50 text-emerald-700"
                                          : "bg-black text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300",
                                      )}
                                    >
                                      {isImportingThis ? "Importing" : alreadyImported ? "Imported" : "Import"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void removePuckSession(session);
                                      }}
                                      disabled={isTranscribing || importingSessionPath === session.sessionPath}
                                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300"
                                      aria-label={`Remove ${session.name}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  </div>
              </div>
            </div>
          ) : null}

          {animatedView.value === "archives" ? (
            <div className={animatedView.isExiting ? "workspace-panel-exit" : "workspace-panel"}>
              <ArchivesView />
            </div>
          ) : null}
          {animatedView.value === "lecture-series" ? (
            <div className={animatedView.isExiting ? "workspace-panel-exit" : "workspace-panel"}>
              <LectureSeriesView />
            </div>
          ) : null}
          {animatedView.value === "help" ? (
            <div className={animatedView.isExiting ? "workspace-panel-exit" : "workspace-panel"}>
              <HelpView />
            </div>
          ) : null}
          {animatedView.value === "settings" ? (
            <div className={animatedView.isExiting ? "workspace-panel-exit" : "workspace-panel"}>
              <SettingsView />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function AnimatedTabPanel({
  activeTab,
  isExiting,
  activeMeeting,
  puckStatus,
  draftMessage,
  draftAttachments,
  pendingMessages,
  onDraftMessageChange,
  onAttachClick,
  onAttachmentInputChange,
  onAttachFiles,
  onRemoveDraftAttachment,
  onSubmitMessage,
  isMutating,
  isSending,
  fileInputRef,
  mode,
}: {
  activeTab: WorkspaceTab;
  isExiting: boolean;
  activeMeeting: MeetingRecord | null;
  puckStatus: SmartPuckStatus | null;
  draftMessage: string;
  draftAttachments: ChatAttachment[];
  pendingMessages: MeetingMessage[];
  onDraftMessageChange: (value: string) => void;
  onAttachClick: () => void;
  onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAttachFiles: (files: File[]) => void | Promise<void>;
  onRemoveDraftAttachment: (id: string) => void;
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void;
  isMutating: boolean;
  isSending: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  mode: WorkspaceShellMode;
}) {
  return (
    <div
      key={activeTab}
      className={clsx("h-full min-h-0", isExiting ? "workspace-panel-exit" : "workspace-panel")}
    >
      {activeTab === "dashboard" ? (
        <DashboardTab
          activeMeeting={activeMeeting}
          draftMessage={draftMessage}
          draftAttachments={draftAttachments}
          pendingMessages={pendingMessages}
          onDraftMessageChange={onDraftMessageChange}
          onAttachClick={onAttachClick}
          onAttachmentInputChange={onAttachmentInputChange}
          onAttachFiles={onAttachFiles}
          onRemoveDraftAttachment={onRemoveDraftAttachment}
          onSubmitMessage={onSubmitMessage}
          isMutating={isMutating}
          isSending={isSending}
          fileInputRef={fileInputRef}
        />
      ) : null}
      {activeTab === "transcripts" ? <TranscriptTab activeMeeting={activeMeeting} /> : null}
      {activeTab === "device" ? (
        <DeviceStatusTab activeMeeting={activeMeeting} mode={mode} puckStatus={puckStatus} />
      ) : null}
    </div>
  );
}

function DashboardTab({
  activeMeeting,
  draftMessage,
  draftAttachments,
  pendingMessages,
  onDraftMessageChange,
  onAttachClick,
  onAttachmentInputChange,
  onAttachFiles,
  onRemoveDraftAttachment,
  onSubmitMessage,
  isMutating,
  isSending,
  fileInputRef,
}: {
  activeMeeting: MeetingRecord | null;
  draftMessage: string;
  draftAttachments: ChatAttachment[];
  pendingMessages: MeetingMessage[];
  onDraftMessageChange: (value: string) => void;
  onAttachClick: () => void;
  onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAttachFiles: (files: File[]) => void | Promise<void>;
  onRemoveDraftAttachment: (id: string) => void;
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void;
  isMutating: boolean;
  isSending: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
}) {
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const animatedMeeting = useAnimatedValue(activeMeeting, MOTION_EXIT_MS, activeMeeting?.id ?? "empty");
  const renderedMeeting = animatedMeeting.value;
  const messages = useMemo(
    () =>
      mergeServerAndOptimisticMessages(renderedMeeting?.messages ?? [], pendingMessages).filter(
        (message) => !isRemovedStarterMessage(message),
      ),
    [renderedMeeting?.messages, pendingMessages],
  );
  const messageCount = messages.length;
  const composerSendState = deriveComposerSendState({
    draftMessage,
    attachmentCount: draftAttachments.length,
    hasActiveMeeting: Boolean(activeMeeting),
    isSending,
  });

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [renderedMeeting?.id, messageCount]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draftMessage]);

  useEffect(() => {
    function focusComposer(event: globalThis.KeyboardEvent) {
      if (!activeMeeting || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key.length !== 1) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      textareaRef.current?.focus();
    }

    window.addEventListener("keydown", focusComposer);
    return () => window.removeEventListener("keydown", focusComposer);
  }, [activeMeeting]);

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      void onAttachFiles(files);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
      setIsDraggingFiles(true);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    setIsDraggingFiles(false);
    void onAttachFiles(files);
  }

  return (
    <div
      id="tab-dashboard"
      className="flex h-full min-h-0 w-full flex-1"
      onDragLeave={() => setIsDraggingFiles(false)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-gray-50 bg-white">
        {renderedMeeting?.audioUrl ? (
          <div className="flex-shrink-0 border-b border-gray-100 bg-gray-50 px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-white flex-shrink-0">
                <Mic className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-gray-900">
                  {renderedMeeting.audioFileName || "Session Audio"}
                </p>
                <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                  Local Playback Enabled
                </p>
              </div>
            </div>
            <audio
              src={renderedMeeting.audioUrl}
              controls
              className="h-8 max-w-sm w-full focus:outline-none"
            />
          </div>
        ) : null}
        <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
          <div
            key={renderedMeeting?.id ?? "empty"}
            className={clsx(
              "mx-auto w-full max-w-4xl space-y-12 p-8 lg:p-12",
              animatedMeeting.isExiting ? "workspace-panel-exit" : "workspace-panel",
            )}
          >
            {renderedMeeting ? (
              <>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                <div ref={messageEndRef} />
              </>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center">
                <div className="text-center">
                  <p className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
                    No Active Session
                  </p>
                  <h2 className="mt-4 font-display text-4xl font-bold tracking-tight text-black">
                    Select a meeting to open the workspace
                  </h2>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-gray-100/80 bg-white/85 px-4 py-4 backdrop-blur-2xl lg:px-8 lg:py-6">
          <form onSubmit={onSubmitMessage} className="mx-auto w-full max-w-3xl">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={onAttachmentInputChange}
              accept=".txt,.md,.markdown,.csv,.json,.pdf,image/*"
            />
            <div
              className={clsx(
                "chrome-shimmer-border relative rounded-[1.5rem] bg-white p-2.5 shadow-2xl transition-all focus-within:shadow-xl",
                isDraggingFiles ? "scale-[1.01] ring-2 ring-black/10" : "",
              )}
            >
              {isDraggingFiles ? (
                <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[1.1rem] border border-dashed border-gray-300 bg-white/85 text-xs font-bold uppercase tracking-[0.2em] text-gray-500 backdrop-blur">
                  Drop to attach
                </div>
              ) : null}
              {draftAttachments.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-2 px-2 pt-1">
                  {draftAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex max-w-full items-center gap-2 rounded-full border border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold text-gray-600"
                    >
                      <FileText className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                      <span className="max-w-48 truncate">{attachment.name}</span>
                      <button
                        type="button"
                        onClick={() => onRemoveDraftAttachment(attachment.id)}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-gray-300 hover:bg-white hover:text-black"
                        aria-label={`Remove ${attachment.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex items-end gap-1">
                <button
                  type="button"
                  onClick={onAttachClick}
                  disabled={!activeMeeting || isMutating || isSending}
                  className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-gray-400 hover:bg-gray-50 hover:text-black disabled:opacity-40"
                  aria-label="Attach files"
                  title="Attach files"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                  ref={textareaRef}
                  value={draftMessage}
                  onChange={(event) => onDraftMessageChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  onPaste={handleComposerPaste}
                  rows={1}
                  className="max-h-40 min-h-12 flex-1 resize-none border-none bg-transparent px-2 py-3 font-medium leading-6 text-gray-900 outline-none placeholder:text-gray-400"
                  placeholder={
                    activeMeeting
                      ? `Ask SmartPuck about "${activeMeeting.title}"...`
                      : "Ask SmartPuck about this session..."
                  }
                />
                <button
                  type="submit"
                  disabled={composerSendState.disabled || isMutating}
                  className="liquid-mercury-soft flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-white/40 text-black shadow-lg disabled:opacity-50"
                  aria-label={composerSendState.ariaLabel}
                >
                  {composerSendState.isSending ? (
                    <LoaderCircle className="relative z-10 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUp className="relative z-10 h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-300">
              <span>{draftAttachments.length > 0 ? `${draftAttachments.length} attached` : "Saved chat"}</span>
              <span>{isMutating ? "Streaming response" : composerSendState.footerCopy}</span>
            </div>
          </form>
        </div>
      </section>

      <aside className="hidden w-[420px] flex-col overflow-hidden bg-[#f8f9fa] xl:flex">
        <div className="scrollbar-subtle flex-1 overflow-y-auto p-10 pb-32">
          {renderedMeeting ? (
            <div
              key={renderedMeeting.id}
              className={clsx(
                "flex flex-col gap-8",
                animatedMeeting.isExiting
                  ? "workspace-rail-panel workspace-panel-exit"
                  : "workspace-rail-panel",
              )}
            >
              <div className="space-y-2">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
                  Session Intelligence
                </h3>
                <h2 className="font-display text-4xl font-light mercury-text-soft">Pinned Insights</h2>
              </div>

              {renderedMeeting.pinnedInsights && renderedMeeting.pinnedInsights.length > 0 ? (
                renderedMeeting.pinnedInsights.map((insight) => (
                  <InsightCard
                    key={insight.id}
                    title={insight.title}
                    icon={insight.icon ? ICON_MAP[insight.icon] || <Sparkles className="h-4 w-4 opacity-60" /> : undefined}
                  >
                    <div
                      className="text-sm leading-relaxed text-gray-700"
                      dangerouslySetInnerHTML={{ __html: insight.htmlContent }}
                    />
                  </InsightCard>
                ))
              ) : (
                <>
                  <InsightCard title="Key Decisions" icon={<Sparkles className="h-4 w-4 opacity-60" />}>
                    <ul className="space-y-4">
                      {renderedMeeting.decisions.map((decision) => (
                        <li key={decision} className="flex items-start gap-4 text-sm leading-relaxed text-gray-700">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-300" />
                          <span>{decision}</span>
                        </li>
                      ))}
                    </ul>
                  </InsightCard>

                  <InsightCard title="Action Items" icon={<Grip className="h-4 w-4 opacity-60" />}>
                    <div className="space-y-3">
                      {renderedMeeting.actions.map((action) => (
                        <div key={action.id} className="rounded-2xl border border-gray-100 bg-white/70 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-gray-400">
                            {action.owner}
                          </p>
                          <p className="mt-2 text-sm leading-relaxed text-gray-700">{action.label}</p>
                        </div>
                      ))}
                    </div>
                  </InsightCard>

                  <InsightCard title="Transcript Preview" icon={<Search className="h-4 w-4 opacity-60" />}>
                    <p className="text-sm leading-7 text-gray-700">{renderedMeeting.transcriptPreview}</p>
                  </InsightCard>
                </>
              )}

              <div className="rounded-[2.5rem] border border-gray-100 bg-gray-50 p-8">
                <h4 className="text-lg font-bold text-black">Meeting Context</h4>
                <div className="mt-5 space-y-3">
                  <StatusRow label="Date" value={renderedMeeting.startedAtLabel} />
                  <StatusRow label="Duration" value={renderedMeeting.durationLabel} />
                  <StatusRow label="Source" value={sentenceCase(renderedMeeting.sourceTransport)} />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function TranscriptTab({ activeMeeting }: { activeMeeting: MeetingRecord | null }) {
  return (
    <div className="scrollbar-subtle h-full w-full overflow-y-auto bg-[#fafbfc] p-8 lg:p-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
          <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
            Transcript
          </p>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight text-black">
            {activeMeeting?.title ?? "No session selected"}
          </h2>
          <div className="mt-6 max-w-4xl text-base leading-8 text-gray-600 whitespace-pre-wrap font-sans bg-gray-50/50 p-6 rounded-2xl border border-gray-100/50">
            {activeMeeting?.transcriptText || activeMeeting?.transcriptPreview ||
              "Import an audio file to create a local transcription for this folder."}
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
          <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
            <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
              Session Summary
            </p>
            <p className="mt-5 text-base leading-8 text-gray-700">
              {activeMeeting?.summary ??
                "Import an audio file or open a demo meeting to see the session summary."}
            </p>
          </section>

          <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
            <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
              Status
            </p>
            <div className="mt-5 space-y-3">
              <StatusRow label="Meeting status" value={activeMeeting ? sentenceCase(activeMeeting.status) : "Waiting"} />
              <StatusRow
                label="Source transport"
                value={activeMeeting ? sentenceCase(activeMeeting.sourceTransport) : "Unavailable"}
              />
              <StatusRow label="Started" value={activeMeeting?.startedAtLabel ?? "No meeting selected"} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function DeviceStatusTab({
  activeMeeting,
  mode,
  puckStatus,
}: {
  activeMeeting: MeetingRecord | null;
  mode: WorkspaceShellMode;
  puckStatus: SmartPuckStatus | null;
}) {
  const batteryValue =
    typeof puckStatus?.batteryPercent === "number"
      ? `${Math.round(puckStatus.batteryPercent)}%`
      : "Not wired yet";
  const storageValue = puckStatus?.storage ?? "Waiting for device";
  const syncValue = activeMeeting ? `${activeMeeting.syncStats.transferredMb} MB` : "0 MB";

  return (
    <div className="scrollbar-subtle h-full w-full overflow-y-auto bg-[#fafbfc] p-8 lg:p-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
          <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
            Device Status
          </p>
          <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-display text-4xl font-bold tracking-tight text-black">
                {activeMeeting?.title ?? "No session selected"}
              </h2>
              <p className="mt-3 max-w-3xl text-base leading-8 text-gray-600">
                Simple device health for the SmartPuck path: storage, battery readiness, and the current folder sync.
              </p>
            </div>
            <div className="rounded-full border border-gray-200 bg-white px-5 py-3">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
                Mode
              </p>
              <p className="mt-1 text-sm font-semibold text-black">
                {mode === "live" ? "Convex live" : "Local demo"}
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-3">
          <AnalyticsCard label="Battery" value={batteryValue} />
          <AnalyticsCard label="Storage" value={storageValue} />
          <AnalyticsCard
            label="Local Sync"
            value={syncValue}
          />
        </div>
      </div>
    </div>
  );
}

function ArchivesView() {
  return (
    <div className="scrollbar-subtle h-[calc(100vh-5rem)] overflow-y-auto p-8 pb-32 lg:h-full lg:p-12">
      <div className="mx-auto w-full max-w-5xl space-y-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
              Knowledge Base
            </h3>
            <h2 className="font-display text-4xl font-bold tracking-tight text-black">Archives</h2>
          </div>
          <div className="chrome-shimmer-border flex min-w-0 items-center rounded-full bg-white px-4 py-2 shadow-sm lg:min-w-[300px]">
            <Search className="mr-2 h-4 w-4 text-gray-400" />
            <input
              className="flex-1 border-none bg-transparent text-sm outline-none placeholder:text-gray-400"
              placeholder="Search archives..."
            />
          </div>
        </div>

        <div className="grid gap-4">
          {ARCHIVE_ITEMS.map((item) => (
            <div
              key={item.title}
              className="group flex cursor-pointer items-center justify-between rounded-[2rem] border border-gray-100 bg-white p-6 transition-all hover:border-gray-300 hover:shadow-md"
            >
              <div className="flex items-center gap-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 text-gray-400 transition-colors group-hover:bg-gray-100 group-hover:text-black">
                  {item.icon === "folder" ? <Folder className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                </div>
                <div>
                  <h4 className="text-lg font-bold text-gray-900 transition-colors group-hover:text-black">
                    {item.title}
                  </h4>
                  <p className="mt-1 text-sm text-gray-500">{item.meta}</p>
                </div>
              </div>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full text-gray-300 hover:bg-gray-50 hover:text-black"
                aria-label={`Open ${item.title}`}
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LectureSeriesView() {
  return (
    <div className="scrollbar-subtle h-[calc(100vh-5rem)] overflow-y-auto bg-[#fafafc] p-8 pb-32 lg:h-full lg:p-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="space-y-3">
          <div className="inline-flex items-center rounded-full bg-black px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
            Educational
          </div>
          <h2 className="font-display text-4xl font-bold tracking-tight text-black">Lecture Series</h2>
          <p className="max-w-xl text-sm leading-relaxed text-gray-500">
            Recorded webinars, knowledge-sharing sessions, and educational content automatically synthesized by SmartPuck.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {LECTURE_CARDS.map((card) => (
            <div
              key={card.title}
              className="group flex h-full cursor-pointer flex-col rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-xl"
            >
              <div
                className="relative mb-6 aspect-video overflow-hidden rounded-2xl bg-gray-100"
                style={{ background: card.background }}
              >
                <div className="absolute inset-0 bg-black/5 transition-colors group-hover:bg-transparent" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </div>

              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-md bg-gray-100 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-600">
                  {card.category}
                </span>
                <span className="font-display text-xs font-medium text-gray-400">{card.duration}</span>
              </div>
              <h4 className="mb-2 text-lg font-bold text-black transition-colors group-hover:text-blue-600">
                {card.title}
              </h4>
              <p className="flex-1 text-sm text-gray-500">{card.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HelpView() {
  return (
    <div className="scrollbar-subtle h-[calc(100vh-5rem)] overflow-y-auto p-8 pb-32 lg:h-full lg:p-12">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <div className="mb-12 space-y-4 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <CircleHelp className="h-8 w-8" />
          </div>
          <h2 className="font-display text-4xl font-bold tracking-tight text-black">
            How can we help?
          </h2>
          <div className="relative mx-auto mt-6 max-w-xl">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full rounded-full border border-gray-200 bg-gray-50 py-4 pl-12 pr-6 outline-none focus:border-transparent focus:ring-2 focus:ring-black"
              placeholder="Search knowledge base or ask a question..."
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="mb-6 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
            Frequently Asked Questions
          </h3>

          {HELP_ITEMS.map((item) => (
            <div
              key={item.title}
              className="cursor-pointer rounded-2xl border border-gray-100 bg-white p-6 transition-shadow hover:shadow-md"
            >
              <h4 className="flex items-center justify-between text-lg font-bold text-black">
                {item.title}
                <span className="text-gray-400">{item.open ? "−" : "+"}</span>
              </h4>
              {item.body ? <p className="mt-4 text-sm leading-relaxed text-gray-600">{item.body}</p> : null}
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-[2.5rem] border border-gray-100 bg-gray-50 p-8 text-center">
          <h4 className="mb-2 text-lg font-bold text-black">Still need support?</h4>
          <p className="mb-6 text-sm text-gray-500">
            Our engineering team is available 24/7 to assist with critical workspace issues.
          </p>
          <button
            type="button"
            className="rounded-full bg-black px-6 py-3 text-xs font-bold uppercase tracking-widest text-white hover:bg-gray-800"
          >
            Contact Support
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsView() {
  return (
    <div className="scrollbar-subtle h-[calc(100vh-5rem)] overflow-y-auto p-8 pb-32 lg:h-full lg:p-12">
      <div className="mx-auto w-full max-w-4xl space-y-12">
        <div className="flex flex-col gap-12 md:flex-row">
          <div className="flex w-full flex-col gap-2 md:w-64">
            <button type="button" className="rounded-xl bg-gray-100 px-4 py-3 text-left text-sm font-bold text-black">
              Account Profile
            </button>
            <button type="button" className="rounded-xl px-4 py-3 text-left text-sm font-medium text-gray-500 hover:bg-gray-50">
              Notifications
            </button>
            <button type="button" className="rounded-xl px-4 py-3 text-left text-sm font-medium text-gray-500 hover:bg-gray-50">
              Integrations
            </button>
            <button type="button" className="rounded-xl px-4 py-3 text-left text-sm font-medium text-gray-500 hover:bg-gray-50">
              Billing & Plans
            </button>
            <button type="button" className="rounded-xl px-4 py-3 text-left text-sm font-medium text-gray-500 hover:bg-gray-50">
              Security
            </button>
          </div>

          <div className="flex-1 space-y-10">
            <div className="space-y-4">
              <h4 className="border-b border-gray-100 pb-2 text-lg font-bold text-black">Profile Avatar</h4>
              <div className="flex items-center gap-6">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-gray-200 bg-white p-1 shadow-sm">
                  <div className="liquid-mercury-soft flex h-full w-full items-center justify-center rounded-full text-black">
                    <Mic className="relative z-10 h-6 w-6" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="chrome-shimmer-border rounded-full bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-black hover:bg-gray-50"
                  >
                    Upload New
                  </button>
                  <button
                    type="button"
                    className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-black"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="grid gap-6 md:grid-cols-2">
                <Field label="First Name" value="Jane" />
                <Field label="Last Name" value="Doe" />
              </div>
              <Field label="Email Address" value="jane.doe@smartpuck.ai" type="email" />
            </div>

            <div className="space-y-4">
              <h4 className="border-b border-gray-100 pb-2 text-lg font-bold text-black">
                Workspace Preferences
              </h4>

              <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-4">
                <div>
                  <p className="text-sm font-bold text-black">Theme Appearance</p>
                  <p className="mt-1 text-xs text-gray-500">Select your workspace visual mode.</p>
                </div>
                <select className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium outline-none">
                  <option>Liquid Mercury Light</option>
                  <option>Obsidian Dark</option>
                  <option>System Default</option>
                </select>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-4">
                <div>
                  <p className="text-sm font-bold text-black">Auto-generate Action Items</p>
                  <p className="mt-1 text-xs text-gray-500">
                    SmartPuck automatically lists tasks after sessions end.
                  </p>
                </div>
                <div className="relative h-6 w-12 cursor-pointer rounded-full bg-black">
                  <div className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-4 pt-6">
              <button
                type="button"
                className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-black"
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-black px-6 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-lg hover:bg-gray-800"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: MeetingMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl rounded-[2rem] border border-gray-100/50 bg-gray-50/80 px-8 py-6 text-gray-800 shadow-sm">
          {message.attachments && message.attachments.length > 0 ? (
            <div className="mb-4 flex flex-wrap justify-end gap-2">
              {message.attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-semibold text-gray-500"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span className="max-w-44 truncate">{attachment.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          <p className="text-base leading-relaxed">{message.body}</p>
        </div>
      </div>
    );
  }

  const hasActivity = Boolean(message.activity?.length || message.reasoning?.trim());
  const isStreamingEmpty =
    message.status === "streaming" && !message.body.trim() && !hasActivity;
  const isError = message.status === "error";
  const isEmptyCompleteAssistant =
    message.status !== "streaming" && !isError && !message.body.trim() && !hasActivity;

  return (
    <div className="group flex gap-8">
      <div
        className={clsx(
          "liquid-mercury-soft flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-white/50 shadow-lg",
          isError ? "bg-red-50 text-red-700" : "",
        )}
      >
        {message.status === "streaming" ? (
          <LoaderCircle className="h-5 w-5 animate-spin text-black" />
        ) : isError ? (
          <AlertCircle className="h-5 w-5 text-red-600" />
        ) : (
          <Sparkles className="h-5 w-5 text-black" />
        )}
      </div>
      <div className="flex-1 space-y-5 pt-1">
        {hasActivity ? <AssistantActivity message={message} /> : null}

        {isError ? (
          <div className="max-w-3xl rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm leading-6 text-red-700">
            {message.body}
          </div>
        ) : isStreamingEmpty ? (
          <div className="flex items-center gap-2 pt-2 text-sm font-medium text-gray-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-gray-400" />
            Preparing response...
          </div>
        ) : isEmptyCompleteAssistant ? (
          <div className="max-w-3xl rounded-2xl border border-gray-100 bg-gray-50/70 px-5 py-4 text-sm leading-6 text-gray-600">
            I don&apos;t have a recorded meeting transcript in this chat yet. Start a New Recording or
            import an audio file, then I can answer from it here.
          </div>
        ) : message.body.trim() ? (
          <Streamdown
            className="smartpuck-markdown max-w-3xl text-base leading-8 text-gray-900 lg:text-lg"
            skipHtml
          >
            {message.body}
          </Streamdown>
        ) : null}
        <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
          SmartPuck - {relativeLabel(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

function AssistantActivity({ message }: { message: MeetingMessage }) {
  const activity = message.activity?.length
    ? message.activity
    : message.reasoning?.trim()
      ? [{
          id: `${message.id}-reasoning`,
          title: "Thinking",
          body: message.reasoning,
          status: message.status === "streaming" ? "working" as const : "done" as const,
        }]
      : [];

  if (activity.length === 0) {
    return null;
  }

  const latest = activity[activity.length - 1];
  const isWorking = message.status === "streaming" || activity.some((item) => item.status === "working");
  const preview = latest.body?.split("\n").find(Boolean)?.trim();

  return (
    <details className="max-w-3xl rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-3 text-sm text-gray-600">
      <summary className="flex cursor-pointer list-none items-center gap-3 font-medium text-gray-700">
        {isWorking ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-gray-500" />
        ) : (
          <Sparkles className="h-4 w-4 text-gray-500" />
        )}
        <span className="flex-1 truncate">
          {isWorking ? "Working" : "Activity"} · {latest.title}
          {preview ? `: ${preview}` : ""}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400" />
      </summary>
      <div className="mt-4 space-y-3 border-l border-gray-200 pl-4">
        {activity.map((item) => (
          <div key={item.id}>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  item.status === "error"
                    ? "bg-red-400"
                    : item.status === "working"
                      ? "animate-pulse bg-amber-400"
                      : "bg-emerald-400",
                )}
              />
              <span>{item.title}</span>
              {item.source ? <span className="normal-case tracking-normal text-gray-300">· {item.source}</span> : null}
            </div>
            {item.body ? (
              <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-5 text-gray-500">{item.body}</p>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function ImportStatusPanel({
  status,
  isWorking,
  onOpenMeeting,
}: {
  status: ImportStatus;
  isWorking: boolean;
  onOpenMeeting: (meetingId: string) => void;
}) {
  if (status.state === "idle" && !isWorking) {
    return null;
  }

  const tone =
    status.state === "done"
      ? "border-emerald-100 bg-emerald-50 text-emerald-900"
      : status.state === "error"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-gray-200 bg-gray-50 text-gray-700";

  return (
    <div className={clsx("mt-4 rounded-2xl border px-4 py-3", tone)}>
      <div className="flex items-start gap-3">
        <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center">
          {isWorking ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : status.state === "done" ? (
            <Sparkles className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{status.message}</p>
          {status.detail ? <p className="mt-1 text-xs leading-5 opacity-70">{status.detail}</p> : null}
        </div>
        {status.state === "done" && status.meetingId ? (
          <button
            type="button"
            onClick={() => onOpenMeeting(status.meetingId!)}
            className="flex-shrink-0 rounded-xl bg-black px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-gray-800"
          >
            Open Chat
          </button>
        ) : null}
      </div>
    </div>
  );
}

async function readDraftAttachment(file: File): Promise<ChatAttachment> {
  const id = `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
  let preview: string | undefined;
  const isTextLike =
    file.type.startsWith("text/") ||
    ATTACHMENT_TEXT_TYPES.has(file.type) ||
    /\.(csv|json|md|markdown|txt)$/i.test(file.name);

  if (isTextLike) {
    const text = await file.text();
    preview = text.slice(0, MAX_ATTACHMENT_PREVIEW_CHARS);
  }

  return {
    id,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    preview,
  };
}

function buildAttachmentContext(attachments: ChatAttachment[]) {
  if (attachments.length === 0) {
    return undefined;
  }

  const attachmentContext = attachments
    .map((attachment) => {
      const preview = attachment.preview;
      return [
        `File: ${attachment.name}`,
        `Type: ${attachment.type || "unknown"}`,
        `Size: ${formatBytes(attachment.size)}`,
        preview ? `Preview:\n${preview}` : "Preview unavailable in browser; use the filename and type as context.",
      ].join("\n");
    })
    .join("\n\n");

  return ["Attached context:", attachmentContext].join("\n");
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function buildWavBlob(chunks: Uint8Array[], pcmBytes: number) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcmBytes, true);

  const chunkParts = chunks.map((chunk) => {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    return copy.buffer;
  });

  return new Blob([header, ...chunkParts], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function isRemovedStarterMessage(message: MeetingMessage) {
  return message.role === "assistant" && message.body.trim() === REMOVED_STARTER_MESSAGE;
}

function MeetingStatusBadge({ pill }: { pill: MeetingStatusPill }) {
  return (
    <span
      className={clsx(
        "ml-1 inline-flex flex-shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em]",
        meetingStatusToneClass(pill.tone),
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", pill.pulse ? "animate-pulse" : "")} />
      {pill.label}
    </span>
  );
}

function meetingStatusToneClass(tone: MeetingStatusPill["tone"]) {
  switch (tone) {
    case "red":
      return "[&>span]:bg-red-500 bg-red-50 text-red-600";
    case "amber":
      return "[&>span]:bg-amber-500 bg-amber-50 text-amber-700";
    case "sky":
    default:
      return "[&>span]:bg-sky-500 bg-sky-50 text-sky-700";
  }
}

function useAnimatedValue<T>(value: T, exitMs: number, key: string = String(value)) {
  const [exitingValue, setExitingValue] = useState(value);
  const [renderedKey, setRenderedKey] = useState(key);

  useEffect(() => {
    if (key === renderedKey) {
      return;
    }

    const exitTimer = window.setTimeout(() => {
      setExitingValue(value);
      setRenderedKey(key);
    }, exitMs);

    return () => window.clearTimeout(exitTimer);
  }, [exitMs, key, renderedKey, value]);

  const isExiting = key !== renderedKey;
  return { value: isExiting ? exitingValue : value, isExiting };
}

function SidebarNavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "nav-item flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left text-gray-400 hover:bg-white/50 hover:text-black",
        active ? "active" : "",
      )}
    >
      {icon}
      <span className="font-display text-xs font-bold uppercase tracking-[0.12em]">{label}</span>
    </button>
  );
}

function HeaderTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "tab-item border-b-2 border-transparent pb-1 font-display text-sm font-bold tracking-tight text-gray-400 hover:text-black",
        active ? "active text-black" : "",
      )}
    >
      {label}
    </button>
  );
}

function InsightCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
      <div className="flex items-center gap-3 text-black">
        {icon}
        <span className="font-display text-[11px] font-bold uppercase tracking-widest">{title}</span>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function SyncStatCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
      <p className="font-display text-xl font-bold text-black">
        {value}
        {suffix ? <span className="ml-1 text-sm font-medium text-gray-500">{suffix}</span> : null}
      </p>
      <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
    </div>
  );
}

function AnalyticsCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="glass-morphic-silver chrome-shimmer-border rounded-[2.3rem] p-8">
      <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
        {label}
      </p>
      <p className="mt-4 break-words font-display text-3xl font-light leading-tight text-black">{value}</p>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-4">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-black">{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  type = "text",
}: {
  label: string;
  value: string;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-widest text-gray-500">{label}</label>
      <input
        type={type}
        defaultValue={value}
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium text-gray-900 outline-none focus:border-transparent focus:ring-2 focus:ring-black"
      />
    </div>
  );
}

function titleForView(activeView: WorkspaceView) {
  switch (activeView) {
    case "archives":
      return "Archives";
    case "lecture-series":
      return "Lecture Series";
    case "help":
      return "How can we help?";
    case "settings":
      return "Settings";
    case "new-recording":
      return "Connect SmartPuck";
    default:
      return "Dashboard";
  }
}

function eyebrowForView(activeView: WorkspaceView) {
  switch (activeView) {
    case "archives":
      return "Knowledge Base";
    case "lecture-series":
      return "Educational";
    case "help":
      return "Support Center";
    case "settings":
      return "Account Settings";
    case "new-recording":
      return "Device Ingest";
    default:
      return "Workspace";
  }
}

function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function relativeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) {
    return "Today";
  }

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

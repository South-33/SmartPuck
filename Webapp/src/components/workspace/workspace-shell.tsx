"use client";

import clsx from "clsx";
import {
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
  Archive,
  ArrowRight,
  ArrowUp,
  Bluetooth,
  Cable,
  ChevronDown,
  CircleHelp,
  FileText,
  Folder,
  GraduationCap,
  Grip,
  HelpCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Plus,
  Search,
  Settings,
  Share2,
  Sparkles,
  Trash2,
  Upload,
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

type WorkspaceShellProps = {
  dashboard: DashboardData;
  liveMessages?: MeetingMessage[] | null;
  mode: WorkspaceShellMode;
  isMutating: boolean;
  fallbackFolderId: string | null;
  onCreateFolder: (name: string) => void | Promise<void>;
  onCreateChat: (folderId: string) => Promise<string | void> | string | void;
  onConnectDevice: (
    folderId: string,
    transport: DeviceTransport,
  ) => Promise<string | void> | string | void;
  onSelectMeeting: (meetingId: string) => void;
  onDeleteMeeting: (meetingId: string) => void | Promise<void>;
  onSendMessage: (meetingId: string, body: string, privateContext?: string) => void | Promise<void>;
};

type WorkspaceView =
  | "recent-sessions"
  | "new-recording"
  | "archives"
  | "lecture-series"
  | "help"
  | "settings";

type WorkspaceTab = "dashboard" | "transcripts" | "analytics";
type NewRecordingState = "connect" | "syncing";

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
const PROMPT_SUGGESTIONS = [
  "Explain the hardware prototype",
  "How does USB transfer work?",
  "What is still not built?",
  "Summarize the transcript pipeline",
];

export function WorkspaceShell({
  dashboard,
  liveMessages,
  mode,
  isMutating,
  fallbackFolderId,
  onCreateFolder,
  onCreateChat,
  onConnectDevice,
  onSelectMeeting,
  onDeleteMeeting,
  onSendMessage,
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
  const [pendingMessagesByMeeting, setPendingMessagesByMeeting] = useState<Record<string, MeetingMessage[]>>({});
  const [showFolderComposer, setShowFolderComposer] = useState(false);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    dashboard.folders.forEach((folder, index) => {
      initial[folder.id] = folder.id === dashboard.activeMeeting?.folderId || index === 0;
    });
    return initial;
  });
  const [newRecordingState, setNewRecordingState] = useState<NewRecordingState>("connect");
  const [pendingTransport, setPendingTransport] = useState<DeviceTransport>("bluetooth");
  const [syncProgress, setSyncProgress] = useState({
    percent: 0,
    transferredMb: 0,
    attachments: 0,
    audioHours: 0,
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isSendingRef = useRef(false);

  const activeMeeting = dashboard.activeMeeting
    ? { ...dashboard.activeMeeting, messages: liveMessages ?? dashboard.activeMeeting.messages }
    : null;
  const activeMeetingId = activeMeeting?.id ?? null;
  const activePendingMessages = activeMeetingId ? (pendingMessagesByMeeting[activeMeetingId] ?? []) : [];
  const visibleFolders = useMemo(() => dashboard.folders, [dashboard.folders]);

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

    window.requestAnimationFrame(loadDraft);
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
    if (activeView !== "new-recording" || newRecordingState !== "syncing") {
      return;
    }

    const targets =
      pendingTransport === "usb"
        ? { percent: 68, transferredMb: 83, attachments: 0, audioHours: 1.5 }
        : pendingTransport === "bluetooth"
          ? { percent: 52, transferredMb: 52, attachments: 0, audioHours: 0.8 }
          : { percent: 41, transferredMb: 34, attachments: 0, audioHours: 0.5 };

    let step = 0;
    const totalSteps = 16;

    const interval = window.setInterval(() => {
      step += 1;
      const ratio = Math.min(step / totalSteps, 1);
      setSyncProgress({
        percent: Math.round(targets.percent * ratio),
        transferredMb: Math.round(targets.transferredMb * ratio),
        attachments: Math.round(targets.attachments * ratio),
        audioHours: Number((targets.audioHours * ratio).toFixed(1)),
      });

      if (ratio >= 1) {
        window.clearInterval(interval);
      }
    }, 110);

    return () => window.clearInterval(interval);
  }, [activeView, newRecordingState, pendingTransport]);

  function isFolderOpen(folderId: string) {
    if (activeMeeting?.folderId === folderId) {
      return true;
    }
    return openFolders[folderId] ?? false;
  }

  function toggleFolder(folderId: string) {
    setOpenFolders((current) => ({
      ...current,
      [folderId]: !(current[folderId] ?? false),
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
    setNewRecordingState("connect");
    setPendingTransport("bluetooth");
  }

  function closeNewRecording() {
    setActiveView("recent-sessions");
    setActiveTab("dashboard");
    setNewRecordingState("connect");
  }

  async function handleDeviceConnect(transport: DeviceTransport) {
    if (!fallbackFolderId) {
      return;
    }

    setPendingTransport(transport);
    setSyncProgress({
      percent: 0,
      transferredMb: 0,
      attachments: 0,
      audioHours: 0,
    });
    setNewRecordingState("syncing");

    if (transport === "manual") {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      closeNewRecording();
      return;
    }

    const [meetingId] = await Promise.all([
      Promise.resolve(onConnectDevice(fallbackFolderId, transport)),
      new Promise((resolve) => window.setTimeout(resolve, 900)),
    ]);

    if (typeof meetingId === "string") {
      onSelectMeeting(meetingId);
    }

    closeNewRecording();
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
    const optimisticMessage: MeetingMessage = {
      id: `optimistic-${activeMeeting.id}-${Date.now()}`,
      role: "user",
      body: trimmed || "Attached context",
      status: "complete",
      createdAt: new Date().toISOString(),
      attachments,
    };
    setPendingMessagesByMeeting((current) => ({
      ...current,
      [activeMeeting.id]: [...(current[activeMeeting.id] ?? []), optimisticMessage],
    }));
    isSendingRef.current = true;
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${activeMeeting.id}`);
      }
      await onSendMessage(activeMeeting.id, trimmed || "Attached context", privateAttachmentContext);
    } finally {
      setPendingMessagesByMeeting((current) => ({
        ...current,
        [activeMeeting.id]: (current[activeMeeting.id] ?? []).filter(
          (message) => message.id !== optimisticMessage.id,
        ),
      }));
      isSendingRef.current = false;
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
                    onClick={() => toggleFolder(folder.id)}
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-white hover:text-black"
                    aria-label={`Toggle ${folder.name}`}
                  >
                    <ChevronDown
                      className={clsx(
                        "h-4 w-4 text-gray-300 transition-transform duration-200",
                        isFolderOpen(folder.id) ? "rotate-0" : "-rotate-90",
                      )}
                    />
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
                            <span className="font-display text-[9px] text-gray-300">{meeting.durationLabel}</span>
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
                  label="Dashboard"
                  onClick={() => setActiveTab("dashboard")}
                />
                <HeaderTab
                  active={activeTab === "transcripts"}
                  label="Transcripts"
                  onClick={() => setActiveTab("transcripts")}
                />
                <HeaderTab
                  active={activeTab === "analytics"}
                  label="Analytics"
                  onClick={() => setActiveTab("analytics")}
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
              Export Chrome
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
                fileInputRef={fileInputRef}
                mode={mode}
              />
            </div>
          ) : null}

          {animatedView.value === "new-recording" ? (
            <div
              id="view-new-recording"
              className={clsx(
                "flex h-[calc(100vh-5rem)] w-full flex-col items-center justify-center overflow-hidden bg-[#f8f9fa] px-6 lg:h-full lg:px-12",
                animatedView.isExiting ? "workspace-panel-exit" : "workspace-panel",
              )}
            >
              {newRecordingState === "connect" ? (
                <div id="nr-connect" className="flex h-full w-full flex-col items-center justify-center gap-10">
                  <RecordingOrb pulsing={false} />
                  <div className="space-y-2 text-center">
                    <h2 className="font-display text-4xl font-bold tracking-tight text-black">
                      Connect SmartPuck
                    </h2>
                    <p className="font-display text-[11px] font-bold uppercase tracking-[0.25em] text-gray-400">
                      Place puck on charging base to begin
                    </p>
                  </div>

                  <div className="flex w-full max-w-md flex-col items-center gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        void handleDeviceConnect("usb");
                      }}
                      className="flex w-full items-center justify-center gap-3 rounded-full bg-black py-4 text-sm font-bold uppercase tracking-widest text-white shadow-xl hover:bg-gray-800"
                    >
                      <Cable className="h-5 w-5" />
                      Connect over USB
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void handleDeviceConnect("bluetooth");
                      }}
                      className="flex w-full items-center justify-center gap-3 rounded-full bg-black py-4 text-sm font-bold uppercase tracking-widest text-white shadow-xl hover:bg-gray-800"
                    >
                      <Bluetooth className="h-5 w-5" />
                      Connect over Bluetooth
                    </button>

                    <div className="flex w-full items-center gap-4">
                      <div className="h-px flex-1 bg-gray-200" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">or</span>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        void handleDeviceConnect("manual");
                      }}
                      className="flex w-full items-center justify-center gap-3 rounded-full border-2 border-dashed border-gray-300 py-4 text-sm font-bold uppercase tracking-widest text-gray-500 hover:border-gray-500 hover:text-black"
                    >
                      <Upload className="h-5 w-5" />
                      Upload Recording File
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={closeNewRecording}
                    className="text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-black"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div id="nr-syncing" className="flex h-full w-full flex-col items-center justify-center gap-10">
                  <RecordingOrb pulsing />

                  <div className="space-y-2 text-center">
                    <h2 className="font-display text-4xl font-bold tracking-tight text-black">
                      Syncing Session
                    </h2>
                    <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
                      April 18, 2026 - Protocol: Ultra-Low Latency
                    </p>
                  </div>

                  <div className="w-full max-w-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                        Active Uplink
                      </span>
                      <span className="font-display text-2xl font-light text-black">
                        {syncProgress.percent}
                        <sup className="text-sm">%</sup>
                      </span>
                    </div>
                    <div className="h-px w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-black transition-all duration-700"
                        style={{ width: `${syncProgress.percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid w-full max-w-lg grid-cols-1 gap-5 md:grid-cols-3">
                    <SyncStatCard
                      label="Transferred"
                      value={`${syncProgress.transferredMb}`}
                      suffix="MB"
                    />
                    <SyncStatCard label="Attachments" value={`${syncProgress.attachments}`} />
                    <SyncStatCard
                      label="Audio Stream"
                      value={syncProgress.audioHours.toFixed(1)}
                      suffix="HR"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={closeNewRecording}
                    className="rounded-full border border-gray-200 px-8 py-3 text-xs font-bold uppercase tracking-widest text-gray-500 hover:border-gray-400 hover:text-black"
                  >
                    Stop & Discard
                  </button>
                </div>
              )}
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
  fileInputRef,
  mode,
}: {
  activeTab: WorkspaceTab;
  isExiting: boolean;
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
          fileInputRef={fileInputRef}
        />
      ) : null}
      {activeTab === "transcripts" ? <TranscriptTab activeMeeting={activeMeeting} /> : null}
      {activeTab === "analytics" ? <AnalyticsTab activeMeeting={activeMeeting} mode={mode} /> : null}
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
                  disabled={!activeMeeting || isMutating}
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
                  disabled={(!draftMessage.trim() && draftAttachments.length === 0) || !activeMeeting || isMutating}
                  className="liquid-mercury-soft flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-white/40 text-black shadow-lg disabled:opacity-50"
                  aria-label="Send"
                >
                  <ArrowUp className="relative z-10 h-4 w-4" />
                </button>
              </div>
            </div>
            {activeMeeting && messages.length === 0 ? (
              <div className="mt-3 flex flex-wrap gap-2 px-1">
                {PROMPT_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      onDraftMessageChange(suggestion);
                      requestAnimationFrame(() => textareaRef.current?.focus());
                    }}
                    className="rounded-full border border-gray-100 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-500 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-200 hover:text-black"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-300">
              <span>{draftAttachments.length > 0 ? `${draftAttachments.length} attached` : "Saved chat"}</span>
              <span>{isMutating ? "Streaming response" : "Enter to send - Shift+Enter for line break"}</span>
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

              <div className="rounded-[2.5rem] border border-gray-100 bg-gray-50 p-8 text-center">
                <h4 className="text-lg font-bold text-black">Still need support?</h4>
                <p className="mb-6 mt-2 text-sm text-gray-500">
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
            Transcript Surface
          </p>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight text-black">
            {activeMeeting?.title ?? "No session selected"}
          </h2>
          <p className="mt-6 max-w-4xl text-base leading-8 text-gray-600">
            {activeMeeting?.transcriptPreview ??
              "Transcript rendering is still a placeholder, but this panel is where the processed audio text will land."}
          </p>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
          <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
            <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
              Session Summary
            </p>
            <p className="mt-5 text-base leading-8 text-gray-700">
              {activeMeeting?.summary ??
                "Summary generation is intentionally parked until the transcript pipeline is wired in."}
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

function AnalyticsTab({
  activeMeeting,
  mode,
}: {
  activeMeeting: MeetingRecord | null;
  mode: WorkspaceShellMode;
}) {
  return (
    <div className="scrollbar-subtle h-full w-full overflow-y-auto bg-[#fafbfc] p-8 lg:p-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
          <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
            Sync Analytics
          </p>
          <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-display text-4xl font-bold tracking-tight text-black">
                {activeMeeting?.title ?? "No session selected"}
              </h2>
              <p className="mt-3 max-w-3xl text-base leading-8 text-gray-600">
                The first milestone is audio-first. These cards track session transfer, optional context attachments, and recorded audio duration.
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
          <AnalyticsCard
            label="Transfer"
            value={activeMeeting ? `${activeMeeting.syncStats.transferredMb} MB` : "0 MB"}
          />
          <AnalyticsCard
            label="Attachments"
            value={activeMeeting ? `${activeMeeting.syncStats.visuals}` : "0"}
          />
          <AnalyticsCard
            label="Audio"
            value={activeMeeting ? `${activeMeeting.syncStats.audioHours.toFixed(1)} h` : "0.0 h"}
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

  const isStreamingEmpty = message.status === "streaming" && !message.body.trim();

  return (
      <div className="group flex gap-8">
      <div className="liquid-mercury-soft flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-white/50 shadow-lg">
        <Sparkles className="h-5 w-5 text-black" />
      </div>
      <div className="space-y-5 pt-1">
        {isStreamingEmpty ? (
          <div className="flex items-center gap-2 pt-2 text-sm font-medium text-gray-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-gray-400" />
            Preparing response...
          </div>
        ) : (
          <Streamdown
            className="smartpuck-markdown max-w-3xl text-base leading-8 text-gray-900 lg:text-lg"
            skipHtml
          >
            {message.body}
          </Streamdown>
        )}
        <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
          SmartPuck - {relativeLabel(message.createdAt)}
        </p>
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

function isRemovedStarterMessage(message: MeetingMessage) {
  return message.role === "assistant" && message.body.trim() === REMOVED_STARTER_MESSAGE;
}

function mergeServerAndOptimisticMessages(
  serverMessages: MeetingMessage[],
  optimisticMessages: MeetingMessage[],
) {
  const visibleMessages = [...serverMessages];
  const serverUserBodies = new Set(
    serverMessages
      .filter((message) => message.role === "user")
      .map((message) => normalizeMessageBody(message.body)),
  );

  for (const optimisticMessage of optimisticMessages) {
    const isSavedOnServer =
      optimisticMessage.role === "user" &&
      serverUserBodies.has(normalizeMessageBody(optimisticMessage.body));

    if (!isSavedOnServer) {
      visibleMessages.push(optimisticMessage);
    }
  }

  return visibleMessages;
}

function normalizeMessageBody(body: string) {
  return body.trim().replace(/\s+/g, " ");
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

function RecordingOrb({ pulsing }: { pulsing: boolean }) {
  return (
    <div className="relative flex items-center justify-center">
      {pulsing ? (
        <div className="absolute h-64 w-64 animate-ping rounded-full bg-[rgba(0,0,0,0.08)] opacity-20" />
      ) : null}
      <div
        className="h-52 w-52 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 38% 35%, #ffffff 0%, #e8e8e8 40%, #c8c8c8 70%, #a0a0a0 100%)",
          boxShadow:
            "inset -8px -8px 24px rgba(0,0,0,0.18), inset 4px 4px 16px rgba(255,255,255,0.9), 0 24px 64px rgba(0,0,0,0.12)",
        }}
      />
    </div>
  );
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
      <p className="mt-4 font-display text-4xl font-light text-black">{value}</p>
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

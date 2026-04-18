"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
  Upload,
} from "lucide-react";
import type {
  DashboardData,
  DeviceTransport,
  MeetingMessage,
  MeetingRecord,
  WorkspaceShellMode,
} from "@/lib/workspace-types";

type WorkspaceShellProps = {
  dashboard: DashboardData;
  mode: WorkspaceShellMode;
  isMutating: boolean;
  fallbackFolderId: string | null;
  onCreateFolder: (name: string) => void | Promise<void>;
  onConnectDevice: (
    folderId: string,
    transport: DeviceTransport,
  ) => Promise<string | void> | string | void;
  onSelectMeeting: (meetingId: string) => void;
  onSendMessage: (meetingId: string, body: string) => void | Promise<void>;
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

export function WorkspaceShell({
  dashboard,
  mode,
  isMutating,
  fallbackFolderId,
  onCreateFolder,
  onConnectDevice,
  onSelectMeeting,
  onSendMessage,
}: WorkspaceShellProps) {
  const [activeView, setActiveView] = useState<WorkspaceView>("recent-sessions");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("dashboard");
  const [draftMessage, setDraftMessage] = useState("");
  const [draftFolder, setDraftFolder] = useState("");
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
    visuals: 0,
    audioHours: 0,
  });

  const activeMeeting = dashboard.activeMeeting;
  const visibleFolders = useMemo(() => dashboard.folders, [dashboard.folders]);

  useEffect(() => {
    if (activeView !== "new-recording" || newRecordingState !== "syncing") {
      return;
    }

    const targets =
      pendingTransport === "usb"
        ? { percent: 68, transferredMb: 83, visuals: 12, audioHours: 1.5 }
        : pendingTransport === "bluetooth"
          ? { percent: 52, transferredMb: 52, visuals: 6, audioHours: 0.8 }
          : { percent: 41, transferredMb: 34, visuals: 4, audioHours: 0.5 };

    let step = 0;
    const totalSteps = 16;

    const interval = window.setInterval(() => {
      step += 1;
      const ratio = Math.min(step / totalSteps, 1);
      setSyncProgress({
        percent: Math.round(targets.percent * ratio),
        transferredMb: Math.round(targets.transferredMb * ratio),
        visuals: Math.round(targets.visuals * ratio),
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
    setActiveView("recent-sessions");
    setActiveTab("dashboard");
    onSelectMeeting(meetingId);
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
      visuals: 0,
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

    const trimmed = draftMessage.trim();
    if (!trimmed) {
      return;
    }

    await onSendMessage(activeMeeting.id, trimmed);
    setDraftMessage("");
  }

  const headerTabsVisible = activeView === "recent-sessions";

  return (
    <div className="min-h-screen bg-white text-on-background lg:flex">
      <aside className="scrollbar-subtle z-30 flex w-full flex-col border-b border-gray-100 bg-[#fbfbfd]/80 px-3 pb-3 pt-6 backdrop-blur-md lg:fixed lg:left-0 lg:top-0 lg:h-screen lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-r">
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
                <button
                  type="button"
                  onClick={() => toggleFolder(folder.id)}
                  className="group flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-gray-700 hover:bg-white/60 hover:text-black"
                >
                  <Folder className="h-4 w-4 text-gray-400 transition-colors group-hover:text-black" />
                  <span className="flex-1 text-left font-display text-[11px] font-bold uppercase tracking-[0.1em]">
                    {folder.name}
                  </span>
                  <ChevronDown
                    className={clsx(
                      "h-4 w-4 text-gray-300 transition-transform duration-200",
                      isFolderOpen(folder.id) ? "rotate-0" : "-rotate-90",
                    )}
                  />
                </button>

                <div
                  className="overflow-hidden pl-4 transition-all duration-200"
                  style={{
                    maxHeight: isFolderOpen(folder.id)
                      ? `${Math.max(folder.meetings.length, 1) * 52 + 52}px`
                      : "0px",
                  }}
                >
                  {folder.meetings.length === 0 ? (
                    <p className="px-3 py-2 text-[10px] italic text-gray-400">No recordings yet.</p>
                  ) : null}

                  <div className="space-y-0.5">
                    {folder.meetings.map((meeting) => {
                      const isActive =
                        dashboard.activeMeetingId === meeting.id && activeView === "recent-sessions";

                      return (
                        <button
                          key={meeting.id}
                          type="button"
                          onClick={() => openMeeting(meeting.id)}
                          className={clsx(
                            "meeting-link group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-all",
                            isActive
                              ? "bg-white text-black shadow-sm"
                              : "text-gray-500 hover:bg-white/70 hover:text-black",
                          )}
                        >
                          <Mic
                            className={clsx(
                              "h-4 w-4",
                              isActive ? "text-black" : "text-gray-300 group-hover:text-gray-500",
                            )}
                          />
                          <span className="flex-1 truncate text-[11px] font-medium">{meeting.title}</span>
                          <span className="font-display text-[9px] text-gray-300">{meeting.durationLabel}</span>
                        </button>
                      );
                    })}
                  </div>

                  {folder.meetings.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => openMeeting(folder.meetings[0].id)}
                      className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-gray-400 hover:border-gray-400 hover:bg-white/70 hover:text-black"
                    >
                      <Sparkles className="h-4 w-4 text-gray-300" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Ask about folder</span>
                    </button>
                  ) : null}
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

      <main className="min-h-screen flex-1 bg-white lg:ml-72 lg:h-screen lg:overflow-hidden">
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

        <div className="relative flex-1 overflow-hidden">
          {activeView === "recent-sessions" ? (
            <div id="view-recent-sessions" className="flex h-[calc(100vh-5rem)] w-full flex-col lg:h-full">
              {activeTab === "dashboard" ? (
                <DashboardTab
                  activeMeeting={activeMeeting}
                  draftMessage={draftMessage}
                  onDraftMessageChange={setDraftMessage}
                  onSubmitMessage={submitMessage}
                  isMutating={isMutating}
                />
              ) : null}
              {activeTab === "transcripts" ? <TranscriptTab activeMeeting={activeMeeting} /> : null}
              {activeTab === "analytics" ? (
                <AnalyticsTab activeMeeting={activeMeeting} mode={mode} />
              ) : null}
            </div>
          ) : null}

          {activeView === "new-recording" ? (
            <div
              id="view-new-recording"
              className="flex h-[calc(100vh-5rem)] w-full flex-col items-center justify-center overflow-hidden bg-[#f8f9fa] px-6 lg:h-full lg:px-12"
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
                    <SyncStatCard label="Snapshots" value={`${syncProgress.visuals}`} />
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

          {activeView === "archives" ? <ArchivesView /> : null}
          {activeView === "lecture-series" ? <LectureSeriesView /> : null}
          {activeView === "help" ? <HelpView /> : null}
          {activeView === "settings" ? <SettingsView /> : null}
        </div>
      </main>
    </div>
  );
}

function DashboardTab({
  activeMeeting,
  draftMessage,
  onDraftMessageChange,
  onSubmitMessage,
  isMutating,
}: {
  activeMeeting: MeetingRecord | null;
  draftMessage: string;
  onDraftMessageChange: (value: string) => void;
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void;
  isMutating: boolean;
}) {
  return (
    <div id="tab-dashboard" className="flex h-full w-full flex-1">
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden border-r border-gray-50 bg-white">
        <div className="scrollbar-subtle mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-8 pb-40 lg:p-12">
          <div className="space-y-12">
            {activeMeeting ? (
              activeMeeting.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))
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

        <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex justify-center px-4 lg:px-8">
          <form onSubmit={onSubmitMessage} className="pointer-events-auto w-full max-w-3xl">
            <div className="chrome-shimmer-border relative flex items-center rounded-[1.5rem] bg-white p-2.5 shadow-2xl transition-all focus-within:shadow-xl">
              <button
                type="button"
                className="p-3 text-gray-400 hover:text-black"
                aria-label="Attach file"
              >
                <Paperclip className="h-5 w-5" />
              </button>
              <input
                value={draftMessage}
                onChange={(event) => onDraftMessageChange(event.target.value)}
                className="flex-1 border-none bg-transparent px-4 py-3 font-medium text-gray-900 outline-none placeholder:text-gray-400"
                placeholder={
                  activeMeeting
                    ? `Ask SmartPuck about "${activeMeeting.title}"...`
                    : "Ask SmartPuck about this session..."
                }
                type="text"
              />
              <button
                type="submit"
                disabled={!draftMessage.trim() || !activeMeeting || isMutating}
                className="liquid-mercury-soft flex h-12 w-12 items-center justify-center rounded-2xl border border-white/40 text-black shadow-lg disabled:opacity-50"
                aria-label="Send"
              >
                <ArrowUp className="relative z-10 h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      </section>

      <aside className="hidden w-[420px] flex-col overflow-hidden bg-[#f8f9fa] xl:flex">
        <div className="scrollbar-subtle flex-1 overflow-y-auto p-10 pb-32">
          {activeMeeting ? (
            <div className="flex flex-col gap-8">
              <div className="space-y-2">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
                  Session Intelligence
                </h3>
                <h2 className="font-display text-4xl font-light mercury-text-soft">Pinned Insights</h2>
              </div>

              <InsightCard title="Key Decisions" icon={<Sparkles className="h-4 w-4 opacity-60" />}>
                <ul className="space-y-4">
                  {activeMeeting.decisions.map((decision) => (
                    <li key={decision} className="flex items-start gap-4 text-sm leading-relaxed text-gray-700">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-300" />
                      <span>{decision}</span>
                    </li>
                  ))}
                </ul>
              </InsightCard>

              <InsightCard title="Action Items" icon={<Grip className="h-4 w-4 opacity-60" />}>
                <div className="space-y-3">
                  {activeMeeting.actions.map((action) => (
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
                <p className="text-sm leading-7 text-gray-700">{activeMeeting.transcriptPreview}</p>
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
                The first milestone is still metadata-first. These cards mirror the old workspace shell so analytics can drop into the same visual frame later.
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
            label="Visuals"
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
          <p className="text-base leading-relaxed">{message.body}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-8">
      <div className="liquid-mercury-soft flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-white/50 shadow-lg">
        <Sparkles className="h-5 w-5 text-black" />
      </div>
      <div className="space-y-5 pt-1">
        <p className="max-w-3xl text-base leading-8 text-gray-900 lg:text-lg">{message.body}</p>
        <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">
          SmartPuck - {relativeLabel(message.createdAt)}
        </p>
      </div>
    </div>
  );
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

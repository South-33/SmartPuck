"use client";

import clsx from "clsx";
import { useDeferredValue, useMemo, useState } from "react";
import {
  Archive,
  Bluetooth,
  Cable,
  ChevronRight,
  Folder,
  GraduationCap,
  HelpCircle,
  Menu,
  MessageSquareText,
  Mic,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { DashboardData, DeviceTransport, MeetingRecord, WorkspaceShellMode } from "@/lib/workspace-types";

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
  const [search, setSearch] = useState("");
  const [draftFolder, setDraftFolder] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const deferredSearch = useDeferredValue(search);
  const activeMeeting = dashboard.activeMeeting;

  const visibleFolders = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return dashboard.folders;
    }

    return dashboard.folders
      .map((folder) => ({
        ...folder,
        meetings: folder.meetings.filter(
          (meeting) =>
            meeting.title.toLowerCase().includes(query) ||
            folder.name.toLowerCase().includes(query),
        ),
      }))
      .filter((folder) => folder.meetings.length > 0 || folder.name.toLowerCase().includes(query));
  }, [dashboard.folders, deferredSearch]);

  function toggleFolder(folderId: string) {
    setOpenFolders((current) => ({
      ...current,
      [folderId]: !(current[folderId] ?? true),
    }));
  }

  function isFolderOpen(folderId: string) {
    if (deferredSearch.trim()) {
      return true;
    }
    return openFolders[folderId] ?? true;
  }

  const summaryMeetingCount = visibleFolders.reduce((count, folder) => count + folder.meetings.length, 0);

  return (
    <div className="flex min-h-screen bg-[#ffffff] text-on-background">
      <aside className="scrollbar-subtle fixed left-0 top-0 z-30 flex h-screen w-72 flex-col overflow-y-auto border-r border-gray-100 bg-[#fbfbfd]/80 px-3 pb-3 pt-6 backdrop-blur-md">
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
            onClick={() => {
              document.getElementById("device-ingest")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="liquid-mercury-soft w-full rounded-full px-4 py-3 text-sm font-bold text-black shadow-md transition-all hover:brightness-105 active:scale-95"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" />
              New Recording
            </span>
          </button>
        </div>

        <div className="mb-1 flex items-center justify-between px-3">
          <span className="font-display text-[9px] font-bold uppercase tracking-[0.22em] text-gray-400">
            My Folders
          </span>
          <button
            type="button"
            onClick={() => {
              const trimmed = draftFolder.trim();
              if (!trimmed) return;
              void onCreateFolder(trimmed);
              setDraftFolder("");
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-all hover:bg-gray-100 hover:text-black"
            aria-label="Create folder"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-2 px-3 py-2" aria-label="Folder navigation">
          <div className="glass-morphic-silver chrome-shimmer-border rounded-[1.75rem] p-4">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search meetings or folders"
                className="w-full rounded-full border border-gray-200 bg-white/70 py-3 pl-11 pr-4 text-sm text-gray-700 outline-none focus:border-gray-400"
              />
            </label>
            <div className="mt-3 flex gap-2">
              <input
                value={draftFolder}
                onChange={(event) => setDraftFolder(event.target.value)}
                placeholder="New folder"
                className="min-w-0 flex-1 rounded-full border border-gray-200 bg-white/70 px-4 py-3 text-sm text-gray-700 outline-none focus:border-gray-400"
              />
              <button
                type="button"
                onClick={() => {
                  const trimmed = draftFolder.trim();
                  if (!trimmed) return;
                  void onCreateFolder(trimmed);
                  setDraftFolder("");
                }}
                disabled={!draftFolder.trim() || isMutating}
                className="rounded-full bg-[#8d9098] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {visibleFolders.map((folder) => {
              const open = isFolderOpen(folder.id);
              return (
                <section
                  key={folder.id}
                  className="glass-morphic-silver chrome-shimmer-border rounded-[1.75rem] p-3"
                >
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-gray-700 transition-all hover:bg-white/60 hover:text-black"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/70">
                      <Folder className="h-4 w-4 text-gray-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-base font-bold tracking-tight text-black">
                        {folder.name}
                      </p>
                      <p className="font-display text-[10px] font-bold uppercase tracking-[0.35em] text-gray-400">
                        {folder.meetings.length} sessions
                      </p>
                    </div>
                    <ChevronRight
                      className={clsx(
                        "h-4 w-4 text-gray-300 transition-transform",
                        open ? "rotate-90" : "",
                      )}
                    />
                  </button>

                  {open ? (
                    <div className="mt-2 space-y-2 pl-2">
                      {folder.meetings.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-gray-400">No recordings yet.</p>
                      ) : null}
                      {folder.meetings.map((meeting) => {
                        const isActive = dashboard.activeMeetingId === meeting.id;
                        return (
                          <button
                            key={meeting.id}
                            type="button"
                            onClick={() => onSelectMeeting(meeting.id)}
                            className={clsx(
                              "meeting-link flex w-full items-center gap-3 rounded-[1.4rem] px-4 py-3 text-left transition-all",
                              isActive
                                ? "bg-[#06091b] text-white shadow-sm"
                                : "text-gray-600 hover:bg-white/70 hover:text-black",
                            )}
                          >
                            <div
                              className={clsx(
                                "flex h-11 w-11 items-center justify-center rounded-full border",
                                isActive
                                  ? "border-white/10 bg-white/10"
                                  : "border-gray-200 bg-white/70",
                              )}
                            >
                              <Mic className={clsx("h-4 w-4", isActive ? "text-white" : "text-gray-500")} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{meeting.title}</p>
                              <p
                                className={clsx(
                                  "font-display text-[10px] font-bold uppercase tracking-[0.3em]",
                                  isActive ? "text-white/60" : "text-gray-400",
                                )}
                              >
                                {meeting.durationLabel} • {meeting.startedAtLabel}
                              </p>
                            </div>
                            <ChevronRight className={clsx("h-4 w-4", isActive ? "text-white/60" : "text-gray-300")} />
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </nav>

        <div className="flex-shrink-0 space-y-1 border-t border-gray-100 px-3 pt-2">
          <SidebarNavItem icon={<Archive className="h-4 w-4" />} label="Archives" />
          <SidebarNavItem icon={<GraduationCap className="h-4 w-4" />} label="Lecture Series" />
          <SidebarNavItem icon={<HelpCircle className="h-4 w-4" />} label="Help" />
          <SidebarNavItem icon={<Settings className="h-4 w-4" />} label="Settings" />
        </div>
      </aside>

      <main className="ml-72 flex h-screen flex-1 flex-col bg-white">
        <header className="z-20 flex h-20 flex-shrink-0 items-center justify-between border-b border-gray-100 bg-white/70 px-10 backdrop-blur-2xl">
          <div className="flex items-center gap-10">
            <nav className="hidden items-center gap-8 md:flex">
              <HeaderTab active label="Dashboard" />
              <HeaderTab label="Transcripts" />
              <HeaderTab label="Analytics" />
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden text-right lg:block">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.35em] text-gray-400">
                Workspace
              </p>
              <p className="text-sm text-gray-600">{dashboard.viewer.scopeLabel}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white">
              <Menu className="h-4 w-4 text-gray-500" />
            </div>
          </div>
        </header>

        <div className="scrollbar-subtle flex-1 overflow-y-auto px-8 pb-8 pt-6">
          <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] px-8 py-7">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.35em] text-gray-400">
                  Recent sessions
                </p>
                <h2 className="mercury-text-soft mt-2 font-display text-3xl font-bold tracking-tight">
                  SmartPuck Workspace
                </h2>
                <p className="mt-2 max-w-3xl text-lg leading-9 text-gray-500">
                  Users come home from a meeting, plug in the puck or sync over Bluetooth, upload
                  the session, and keep everything organized in folders before the audio
                  intelligence layer ships.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetaPill label="Mode" value={mode === "live" ? "Convex live" : "Local demo"} active />
                <MetaPill label="Auth" value="Clerk" />
                <MetaPill label="Deploy" value="Vercel + Convex" />
              </div>
            </div>
          </section>

          <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1.35fr),420px]">
            <section className="space-y-6">
              <section
                id="device-ingest"
                className="rounded-[2rem] bg-gradient-to-br from-[#0b1024] via-[#141a31] to-[#20263d] p-8 text-white shadow-[0_24px_80px_rgba(15,23,42,0.2)]"
              >
                <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
                  <div className="max-w-2xl">
                    <p className="font-display text-[10px] font-bold uppercase tracking-[0.35em] text-white/45">
                      Device ingest
                    </p>
                    <h2 className="mt-4 font-display text-5xl font-bold leading-tight tracking-tight">
                      Plug in the puck or walk in over Bluetooth.
                    </h2>
                    <p className="mt-6 text-xl leading-9 text-white/72">
                      The first milestone is simple: ingest metadata, place the session in the
                      right folder, and preserve a clean chat surface for later transcript-based
                      answers.
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DeviceAction
                      icon={<Cable className="h-5 w-5" />}
                      label="Connect over USB"
                      detail="Faster transfer for larger recordings"
                      disabled={!fallbackFolderId || isMutating}
                      onClick={() =>
                        fallbackFolderId ? void onConnectDevice(fallbackFolderId, "usb") : undefined
                      }
                    />
                    <DeviceAction
                      icon={<Bluetooth className="h-5 w-5" />}
                      label="Connect over Bluetooth"
                      detail="Quick sync when you just got home"
                      disabled={!fallbackFolderId || isMutating}
                      onClick={() =>
                        fallbackFolderId
                          ? void onConnectDevice(fallbackFolderId, "bluetooth")
                          : undefined
                      }
                    />
                  </div>
                </div>
              </section>

              {activeMeeting ? (
                <>
                  <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-3xl">
                        <p className="font-display text-[10px] font-bold uppercase tracking-[0.35em] text-gray-400">
                          Active session
                        </p>
                        <h3 className="mt-3 font-display text-4xl font-bold tracking-tight text-black">
                          {activeMeeting.title}
                        </h3>
                        <p className="mt-4 text-lg leading-9 text-gray-600">{activeMeeting.summary}</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <StatCard label="Transfer" value={`${activeMeeting.syncStats.transferredMb} MB`} />
                        <StatCard label="Visuals" value={`${activeMeeting.syncStats.visuals}`} />
                        <StatCard label="Audio" value={`${activeMeeting.syncStats.audioHours.toFixed(1)} h`} />
                      </div>
                    </div>
                  </section>

                  <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
                    <div className="flex items-start justify-between gap-6">
                      <div>
                        <p className="font-display text-[10px] font-bold uppercase tracking-[0.35em] text-gray-400">
                          Ask SmartPuck
                        </p>
                        <p className="mt-3 text-base leading-8 text-gray-500">
                          Meeting chat is live now. Transcript-aware answers can slot in later
                          without changing this surface.
                        </p>
                      </div>
                      <div className="rounded-full border border-gray-200 bg-white/80 px-4 py-2 font-display text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
                        {activeMeeting.status}
                      </div>
                    </div>

                    <div className="mt-8 space-y-5">
                      {activeMeeting.messages.map((message) => (
                        <ChatMessage key={message.id} meeting={activeMeeting} message={message} />
                      ))}
                    </div>

                    <div className="mt-8 rounded-[2rem] border border-gray-200 bg-white/70 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <textarea
                          rows={3}
                          value={draftMessage}
                          onChange={(event) => setDraftMessage(event.target.value)}
                          placeholder={`Ask SmartPuck about "${activeMeeting.title}"`}
                          className="min-h-[90px] flex-1 resize-none rounded-[1.5rem] border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none focus:border-gray-400"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const trimmed = draftMessage.trim();
                            if (!trimmed) return;
                            void onSendMessage(activeMeeting.id, trimmed);
                            setDraftMessage("");
                          }}
                          disabled={!draftMessage.trim() || isMutating}
                          className="rounded-[1.25rem] bg-[#090d20] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </section>
                </>
              ) : (
                <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8 text-center">
                  <p className="font-display text-[10px] font-bold uppercase tracking-[0.35em] text-gray-400">
                    Empty workspace
                  </p>
                  <h3 className="mt-4 font-display text-4xl font-bold tracking-tight text-black">
                    Start with your first recording
                  </h3>
                  <p className="mx-auto mt-4 max-w-2xl text-lg leading-9 text-gray-500">
                    Use the device ingest panel to create the first meeting shell, then organize it
                    into folders and keep the thread ready for transcript-based answers later.
                  </p>
                </section>
              )}
            </section>

            <aside className="space-y-6">
              <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
                <p className="font-display text-[10px] font-bold uppercase tracking-[0.35em] text-gray-400">
                  Library summary
                </p>
                <div className="mt-5 grid gap-4">
                  <InfoRow label="Folders" value={`${visibleFolders.length}`} />
                  <InfoRow label="Sessions" value={`${summaryMeetingCount}`} />
                  <InfoRow label="Current mode" value={mode === "live" ? "Live" : "Demo"} />
                </div>
              </section>

              {activeMeeting ? (
                <>
                  <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
                    <div className="flex items-center gap-3 text-black">
                      <Sparkles className="h-5 w-5 opacity-60" />
                      <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em]">
                        Transcript preview
                      </span>
                    </div>
                    <p className="mt-5 text-base leading-8 text-gray-600">
                      {activeMeeting.transcriptPreview}
                    </p>
                  </section>

                  <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
                    <div className="flex items-center gap-3 text-black">
                      <MessageSquareText className="h-5 w-5 opacity-60" />
                      <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em]">
                        Key decisions
                      </span>
                    </div>
                    <ul className="mt-6 space-y-4">
                      {activeMeeting.decisions.map((decision) => (
                        <li key={decision} className="flex gap-4 text-sm leading-7 text-gray-700">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-300" />
                          <span>{decision}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="glass-morphic-silver chrome-shimmer-border rounded-[2.5rem] p-8">
                    <div className="flex items-center gap-3 text-black">
                      <Sparkles className="h-5 w-5 opacity-60" />
                      <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em]">
                        Action items
                      </span>
                    </div>
                    <div className="mt-6 space-y-3">
                      {activeMeeting.actions.map((action) => (
                        <div
                          key={action.id}
                          className="rounded-[1.5rem] border border-gray-200 bg-white/60 p-4"
                        >
                          <p className="text-sm font-semibold text-black">{action.label}</p>
                          <p className="mt-1 font-display text-[9px] font-bold uppercase tracking-[0.3em] text-gray-400">
                            @{action.owner}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

function SidebarNavItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="nav-item flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-gray-400 transition-all hover:bg-white/50 hover:text-black"
    >
      {icon}
      <span className="font-display text-xs font-bold uppercase tracking-[0.12em]">{label}</span>
    </button>
  );
}

function HeaderTab({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={clsx(
        "tab-item border-b-2 border-transparent pb-1 font-display text-sm font-bold tracking-tight transition-colors",
        active ? "active text-black" : "text-gray-400 hover:text-black",
      )}
    >
      {label}
    </button>
  );
}

function MetaPill({ label, value, active = false }: { label: string; value: string; active?: boolean }) {
  return (
    <div
      className={clsx(
        "rounded-[1.4rem] border px-5 py-4",
        active ? "border-[#090d20] bg-[#090d20] text-white" : "border-gray-200 bg-white/75 text-black",
      )}
    >
      <p
        className={clsx(
          "font-display text-[10px] font-bold uppercase tracking-[0.35em]",
          active ? "text-white/55" : "text-gray-400",
        )}
      >
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function DeviceAction({
  icon,
  label,
  detail,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[1.75rem] border border-white/10 bg-white/8 p-5 text-left text-white transition-all hover:bg-white/12 disabled:opacity-50"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">{icon}</div>
        <div>
          <p className="text-xl font-semibold">{label}</p>
          <p className="mt-1 text-sm text-white/60">{detail}</p>
        </div>
      </div>
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border border-gray-200 bg-white/65 px-4 py-3">
      <p className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-black">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-[1.5rem] border border-gray-200 bg-white/60 px-4 py-4">
      <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
        {label}
      </span>
      <span className="text-sm font-semibold text-black">{value}</span>
    </div>
  );
}

function ChatMessage({
  meeting,
  message,
}: {
  meeting: MeetingRecord;
  message: MeetingRecord["messages"][number];
}) {
  const isAssistant = message.role === "assistant";

  return (
    <div className={clsx("flex gap-5", isAssistant ? "justify-start" : "justify-end")}>
      {isAssistant ? (
        <div className="liquid-mercury-soft flex h-12 w-12 flex-none items-center justify-center rounded-full border border-white/60">
          <Sparkles className="h-4 w-4 text-black" />
        </div>
      ) : null}
      <div
        className={clsx(
          "max-w-[85%] rounded-[2rem] px-5 py-4 text-sm leading-8",
          isAssistant
            ? "glass-morphic-silver chrome-shimmer-border text-gray-700"
            : "bg-[#090d20] text-white",
        )}
      >
        <p>{message.body}</p>
        <p
          className={clsx(
            "mt-3 font-display text-[9px] font-bold uppercase tracking-[0.3em]",
            isAssistant ? "text-gray-400" : "text-white/50",
          )}
        >
          {isAssistant ? "SmartPuck" : "You"} • {meeting.startedAtLabel}
        </p>
      </div>
    </div>
  );
}

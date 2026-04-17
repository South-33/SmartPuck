"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { useDeferredValue, useMemo, useState } from "react";
import {
  AudioLines,
  Bluetooth,
  Cable,
  ChevronRight,
  CircleEllipsis,
  Folder,
  Folders,
  MessageSquareText,
  Mic,
  Plus,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import type {
  DashboardData,
  DeviceTransport,
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
  const deferredSearch = useDeferredValue(search);

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

  const activeMeeting = dashboard.activeMeeting;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-4 py-4 sm:px-6 sm:py-6 xl:px-8">
      <div className="glass-panel metal-border flex min-h-[calc(100vh-2rem)] flex-1 flex-col overflow-hidden rounded-[2rem]">
        <header className="border-b border-sp-line px-5 py-4 sm:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-white/85 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                  <AudioLines className="h-5 w-5 text-slate-900" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="font-display text-lg font-semibold tracking-tight text-slate-950">
                    SmartPuck Workspace
                  </p>
                  <p className="font-display text-[10px] uppercase tracking-[0.38em] text-sp-muted">
                    Meeting ingest and follow-up chat
                  </p>
                </div>
              </div>
              <p className="max-w-3xl text-sm leading-7 text-sp-muted">
                Users come home from a meeting, plug in the puck or sync over Bluetooth, upload the
                session, and keep everything organized in folders before the audio intelligence layer
                ships.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <StatusChip
                label="Mode"
                value={mode === "live" ? "Convex live" : "Local demo"}
                tone={mode === "live" ? "solid" : "outline"}
              />
              <StatusChip label="Auth" value="Clerk" tone="outline" />
              <StatusChip label="Deploy" value="Vercel + Convex" tone="outline" />
            </div>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-px bg-sp-line xl:grid-cols-[320px,minmax(0,1fr),360px]">
          <aside className="scrollbar-subtle overflow-y-auto bg-white/42 px-4 py-4 sm:px-5">
            <div className="mb-4 rounded-[1.5rem] border border-sp-line bg-white/78 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="font-display text-sm uppercase tracking-[0.3em] text-sp-muted">Folders</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Keep sessions grouped by client, team, or topic.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = draftFolder.trim();
                    if (!trimmed) return;
                    void onCreateFolder(trimmed);
                    setDraftFolder("");
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-sp-line bg-white text-slate-900 hover:-translate-y-0.5 hover:shadow-md"
                  aria-label="Create folder"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-sp-muted" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search meetings or folders"
                  className="w-full rounded-full border border-sp-line bg-[#f8fafc] py-3 pl-11 pr-4 text-sm outline-none focus:border-slate-400"
                />
              </label>

              <div className="mt-3 flex gap-2">
                <input
                  value={draftFolder}
                  onChange={(event) => setDraftFolder(event.target.value)}
                  placeholder="New folder"
                  className="min-w-0 flex-1 rounded-full border border-sp-line bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = draftFolder.trim();
                    if (!trimmed) return;
                    void onCreateFolder(trimmed);
                    setDraftFolder("");
                  }}
                  className="rounded-full bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                  disabled={!draftFolder.trim() || isMutating}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {visibleFolders.map((folder) => (
                <section key={folder.id} className="rounded-[1.5rem] border border-sp-line bg-white/78 p-3">
                  <div className="flex items-center gap-3 px-2 py-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-900">
                      <Folder className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-semibold text-slate-950">{folder.name}</p>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-sp-muted">
                        {folder.meetings.length} sessions
                      </p>
                    </div>
                  </div>
                  <div className="mt-1 space-y-1">
                    {folder.meetings.length === 0 ? (
                      <p className="px-2 py-3 text-sm text-sp-muted">
                        No sessions yet. Plug in the puck and sync the next meeting here.
                      </p>
                    ) : null}

                    {folder.meetings.map((meeting) => {
                      const isActive = dashboard.activeMeetingId === meeting.id;
                      return (
                        <button
                          key={meeting.id}
                          type="button"
                          onClick={() => onSelectMeeting(meeting.id)}
                          className={clsx(
                            "flex w-full items-center gap-3 rounded-[1.25rem] px-3 py-3 text-left",
                            isActive
                              ? "bg-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
                              : "bg-white/55 text-slate-800 hover:bg-white",
                          )}
                        >
                          <div
                            className={clsx(
                              "flex h-10 w-10 items-center justify-center rounded-2xl border",
                              isActive
                                ? "border-white/15 bg-white/10"
                                : "border-sp-line bg-slate-50",
                            )}
                          >
                            <Mic className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{meeting.title}</p>
                            <div
                              className={clsx(
                                "mt-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em]",
                                isActive ? "text-white/70" : "text-sp-muted",
                              )}
                            >
                              <span>{meeting.durationLabel}</span>
                              <span>•</span>
                              <span>{meeting.startedAtLabel}</span>
                            </div>
                          </div>
                          <ChevronRight
                            className={clsx("h-4 w-4", isActive ? "text-white/70" : "text-sp-muted")}
                          />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </aside>

          <section className="scrollbar-subtle overflow-y-auto bg-[#fdfdfd]/85 px-5 py-5 sm:px-8 sm:py-7">
            <div className="space-y-5">
              <div className="rounded-[1.75rem] border border-sp-line bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="font-display text-[10px] uppercase tracking-[0.4em] text-white/60">
                      Device ingest
                    </p>
                    <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                      Plug in the puck or walk in over Bluetooth.
                    </h1>
                    <p className="mt-4 max-w-xl text-sm leading-7 text-white/74">
                      The first milestone is simple: ingest metadata, place the session in the right
                      folder, and preserve a clean chat surface for later transcript-based answers.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <DeviceButton
                      icon={<Cable className="h-4 w-4" />}
                      label="Connect over USB"
                      detail="Faster transfer for larger recordings"
                      onClick={() =>
                        fallbackFolderId ? void onConnectDevice(fallbackFolderId, "usb") : undefined
                      }
                      disabled={!fallbackFolderId || isMutating}
                    />
                    <DeviceButton
                      icon={<Bluetooth className="h-4 w-4" />}
                      label="Connect over Bluetooth"
                      detail="Quick sync when you just got home"
                      onClick={() =>
                        fallbackFolderId
                          ? void onConnectDevice(fallbackFolderId, "bluetooth")
                          : undefined
                      }
                      disabled={!fallbackFolderId || isMutating}
                    />
                  </div>
                </div>
              </div>

              {activeMeeting ? (
                <>
                  <div className="rounded-[1.75rem] border border-sp-line bg-white p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <p className="font-display text-[10px] uppercase tracking-[0.36em] text-sp-muted">
                          Active session
                        </p>
                        <h2 className="font-display text-3xl font-semibold tracking-tight text-slate-950">
                          {activeMeeting.title}
                        </h2>
                        <p className="max-w-3xl text-sm leading-7 text-slate-600">{activeMeeting.summary}</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <MetricCard label="Transfer" value={`${activeMeeting.syncStats.transferredMb} MB`} />
                        <MetricCard label="Visuals" value={`${activeMeeting.syncStats.visuals}`} />
                        <MetricCard label="Audio" value={`${activeMeeting.syncStats.audioHours.toFixed(1)} h`} />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.75rem] border border-sp-line bg-white p-4 sm:p-6">
                    <div className="mb-5 flex items-center justify-between">
                      <div>
                        <p className="font-display text-[10px] uppercase tracking-[0.36em] text-sp-muted">
                          Ask SmartPuck
                        </p>
                        <p className="mt-2 text-sm text-slate-600">
                          Chat scaffolding is live now. Transcript-grounded answers come after the audio
                          pipeline.
                        </p>
                      </div>
                      <div className="rounded-full border border-sp-line bg-slate-50 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-sp-muted">
                        {activeMeeting.status}
                      </div>
                    </div>

                    <div className="scrollbar-subtle space-y-3 overflow-y-auto pb-2">
                      {activeMeeting.messages.map((message) => (
                        <MessageBubble key={message.id} meeting={activeMeeting} message={message} />
                      ))}
                    </div>

                    <div className="mt-6 flex flex-col gap-3 rounded-[1.5rem] border border-sp-line bg-[#f8fafc] p-3 sm:flex-row sm:items-end">
                      <textarea
                        value={draftMessage}
                        onChange={(event) => setDraftMessage(event.target.value)}
                        rows={3}
                        placeholder={`Ask SmartPuck about "${activeMeeting.title}"`}
                        className="min-h-[96px] flex-1 resize-none rounded-[1.25rem] border border-transparent bg-white px-4 py-3 text-sm leading-7 outline-none focus:border-slate-300"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const trimmed = draftMessage.trim();
                          if (!trimmed) return;
                          void onSendMessage(activeMeeting.id, trimmed);
                          setDraftMessage("");
                        }}
                        className="rounded-[1.25rem] bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!draftMessage.trim() || isMutating}
                      >
                        Send
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyWorkspaceState />
              )}
            </div>
          </section>

          <aside className="scrollbar-subtle overflow-y-auto bg-white/48 px-5 py-5 sm:px-6">
            <div className="space-y-4">
              <div className="rounded-[1.75rem] border border-sp-line bg-white/82 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-display text-sm font-semibold text-slate-950">Roadmap cut for v1</p>
                    <p className="mt-1 text-sm text-sp-muted">
                      Uploads, folders, session records, and chat surface first. Audio intelligence later.
                    </p>
                  </div>
                </div>
              </div>

              <InfoPanel
                icon={<Folders className="h-4 w-4" />}
                title="Folder model"
                description="Folders are the durable organizing unit. Each meeting lands in exactly one folder so uploads stay tidy as the library grows."
              />
              <InfoPanel
                icon={<Upload className="h-4 w-4" />}
                title="Ingest model"
                description="Device sync stores transport, transfer size, visuals count, and audio duration now. Transcript and summary jobs can attach later without reshaping the UI."
              />
              <InfoPanel
                icon={<MessageSquareText className="h-4 w-4" />}
                title="Chat model"
                description="Each meeting owns its own message thread so later transcript retrieval or folder-wide context can be added without a frontend rewrite."
              />

              {activeMeeting ? <MeetingInsights meeting={activeMeeting} /> : null}

              <div className="rounded-[1.75rem] border border-dashed border-sp-line bg-white/75 p-5">
                <p className="font-display text-[10px] uppercase tracking-[0.36em] text-sp-muted">
                  Auth next
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Clerk is now wired in as the first auth provider. The remaining work is production
                  hardening and expanding the post-ingest pipeline.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function StatusChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "solid" | "outline";
}) {
  return (
    <div
      className={clsx(
        "rounded-[1.25rem] border px-4 py-3",
        tone === "solid"
          ? "border-slate-950 bg-slate-950 text-white"
          : "border-sp-line bg-white/75 text-slate-900",
      )}
    >
      <p
        className={clsx(
          "text-[10px] uppercase tracking-[0.32em]",
          tone === "solid" ? "text-white/60" : "text-sp-muted",
        )}
      >
        {label}
      </p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}

function DeviceButton({
  icon,
  label,
  detail,
  onClick,
  disabled,
}: {
  icon: ReactNode;
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
      className="rounded-[1.4rem] border border-white/12 bg-white/8 p-4 text-left text-white hover:-translate-y-0.5 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/12">{icon}</div>
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 text-xs leading-6 text-white/66">{detail}</p>
        </div>
      </div>
    </button>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-sp-line bg-[#f8fafc] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.28em] text-sp-muted">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function MessageBubble({
  meeting,
  message,
}: {
  meeting: MeetingRecord;
  message: MeetingRecord["messages"][number];
}) {
  const isAssistant = message.role === "assistant";

  return (
    <div className={clsx("flex gap-3", isAssistant ? "justify-start" : "justify-end")}>
      {isAssistant ? (
        <div className="mt-1 flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-slate-950 text-white">
          <Sparkles className="h-4 w-4" />
        </div>
      ) : null}
      <div
        className={clsx(
          "max-w-[85%] rounded-[1.5rem] px-4 py-3 text-sm leading-7",
          isAssistant
            ? "bg-[#f8fafc] text-slate-800"
            : "bg-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]",
        )}
      >
        <p>{message.body}</p>
        <div
          className={clsx(
            "mt-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.24em]",
            isAssistant ? "text-sp-muted" : "text-white/56",
          )}
        >
          <span>{isAssistant ? "SmartPuck" : "You"}</span>
          <span>•</span>
          <span>{meeting.startedAtLabel}</span>
        </div>
      </div>
      {!isAssistant ? (
        <div className="mt-1 flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-slate-200 text-slate-900">
          <CircleEllipsis className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );
}

function InfoPanel({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1.75rem] border border-sp-line bg-white/82 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-900">
          {icon}
        </div>
        <div>
          <p className="font-display text-sm font-semibold text-slate-950">{title}</p>
          <p className="mt-2 text-sm leading-7 text-slate-600">{description}</p>
        </div>
      </div>
    </div>
  );
}

function MeetingInsights({ meeting }: { meeting: MeetingRecord }) {
  return (
    <div className="rounded-[1.75rem] border border-sp-line bg-white/82 p-5">
      <p className="font-display text-[10px] uppercase tracking-[0.36em] text-sp-muted">Pinned insights</p>
      <div className="mt-4 space-y-5">
        <section>
          <p className="font-display text-sm font-semibold text-slate-950">Key decisions</p>
          <ul className="mt-3 space-y-3">
            {meeting.decisions.map((decision) => (
              <li key={decision} className="flex gap-3 text-sm leading-7 text-slate-600">
                <span className="mt-3 h-1.5 w-1.5 rounded-full bg-slate-400" />
                <span>{decision}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="font-display text-sm font-semibold text-slate-950">Action items</p>
          <div className="mt-3 space-y-3">
            {meeting.actions.map((action) => (
              <div key={action.id} className="rounded-[1.2rem] border border-sp-line bg-[#f8fafc] p-3">
                <p className="text-sm font-medium text-slate-900">{action.label}</p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-sp-muted">{action.owner}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function EmptyWorkspaceState() {
  return (
    <div className="rounded-[1.75rem] border border-dashed border-sp-line bg-white px-6 py-12 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-950">
        <Upload className="h-5 w-5" />
      </div>
      <h2 className="mt-5 font-display text-3xl font-semibold text-slate-950">
        Seed the first meeting shell
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600">
        Once the first device sync lands, this view becomes the working surface for transcript preview,
        post-meeting chat, and folder-level organization.
      </p>
    </div>
  );
}

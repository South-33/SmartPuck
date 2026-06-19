"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { WorkspaceShell } from "./workspace-shell";
import type { DashboardData, MeetingMessage, MeetingRecord } from "@/lib/workspace-types";

const STREAMING_MESSAGE_CREATED_AT = "1970-01-01T00:00:00.000Z";

export function LiveWorkspace() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading || !isAuthenticated) {
    return <WorkspaceBootShell reason="Connecting workspace" />;
  }

  return <LiveWorkspaceContent />;
}

function LiveWorkspaceContent() {
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [pendingOperations, setPendingOperations] = useState(0);
  const [deletedMeetingIds, setDeletedMeetingIds] = useState<Set<string>>(() => new Set());
  const seededRef = useRef(false);

  const dashboard = useQuery(api.workspace.getDashboard, {
    selectedMeetingId: selectedMeetingId as Id<"meetings"> | null,
  });
  const rememberedDevice = useQuery(api.workspace.getDefaultDevice, {});

  const seedDemoWorkspace = useMutation(api.workspace.seedDemoWorkspace);
  const createFolder = useMutation(api.workspace.createFolder);
  const createChatInFolder = useMutation(api.workspace.createChatInFolder);
  const deleteFolder = useMutation(api.workspace.deleteFolder);
  const deleteMeeting = useMutation(api.workspace.deleteMeeting);
  const createMeetingFromDeviceSync = useMutation(api.workspace.createMeetingFromDeviceSync);
  const generateUploadUrl = useMutation(api.workspace.generateUploadUrl);
  const createMeetingWithAudio = useMutation(api.workspace.createMeetingWithAudio);
  const streamMeetingReply = useAction(api.smartpuckAgent.streamMeetingReply);
  const isMutating = pendingOperations > 0;
  const [displayDashboard, setDisplayDashboard] = useState<DashboardData | undefined>(undefined);
  const activeMeeting = displayDashboard?.activeMeeting ?? null;
  const activeAgentThreadId = activeMeeting?.agentThreadId ?? null;
  const canLoadAgentMessages =
    activeMeeting && activeAgentThreadId && !deletedMeetingIds.has(activeMeeting.id);
  const agentMessages = useUIMessages(
    api.smartpuckAgent.listMeetingMessages,
    canLoadAgentMessages
      ? {
          meetingId: activeMeeting.id as Id<"meetings">,
          threadId: activeAgentThreadId,
        }
      : "skip",
    { initialNumItems: 40, stream: true },
  );
  const liveAgentMessages = useMemo<MeetingMessage[] | null>(() => {
    if (!activeAgentThreadId) {
      return null;
    }

    const messages: MeetingMessage[] = agentMessages.results.map((message) => {
      const reasoning = message.parts
        ?.filter((part) => part.type === "reasoning")
        .map((part) => {
          if (part && typeof part === "object" && "text" in part) {
            return (part as { text?: string }).text;
          }
          return "";
        })
        .join("")
        .trim();

      return {
        id: message.key,
        role: message.role === "assistant" ? "assistant" : "user",
        body: message.text,
        reasoning: reasoning || undefined,
        status: message.status === "streaming" ? "streaming" : "complete",
        createdAt:
          typeof message._creationTime === "number"
            ? new Date(message._creationTime).toISOString()
            : STREAMING_MESSAGE_CREATED_AT,
      };
    });

    return messages.filter((message) => !isLeakedInternalPrompt(message.body));
  }, [activeAgentThreadId, agentMessages.results]);

  async function runOperation<T>(operation: () => Promise<T>) {
    setPendingOperations((current) => current + 1);
    try {
      return await operation();
    } finally {
      setPendingOperations((current) => Math.max(0, current - 1));
    }
  }

  useEffect(() => {
    if (!dashboard || seededRef.current) {
      return;
    }

    const folderNames = dashboard.folders.map((folder: { name: string }) => folder.name);
    const shouldResetStarterWorkspace =
      dashboard.folders.length === 0 ||
      (dashboard.folders.length === 2 &&
        folderNames.includes("Q3 Strategy") &&
        folderNames.includes("Google Meetings")) ||
      (dashboard.folders.length === 2 &&
        folderNames.includes("Device Prototype") &&
        folderNames.includes("AI Processing"));

    if (!shouldResetStarterWorkspace) {
      return;
    }

    seededRef.current = true;
    void seedDemoWorkspace({ reset: shouldResetStarterWorkspace }).then((result) => {
      if (result?.firstMeetingId) {
        setSelectedMeetingId(result.firstMeetingId);
      }
    });
  }, [dashboard, seedDemoWorkspace]);

  useEffect(() => {
    if (!dashboard) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setDisplayDashboard(dashboard);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [dashboard]);

  const fallbackFolderId = useMemo(
    () => displayDashboard?.folders[0]?.id ?? displayDashboard?.activeMeeting?.folderId ?? null,
    [displayDashboard?.activeMeeting?.folderId, displayDashboard?.folders],
  );

  if (!displayDashboard) {
    return <WorkspaceBootShell reason="Loading workspace" />;
  }

  return (
    <WorkspaceShell
      dashboard={displayDashboard}
      liveMessages={liveAgentMessages}
      mode="live"
      isMutating={isMutating}
      fallbackFolderId={fallbackFolderId}
      initialPuckAddress={rememberedDevice?.baseUrl ?? null}
      onCreateFolder={async (name) => {
        return await runOperation(() => createFolder({ name }));
      }}
      onDeleteFolder={async (folderId) => {
        const nextMeetingId = await runOperation(() =>
          deleteFolder({
            folderId: folderId as Id<"folders">,
          }),
        );
        setSelectedMeetingId(nextMeetingId);
      }}
      onCreateChat={async (folderId) => {
        const meetingId = await runOperation(() =>
          createChatInFolder({
            folderId: folderId as Id<"folders">,
          }),
        );
        setSelectedMeetingId(meetingId);
        return meetingId;
      }}
      onConnectDevice={async (folderId, transport) => {
        const meetingId = await runOperation(() =>
          createMeetingFromDeviceSync({
            folderId: folderId as Id<"folders">,
            transport,
          }),
        );
        setSelectedMeetingId(meetingId);
        return meetingId;
      }}
      onGenerateUploadUrl={async () => {
        return await runOperation(() => generateUploadUrl());
      }}
      onCreateMeetingWithAudio={async (args) => {
        const meetingId = await runOperation(() =>
          createMeetingWithAudio({
            folderId: args.folderId as Id<"folders">,
            title: args.title,
            transport: args.transport,
            audioFileId: args.audioFileId as Id<"_storage"> | undefined,
            audioFileName: args.audioFileName,
            transcriptText: args.transcriptText,
            transcriptJson: args.transcriptJson,
            durationLabel: args.durationLabel,
            transferredMb: args.transferredMb,
            audioHours: args.audioHours,
          }),
        );
        setSelectedMeetingId(meetingId);
        return meetingId;
      }}
      onSelectMeeting={(meetingId) => {
        startTransition(() => {
          setDisplayDashboard((current) => selectMeetingInDashboard(current, meetingId));
          setSelectedMeetingId(meetingId);
        });
      }}
      onDeleteMeeting={async (meetingId) => {
        const optimisticNextMeetingId = nextMeetingIdAfterDelete(displayDashboard, meetingId);
        setDeletedMeetingIds((current) => new Set(current).add(meetingId));
        startTransition(() => {
          setDisplayDashboard((current) => deleteMeetingInDashboard(current, meetingId));
          setSelectedMeetingId(optimisticNextMeetingId);
        });

        try {
          const nextMeetingId = await runOperation(() =>
            deleteMeeting({
              meetingId: meetingId as Id<"meetings">,
            }),
          );
          setSelectedMeetingId(nextMeetingId);
        } finally {
          setDeletedMeetingIds((current) => {
            const next = new Set(current);
            next.delete(meetingId);
            return next;
          });
        }
      }}
      onSendMessage={async (meetingId, body, privateContext) => {
        await runOperation(() =>
          streamMeetingReply({
            meetingId: meetingId as Id<"meetings">,
            prompt: body,
            privateContext,
          }),
        );
      }}
    />
  );
}

function nextMeetingIdAfterDelete(dashboard: DashboardData | undefined, meetingId: string) {
  if (!dashboard) {
    return null;
  }

  const deletedMeeting = dashboard.folders
    .flatMap((folder) => folder.meetings)
    .find((meeting) => meeting.id === meetingId);
  const folderId = deletedMeeting?.folderId ?? dashboard.activeMeeting?.folderId ?? null;
  const sameFolderNext =
    dashboard.folders
      .find((folder) => folder.id === folderId)
      ?.meetings.find((meeting) => meeting.id !== meetingId)?.id ?? null;

  return (
    sameFolderNext ??
    dashboard.folders
      .flatMap((folder) => folder.meetings)
      .find((meeting) => meeting.id !== meetingId)?.id ??
    null
  );
}

function deleteMeetingInDashboard(
  dashboard: DashboardData | undefined,
  meetingId: string,
): DashboardData | undefined {
  if (!dashboard) {
    return dashboard;
  }

  const nextFolders = dashboard.folders.map((folder) => ({
    ...folder,
    meetings: folder.meetings.filter((meeting) => meeting.id !== meetingId),
  }));
  const nextActiveMeetingId =
    dashboard.activeMeetingId === meetingId
      ? nextMeetingIdAfterDelete(dashboard, meetingId)
      : dashboard.activeMeetingId;
  const nextActiveMeeting =
    nextFolders.flatMap((folder) => folder.meetings).find((meeting) => meeting.id === nextActiveMeetingId) ??
    null;

  return {
    ...dashboard,
    activeMeetingId: nextActiveMeetingId,
    activeMeeting: nextActiveMeeting,
    folders: nextFolders,
  };
}

function selectMeetingInDashboard(
  dashboard: DashboardData | undefined,
  meetingId: string,
): DashboardData | undefined {
  if (!dashboard) {
    return dashboard;
  }

  const selectedMeeting = dashboard.folders
    .flatMap((folder) => folder.meetings)
    .find((meeting) => meeting.id === meetingId);

  if (!selectedMeeting) {
    return dashboard;
  }

  const activeMeeting =
    selectedMeeting.id === dashboard.activeMeeting?.id
      ? dashboard.activeMeeting
      : preserveHydratedMeeting(selectedMeeting, dashboard.activeMeeting);

  return {
    ...dashboard,
    activeMeetingId: meetingId,
    activeMeeting,
    folders: dashboard.folders.map((folder) => ({
      ...folder,
      meetings: folder.meetings.map((meeting) =>
        meeting.id === meetingId ? activeMeeting : meeting,
      ),
    })),
  };
}

function preserveHydratedMeeting(
  selectedMeeting: MeetingRecord,
  currentActiveMeeting: MeetingRecord | null,
) {
  if (selectedMeeting.id === currentActiveMeeting?.id) {
    return currentActiveMeeting;
  }

  return selectedMeeting;
}

function WorkspaceBootShell({ reason }: { reason: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-on-background lg:h-screen lg:flex-row lg:overflow-hidden">
      <aside className="z-30 flex w-full flex-col border-b border-gray-100 bg-[#fbfbfd]/80 px-6 pb-5 pt-6 lg:h-screen lg:w-72 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-11 w-11 rounded-full border border-gray-200 bg-white shadow-sm" />
          <div className="space-y-2">
            <div className="h-4 w-28 rounded-full bg-gray-200/80" />
            <div className="h-2 w-20 rounded-full bg-gray-100" />
          </div>
        </div>
        <div className="mb-8 h-12 rounded-full bg-gray-100" />
        <div className="space-y-3">
          <div className="h-3 w-20 rounded-full bg-gray-100" />
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="h-11 rounded-xl bg-gradient-to-r from-gray-100 via-white to-gray-100"
            />
          ))}
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col bg-white lg:h-screen lg:overflow-hidden">
        <header className="flex h-20 flex-shrink-0 items-center justify-between border-b border-gray-100 bg-white/70 px-6 lg:px-10">
          <div className="flex gap-8">
            <div className="h-4 w-20 rounded-full bg-gray-200" />
            <div className="h-4 w-24 rounded-full bg-gray-100" />
            <div className="h-4 w-20 rounded-full bg-gray-100" />
          </div>
          <div className="h-10 w-40 rounded-full bg-gray-100" />
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="flex min-h-0 flex-col border-r border-gray-50">
            <div className="flex-1 space-y-10 p-10 lg:p-12">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-gray-300">
                {reason}
              </p>
              <div className="h-20 max-w-3xl rounded-[2rem] bg-gray-50" />
              <div className="ml-auto h-16 max-w-sm rounded-[2rem] bg-gray-50" />
              <div className="h-28 max-w-3xl rounded-[2rem] bg-gray-50" />
            </div>
            <div className="border-t border-gray-100/80 px-8 py-6">
              <div className="mx-auto h-16 max-w-3xl rounded-[1.5rem] bg-gray-50" />
            </div>
          </section>
          <aside className="hidden bg-[#f8f9fa] p-10 xl:block">
            <div className="space-y-8">
              <div className="h-4 w-40 rounded-full bg-gray-200" />
              <div className="h-10 w-64 rounded-full bg-gray-100" />
              <div className="h-44 rounded-[2.5rem] bg-white" />
              <div className="h-44 rounded-[2.5rem] bg-white" />
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function isLeakedInternalPrompt(body: string) {
  return body.trimStart().startsWith("SMARTPUCK PROPOSAL CONTEXT:");
}

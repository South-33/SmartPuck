"use client";

import { useMemo, useState, useTransition } from "react";
import { demoWorkspace } from "@/lib/demo-workspace";
import type { DashboardData, DeviceTransport } from "@/lib/workspace-types";
import { WorkspaceShell } from "./workspace-shell";

export function DemoWorkspace() {
  const [dashboard, setDashboard] = useState<DashboardData>(demoWorkspace);
  const [isPending, startTransition] = useTransition();

  const fallbackFolderId = useMemo(
    () => dashboard.folders[0]?.id ?? dashboard.activeMeeting?.folderId ?? null,
    [dashboard.activeMeeting?.folderId, dashboard.folders],
  );

  function createFolder(name: string) {
    startTransition(() => {
      const id = `demo-folder-${Date.now()}`;
      setDashboard((current) => ({
        ...current,
        folders: [
          {
            id,
            name,
            accent: "silver",
            meetings: [],
          },
          ...current.folders,
        ],
      }));
    });
  }

  function createChat(folderId: string) {
    const id = `demo-chat-${Date.now()}`;
    startTransition(() => {
      setDashboard((current) => {
        const nextMeeting = {
          id,
          folderId,
          title: "New SmartPuck Chat",
          durationLabel: "0m",
          status: "ready" as const,
          startedAtLabel: "Just now",
          sourceTransport: "manual" as const,
          summary:
            "A saved chat thread for asking SmartPuck product, hardware, and meeting intelligence questions.",
          transcriptPreview:
            "This chat is grounded in the SmartPuck proposal until a real meeting transcript is uploaded.",
          syncStats: {
            percent: 100,
            transferredMb: 0,
            visuals: 0,
            audioHours: 0,
          },
          decisions: ["Use this chat to explore SmartPuck before real audio processing is connected."],
          actions: [
            {
              id: `${id}-action-1`,
              owner: "SmartPuck",
              label: "Ask about device capture, USB transfer, AI notes, or exports.",
            },
          ],
          messages: [],
        };

        return {
          ...current,
          activeMeetingId: id,
          activeMeeting: nextMeeting,
          folders: current.folders.map((folder) =>
            folder.id === folderId
              ? { ...folder, meetings: [nextMeeting, ...folder.meetings] }
              : folder,
          ),
        };
      });
    });
    return id;
  }

  async function connectDevice(folderId: string, transport: DeviceTransport) {
    const id = `demo-meeting-${Date.now()}`;
    startTransition(() => {
      setDashboard((current) => {
        const createdAt = new Date().toISOString();
        const nextMeeting = {
          id,
          folderId,
          title:
            transport === "usb"
              ? "Desk Sync Capture"
              : transport === "wifi"
                ? "Wi-Fi Live Recording"
                : transport === "manual"
                  ? "Imported Recording"
                  : "Bluetooth Walk-In Capture",
          durationLabel: transport === "wifi" ? "0m" : "36m",
          status: "uploaded" as const,
          startedAtLabel: "Just now",
          sourceTransport: transport,
          summary:
            transport === "wifi"
              ? "A live SmartPuck Wi-Fi recording was saved locally on this computer and linked to the selected folder."
              : "A SmartPuck recording was imported and linked to this folder for follow-up chat.",
          transcriptPreview:
            transport === "wifi"
              ? "Audio was captured from the device stream. Import the saved WAV when you want local transcription attached to this meeting."
              : "Recording received. Local transcription will attach searchable transcript text.",
          syncStats: {
            percent: 100,
            transferredMb: transport === "usb" ? 128 : transport === "wifi" ? 0 : 76,
            visuals: 0,
            audioHours: transport === "usb" ? 1.9 : transport === "wifi" ? 0 : 1.2,
          },
          decisions: [
            "Keep each recording attached to the folder selected at ingest time.",
            "Meeting artifacts stay attached to the folder selected at ingest time.",
          ],
          actions: [
            { id: `${id}-1`, owner: "Product", label: "Keep the demo flow simple: import, transcribe, chat." },
            { id: `${id}-2`, owner: "AI", label: "Use transcript search tools for folder chat questions." },
          ],
          messages: [
            {
              id: `${id}-assistant`,
              role: "assistant" as const,
              body:
                "The recording is linked to this folder. Import or transcribe the audio to make the chat answer from transcript text.",
              status: "complete" as const,
              createdAt,
            },
          ],
        };

        return {
          ...current,
          activeMeetingId: id,
          activeMeeting: nextMeeting,
          folders: current.folders.map((folder) =>
            folder.id === folderId
              ? { ...folder, meetings: [nextMeeting, ...folder.meetings] }
              : folder,
          ),
        };
      });
    });

    return id;
  }

  function selectMeeting(meetingId: string) {
    setDashboard((current) => {
      for (const folder of current.folders) {
        const selected = folder.meetings.find((meeting) => meeting.id === meetingId);
        if (selected) {
          return { ...current, activeMeetingId: meetingId, activeMeeting: selected };
        }
      }
      return current;
    });
  }

  function deleteMeeting(meetingId: string) {
    startTransition(() => {
      setDashboard((current) => {
        const nextFolders = current.folders.map((folder) => ({
          ...folder,
          meetings: folder.meetings.filter((meeting) => meeting.id !== meetingId),
        }));
        const nextActiveMeeting = nextFolders.flatMap((folder) => folder.meetings)[0] ?? null;

        return {
          ...current,
          folders: nextFolders,
          activeMeetingId: current.activeMeetingId === meetingId ? nextActiveMeeting?.id ?? null : current.activeMeetingId,
          activeMeeting: current.activeMeetingId === meetingId ? nextActiveMeeting : current.activeMeeting,
        };
      });
    });
  }

  function deleteFolder(folderId: string) {
    startTransition(() => {
      setDashboard((current) => {
        const nextFolders = current.folders.filter((folder) => folder.id !== folderId);
        const removedActiveMeeting = current.activeMeeting?.folderId === folderId;
        const nextActiveMeeting = removedActiveMeeting
          ? nextFolders.flatMap((folder) => folder.meetings)[0] ?? null
          : current.activeMeeting;

        return {
          ...current,
          folders: nextFolders,
          activeMeetingId: removedActiveMeeting ? nextActiveMeeting?.id ?? null : current.activeMeetingId,
          activeMeeting: nextActiveMeeting,
        };
      });
    });
  }

  function sendMessage(meetingId: string, body: string) {
    startTransition(() => {
      setDashboard((current) => {
        const timestamp = new Date().toISOString();
        const userMessage = {
          id: `${meetingId}-user-${Date.now()}`,
          role: "user" as const,
          body,
          status: "complete" as const,
          createdAt: timestamp,
        };
        const assistantMessage = {
          id: `${meetingId}-assistant-${Date.now()}`,
          role: "assistant" as const,
          body:
            "**SmartPuck demo:** Folder organization, local transcription, transcript search, and saved chat are the core flow.",
          status: "complete" as const,
          createdAt: timestamp,
        };

        const nextFolders = current.folders.map((folder) => ({
          ...folder,
          meetings: folder.meetings.map((meeting) =>
            meeting.id === meetingId
              ? {
                  ...meeting,
                  messages: [...meeting.messages, userMessage, assistantMessage],
                }
              : meeting,
          ),
        }));

        const nextActiveMeeting = nextFolders
          .flatMap((folder) => folder.meetings)
          .find((meeting) => meeting.id === meetingId);

        return {
          ...current,
          folders: nextFolders,
          activeMeeting: nextActiveMeeting ?? current.activeMeeting,
        };
      });
    });
  }

  return (
    <WorkspaceShell
      dashboard={dashboard}
      mode="demo"
      isMutating={isPending}
      fallbackFolderId={fallbackFolderId}
      onCreateFolder={createFolder}
      onDeleteFolder={deleteFolder}
      onCreateChat={createChat}
      onConnectDevice={connectDevice}
      onSelectMeeting={selectMeeting}
      onDeleteMeeting={deleteMeeting}
      onSendMessage={sendMessage}
    />
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { demoWorkspace } from "@/lib/demo-workspace";
import type { DashboardData, DeviceTransport } from "@/lib/workspace-types";
import { WorkspaceShell } from "./workspace-shell";

export function DemoWorkspace() {
  const [dashboard, setDashboard] = useState<DashboardData>(demoWorkspace);
  const [isPending, startTransition] = useTransition();

  const fallbackFolderId = useMemo(
    () => dashboard.activeMeeting?.folderId ?? dashboard.folders[0]?.id ?? null,
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

  async function connectDevice(folderId: string, transport: DeviceTransport) {
    const id = `demo-meeting-${Date.now()}`;
    startTransition(() => {
      setDashboard((current) => {
        const createdAt = new Date().toISOString();
        const nextMeeting = {
          id,
          folderId,
          title: transport === "usb" ? "Desk Sync Capture" : "Bluetooth Walk-In Capture",
          durationLabel: "36m",
          status: "uploaded" as const,
          startedAtLabel: "Just now",
          sourceTransport: transport,
          summary:
            "Session metadata uploaded. Audio processing is intentionally stubbed for now, but the meeting is ready for organization and follow-up chat.",
          transcriptPreview:
            "Raw capture received from SmartPuck. Transcript generation will be attached later when the audio pipeline lands.",
          syncStats: {
            percent: 100,
            transferredMb: transport === "usb" ? 128 : 76,
            visuals: transport === "usb" ? 18 : 11,
            audioHours: transport === "usb" ? 1.9 : 1.2,
          },
          decisions: [
            "Upload transport is now stored with the meeting record for later pipeline routing.",
            "Meeting artifacts stay attached to the folder selected at ingest time.",
          ],
          actions: [
            { id: `${id}-1`, owner: "Product", label: "Choose the first production auth provider" },
            { id: `${id}-2`, owner: "Backend", label: "Attach transcript + summary job after ingest" },
          ],
          messages: [
            {
              id: `${id}-assistant`,
              role: "assistant" as const,
              body:
                "I have the meeting shell ready. Once audio processing is added, this thread can answer against the transcript and extracted action items.",
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

  function sendMessage(meetingId: string, body: string) {
    startTransition(() => {
      setDashboard((current) => {
        const timestamp = new Date().toISOString();
        const userMessage = {
          id: `${meetingId}-user-${Date.now()}`,
          role: "user" as const,
          body,
          createdAt: timestamp,
        };
        const assistantMessage = {
          id: `${meetingId}-assistant-${Date.now()}`,
          role: "assistant" as const,
          body:
            "This is the local demo path. Folder organization, meeting shells, and thread persistence are ready; transcript-grounded answers will plug in after the audio pipeline exists.",
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
      onConnectDevice={connectDevice}
      onSelectMeeting={selectMeeting}
      onSendMessage={sendMessage}
    />
  );
}

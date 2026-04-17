import type { DashboardData } from "./workspace-types";

export const demoWorkspace: DashboardData = {
  viewer: {
    isAuthenticated: false,
    scopeLabel: "Local demo workspace",
  },
  activeMeetingId: "meeting-q3",
  activeMeeting: {
    id: "meeting-q3",
    folderId: "folder-q3",
    title: "Q3 Strategy Meeting",
    durationLabel: "45m",
    status: "ready",
    startedAtLabel: "Today",
    sourceTransport: "usb",
    summary:
      "Prototype notes, pinned decisions, and chat are already shaped around the real SmartPuck workflow so the transcript pipeline can drop in later without reworking the surface area.",
    transcriptPreview:
      "Approved Berlin expansion budget, pushed APAC discussion, and assigned legal/tax follow-up for the new hub.",
    syncStats: {
      percent: 100,
      transferredMb: 83,
      visuals: 12,
      audioHours: 1.5,
    },
    decisions: [
      "Approve the folder-first workspace model before transcript search ships.",
      "Keep chat scoped to a single meeting for v1 to avoid context ambiguity.",
    ],
    actions: [
      { id: "action-q3-1", owner: "Product", label: "Define transcript-to-chat handoff contract" },
      { id: "action-q3-2", owner: "Infra", label: "Choose auth provider before production hardening" },
    ],
    messages: [
      {
        id: "message-q3-1",
        role: "assistant",
        body:
          "I have the meeting shell ready. When the audio pipeline lands, this thread can answer against the transcript and extracted action items without changing the UI contract.",
        createdAt: "2026-04-17T07:00:00.000Z",
      },
      {
        id: "message-q3-2",
        role: "user",
        body: "What should the first backend milestone guarantee?",
        createdAt: "2026-04-17T07:02:00.000Z",
      },
      {
        id: "message-q3-3",
        role: "assistant",
        body:
          "Stable ingest metadata, durable folders, per-meeting threads, and a clean authorization boundary. Do not bind the audio pipeline into the schema yet.",
        createdAt: "2026-04-17T07:02:30.000Z",
      },
    ],
  },
  folders: [
    {
      id: "folder-q3",
      name: "Q3 Strategy",
      accent: "silver",
      meetings: [
        {
          id: "meeting-q3",
          folderId: "folder-q3",
          title: "Q3 Strategy Meeting",
          durationLabel: "45m",
          status: "ready",
          startedAtLabel: "Today",
          sourceTransport: "usb",
          summary:
            "Prototype notes, pinned decisions, and chat are already shaped around the real SmartPuck workflow so the transcript pipeline can drop in later without reworking the surface area.",
          transcriptPreview:
            "Approved Berlin expansion budget, pushed APAC discussion, and assigned legal/tax follow-up for the new hub.",
          syncStats: {
            percent: 100,
            transferredMb: 83,
            visuals: 12,
            audioHours: 1.5,
          },
          decisions: [
            "Approve the folder-first workspace model before transcript search ships.",
            "Keep chat scoped to a single meeting for v1 to avoid context ambiguity.",
          ],
          actions: [
            { id: "action-q3-1", owner: "Product", label: "Define transcript-to-chat handoff contract" },
            { id: "action-q3-2", owner: "Infra", label: "Choose auth provider before production hardening" },
          ],
          messages: [
            {
              id: "message-q3-1",
              role: "assistant",
              body:
                "I have the meeting shell ready. When the audio pipeline lands, this thread can answer against the transcript and extracted action items without changing the UI contract.",
              createdAt: "2026-04-17T07:00:00.000Z",
            },
            {
              id: "message-q3-2",
              role: "user",
              body: "What should the first backend milestone guarantee?",
              createdAt: "2026-04-17T07:02:00.000Z",
            },
            {
              id: "message-q3-3",
              role: "assistant",
              body:
                "Stable ingest metadata, durable folders, per-meeting threads, and a clean authorization boundary. Do not bind the audio pipeline into the schema yet.",
              createdAt: "2026-04-17T07:02:30.000Z",
            },
          ],
        },
      ],
    },
    {
      id: "folder-google",
      name: "Google Meetings",
      accent: "silver",
      meetings: [
        {
          id: "meeting-google",
          folderId: "folder-google",
          title: "Product Sync - Google",
          durationLabel: "30m",
          status: "uploaded",
          startedAtLabel: "Yesterday",
          sourceTransport: "bluetooth",
          summary:
            "Uploaded from Bluetooth on arrival. The folder placement and shell are live even though transcript generation is not.",
          transcriptPreview:
            "Product review placeholder. Live transcript extraction will be connected in a later milestone.",
          syncStats: {
            percent: 100,
            transferredMb: 52,
            visuals: 6,
            audioHours: 0.8,
          },
          decisions: ["Keep the folder clean and avoid premature AI automation."],
          actions: [{ id: "action-google-1", owner: "Product", label: "Prioritize transcript processing spike" }],
          messages: [
            {
              id: "message-google-1",
              role: "assistant",
              body: "This meeting is uploaded and organized. Transcript-aware answers are still pending the audio pipeline.",
              createdAt: "2026-04-16T19:00:00.000Z",
            },
          ],
        },
      ],
    },
  ],
};

import type { DashboardData } from "./workspace-types";

const createdAt = "2026-04-21T07:00:00.000Z";

export const demoWorkspace: DashboardData = {
  viewer: {
    isAuthenticated: false,
    scopeLabel: "Local demo workspace",
  },
  activeMeetingId: "meeting-device-prototype",
  activeMeeting: {
    id: "meeting-device-prototype",
    folderId: "folder-device-prototype",
    title: "Hardware MVP Review",
    durationLabel: "42m",
    status: "ready",
    startedAtLabel: "Today",
    sourceTransport: "usb",
    summary:
      "Review of the SmartPuck hardware MVP: offline audio recording, LOLIN S3 Pro control board, INMP441 microphone, microSD storage, USB transfer, and the sub-$50 bill of materials target.",
    transcriptPreview:
      "The team agreed the first hardware proof should focus on LOLIN S3 Pro, INMP441 audio, microSD storage, USB transfer, and a simple puck enclosure before Wi-Fi, camera, or mobile companion scope.",
    syncStats: {
      percent: 100,
      transferredMb: 83,
      visuals: 0,
      audioHours: 0.7,
    },
    decisions: [
      "Keep the first device offline during recording to avoid cloud or phone dependency.",
      "Use USB transfer as the reliable MVP path before adding Wi-Fi sync.",
      "Treat visual context as optional uploaded attachments, not a required camera feature.",
    ],
    actions: [
      {
        id: "hardware-action-1",
        owner: "Hardware",
        label: "Validate LOLIN S3 Pro, INMP441, microSD, PH2.0 LiPo, button, and LED wiring together.",
      },
      {
        id: "hardware-action-2",
        owner: "Product",
        label: "Keep the target BOM below $50 and defer speaker diarisation to future scope.",
      },
    ],
    messages: [
      {
        id: "message-hardware-1",
        role: "assistant",
        body:
          "I loaded the Hardware MVP Review. Ask me about device components, recording constraints, battery goals, USB transfer, or what should stay out of scope for the first SmartPuck prototype.",
        createdAt,
      },
    ],
  },
  folders: [
    {
      id: "folder-device-prototype",
      name: "Device Prototype",
      accent: "silver",
      meetings: [
        {
          id: "meeting-device-prototype",
          folderId: "folder-device-prototype",
          title: "Hardware MVP Review",
          durationLabel: "42m",
          status: "ready",
          startedAtLabel: "Today",
          sourceTransport: "usb",
          summary:
            "Review of the SmartPuck hardware MVP: offline audio recording, LOLIN S3 Pro control board, INMP441 microphone, microSD storage, USB transfer, and the sub-$50 bill of materials target.",
          transcriptPreview:
            "The team agreed the first hardware proof should focus on LOLIN S3 Pro, INMP441 audio, microSD storage, USB transfer, and a simple puck enclosure before Wi-Fi, camera, or mobile companion scope.",
          syncStats: {
            percent: 100,
            transferredMb: 83,
            visuals: 0,
            audioHours: 0.7,
          },
          decisions: [
            "Keep the first device offline during recording to avoid cloud or phone dependency.",
            "Use USB transfer as the reliable MVP path before adding Wi-Fi sync.",
            "Treat visual context as optional uploaded attachments, not a required camera feature.",
          ],
          actions: [
            {
              id: "hardware-action-1",
              owner: "Hardware",
              label: "Validate LOLIN S3 Pro, INMP441, microSD, PH2.0 LiPo, button, and LED wiring together.",
            },
            {
              id: "hardware-action-2",
              owner: "Product",
              label: "Keep the target BOM below $50 and defer speaker diarisation to future scope.",
            },
          ],
          messages: [
            {
              id: "message-hardware-1",
              role: "assistant",
              body:
                "I loaded the Hardware MVP Review. Ask me about device components, recording constraints, battery goals, USB transfer, or what should stay out of scope for the first SmartPuck prototype.",
              createdAt,
            },
          ],
        },
      ],
    },
    {
      id: "folder-ai-processing",
      name: "AI Processing",
      accent: "silver",
      meetings: [
        {
          id: "meeting-ai-processing",
          folderId: "folder-ai-processing",
          title: "Transcript and Notes Pipeline",
          durationLabel: "35m",
          status: "ready",
          startedAtLabel: "Yesterday",
          sourceTransport: "bluetooth",
          summary:
            "Planning session for the SmartPuck web app pipeline: import audio session files, transcribe the recording, and generate structured notes and action items.",
          transcriptPreview:
            "The app should detect imported session directories, pass audio to speech-to-text, and prompt an LLM for summary, decisions, and action items. Uploaded slides or photos can be optional context later.",
          syncStats: {
            percent: 100,
            transferredMb: 52,
            visuals: 0,
            audioHours: 0.6,
          },
          decisions: [
            "Use meeting chat threads as the product surface before the full audio processing pipeline is built.",
            "Ground placeholder answers in the SmartPuck proposal so demos feel realistic.",
            "Keep exports to Markdown, PDF, or clipboard as a later but visible product promise.",
          ],
          actions: [
            {
              id: "ai-action-1",
              owner: "Web",
              label: "Add durable folders and saved chat threads before wiring real transcript jobs.",
            },
            {
              id: "ai-action-2",
              owner: "AI",
              label: "Use Gemini for proposal-aware assistant replies while audio processing is stubbed.",
            },
          ],
          messages: [
            {
              id: "message-ai-1",
              role: "assistant",
              body:
                "I loaded the Transcript and Notes Pipeline chat. Ask me about transcription, optional context attachments, structured notes, exports, or how the web app should process SmartPuck sessions.",
              createdAt: "2026-04-20T07:00:00.000Z",
            },
          ],
        },
      ],
    },
  ],
};

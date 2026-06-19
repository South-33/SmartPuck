import type { DashboardData } from "./workspace-types";

const createdAt = "2026-04-21T07:00:00.000Z";

const demoMeeting = {
  id: "meeting-demo-prototype",
  folderId: "folder-demo",
  title: "Device Prototype Review",
  durationLabel: "42m",
  status: "ready" as const,
  startedAtLabel: "Today",
  sourceTransport: "usb" as const,
  summary:
    "Demo review of the SmartPuck prototype: offline recording, LOLIN S3 Pro control board, INMP441 microphone, microSD storage, USB transfer, local transcription, and folder-based chat.",
  transcriptPreview:
    "The team agreed the demo should focus on recording audio, importing it locally, transcribing on the laptop, saving the transcript to Convex, and asking folder-scoped chat questions.",
  syncStats: {
    percent: 100,
    transferredMb: 83,
    visuals: 0,
    audioHours: 0.7,
  },
  decisions: [
    "Keep recording audio-first and reliable before adding visual capture.",
    "Use local transcription so raw audio does not need to leave the laptop for the demo.",
    "Save transcripts into the selected folder so chat can search and read them later.",
  ],
  actions: [
    {
      id: "demo-action-1",
      owner: "Hardware",
      label: "Validate the LOLIN S3 Pro, INMP441, microSD, battery, button, and LED prototype together.",
    },
    {
      id: "demo-action-2",
      owner: "AI",
      label: "Demo the folder chat against real transcript text before adding diarization.",
    },
  ],
  transcriptText: `[10:00:05] Sarah (Product): Thanks for joining the SmartPuck demo review. Let's align on what has to work for the presentation.
[10:00:15] John (Hardware): The core device is the LOLIN S3 Pro with the INMP441 microphone and onboard microSD storage. It records 16-bit 16kHz WAV audio.
[10:01:00] Dave (Firmware): The button starts and stops recording, and the device stores sessions under the sessions folder on the card.
[10:01:45] Sarah (Product): What should happen when someone brings the recording into the web app?
[10:02:00] Elena (AI): The user selects a folder, imports the audio, and the laptop runs local Whisper transcription. We upload transcript text to Convex, not the raw audio.
[10:02:45] Alex (Frontend): Then the chat uses tools to list meetings, search transcript snippets, and read a specific transcript when the user asks about a meeting.
[10:03:20] John (Hardware): Battery, Wi-Fi, Bluetooth, and storage state should show as device status later, but for the demo the main path is audio in, transcript out, chat working.
[10:04:15] Sarah (Product): Perfect. Keep it simple and make the folder called Demo ready for every new account.`,
  messages: [
    {
      id: "message-demo-1",
      role: "assistant" as const,
      body:
        "I loaded the demo meeting. Ask me about the prototype, local transcription flow, USB/Wi-Fi sync, battery goals, or what the team decided.",
      status: "complete" as const,
      createdAt,
    },
  ],
};

export const demoWorkspace: DashboardData = {
  viewer: {
    isAuthenticated: false,
    scopeLabel: "Local demo workspace",
  },
  activeMeetingId: demoMeeting.id,
  activeMeeting: demoMeeting,
  folders: [
    {
      id: "folder-demo",
      name: "Demo",
      accent: "silver",
      meetings: [demoMeeting],
    },
  ],
};

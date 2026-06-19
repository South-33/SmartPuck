export const SMARTPUCK_PROPOSAL_CONTEXT = `
SmartPuck is a compact, low-cost meeting and lecture recorder roughly the size of a hockey puck.
It records far-field audio as the core MVP capture path.
The device is designed to operate offline while recording, then transfer a session to the companion web app over USB.
The web app processes audio into timestamped transcripts and generates structured notes with summaries, key discussion points, decisions, and action items.
The target product position is non-intrusive, affordable, and not dependent on phone recording or always-on cloud capture.
Hardware direction: LOLIN S3 Pro ESP32-S3 with onboard microSD/TF slot and battery charging, INMP441 I2S MEMS microphone, 32GB branded microSD, 1500-3000mAh 3.7V LiPo with JST PH2.0 connector, simple button/LED controls, and a local prototype puck enclosure.
Firmware direction: C++ with Arduino or ESP-IDF, I2S DMA audio chunks, WAV/PCM writes to FAT32 microSD sessions stored under /sessions/YYYYMMDD_HHMMSS/.
Workflow direction: record offline, plug into PC, browser app detects or imports session files, transcribe audio, generate structured notes, then export notes as Markdown, PDF, or clipboard content. Images/slides may be added later as optional uploaded context, not camera-first MVP capture.
Constraints and goals: target hardware BOM under $50 USD, up to 8 hours recording on a 2000mAh cell, keep the MVP focused on recording, transfer, organization, and AI notes before advanced features.
Future scope: optional visual attachments, Wi-Fi sync, wake word recording, speaker diarisation, mobile companion app, and multi-unit sync for large lecture halls.
`;

export const STARTER_WORKSPACE = [
  {
    folderName: "Demo",
    meetingTitle: "Device Prototype Review",
    durationLabel: "42m",
    startedAtLabel: "Today",
    summary:
      "Demo review of the SmartPuck prototype: offline recording, LOLIN S3 Pro control board, INMP441 microphone, microSD storage, USB transfer, local transcription, and folder-based chat.",
    transcriptPreview:
      "The team agreed the demo should focus on recording audio, importing it locally, transcribing on the laptop, saving the transcript to Convex, and asking folder-scoped chat questions.",
    syncTransferredMb: 83,
    syncVisuals: 0,
    syncAudioHours: 0.7,
    decisions: [
      "Keep recording audio-first and reliable before adding visual capture.",
      "Use local transcription so raw audio does not need to leave the laptop for the demo.",
      "Save transcripts into the selected folder so chat can search and read them later.",
    ],
    actions: [
      {
        owner: "Hardware",
        label: "Validate the LOLIN S3 Pro, INMP441, microSD, battery, button, and LED prototype together.",
      },
      {
        owner: "Product",
        label: "Demo the folder chat against real transcript text before adding diarization.",
      },
    ],
    transcriptText: `[10:00:05] Sarah (Product): Thanks for joining the hardware review today. Let's align on the MVP physical design and components.
[10:00:15] John (Hardware): Right. The core directive is to keep the BOM under $50 USD. We've shortlisted the LOLIN S3 Pro ESP32-S3 board. It's affordable, has built-in battery charging, and has an onboard microSD slot.
[10:01:00] Dave (Firmware): The onboard microSD CS pin is GPIO 46. I've tested write latency, and I2S DMA writes directly to it will run fine synchronized via a file mutex on Core 1.
[10:01:45] Sarah (Product): Good. What microphone are we using for audio capture?
[10:02:00] John (Hardware): The INMP441 MEMS microphone. It supports I2S protocol, giving us clean 16-bit 16kHz audio directly.
[10:02:30] Dave (Firmware): For pins: SCK is GPIO 4, WS is GPIO 5, and SD is GPIO 6. This layout is locked in and tested.
[10:03:10] Sarah (Product): What about the battery size?
[10:03:20] John (Hardware): A 2000mAh 3.7V LiPo with a JST PH2.0 connector fits nicely inside our 3D printed puck enclosure. It should give us up to 8 hours of continuous offline recording.
[10:04:00] Sarah (Product): For the web demo, I want to import a recording, choose a folder, transcribe locally, and then ask chat what happened.
[10:04:15] Alex (Frontend): That works. We'll store transcript text in Convex, keep the audio local, and let the agent search the selected folder instead of loading every transcript into the prompt.`,
    openingMessage:
      "I loaded the demo meeting. Ask me about the prototype, local transcription flow, USB/Wi-Fi sync, battery goals, or what the team decided.",
  },
];

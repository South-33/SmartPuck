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
    folderName: "Device Prototype",
    meetingTitle: "Hardware MVP Review",
    durationLabel: "42m",
    startedAtLabel: "Today",
    summary:
      "Review of the SmartPuck hardware MVP: offline audio recording, LOLIN S3 Pro control board, INMP441 microphone, microSD storage, USB transfer, and the sub-$50 bill of materials target.",
    transcriptPreview:
      "The team agreed the first hardware proof should focus on LOLIN S3 Pro, INMP441 audio, microSD storage, USB transfer, and a simple puck enclosure before Wi-Fi, camera, or mobile companion scope.",
    syncTransferredMb: 83,
    syncVisuals: 0,
    syncAudioHours: 0.7,
    decisions: [
      "Keep the first device offline during recording to avoid cloud or phone dependency.",
      "Use USB transfer as the reliable MVP path before adding Wi-Fi sync.",
      "Treat visual context as optional uploaded attachments, not a required camera feature.",
    ],
    actions: [
      {
        owner: "Hardware",
        label: "Validate LOLIN S3 Pro, INMP441, microSD, PH2.0 LiPo, button, and LED wiring together.",
      },
      {
        owner: "Product",
        label: "Keep the target BOM below $50 and defer speaker diarisation to future scope.",
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
[10:04:00] Sarah (Product): Let's make sure we keep Wi-Fi and camera out of the first prototype.
[10:04:15] John (Hardware): Agreed. Offline recording transferred over USB-C is the MVP focus. Wi-Fi sync and slide capture are deferred to v2.`,
    openingMessage:
      "I loaded the Hardware MVP Review. Ask me about device components, recording constraints, battery goals, USB transfer, or what should stay out of scope for the first SmartPuck prototype.",
  },
  {
    folderName: "AI Processing",
    meetingTitle: "Transcript and Notes Pipeline",
    durationLabel: "35m",
    startedAtLabel: "Yesterday",
    summary:
      "Planning session for the SmartPuck web app pipeline: import audio session files, transcribe the recording, and generate structured notes and action items.",
    transcriptPreview:
      "The app should detect imported session directories, pass audio to speech-to-text, and prompt an LLM for summary, decisions, and action items. Uploaded slides or photos can be optional context later.",
    syncTransferredMb: 52,
    syncVisuals: 0,
    syncAudioHours: 0.6,
    decisions: [
      "Use meeting chat threads as the product surface before the full audio processing pipeline is built.",
      "Ground placeholder answers in the SmartPuck proposal so demos feel realistic.",
      "Keep exports to Markdown, PDF, or clipboard as a later but visible product promise.",
    ],
    actions: [
      {
        owner: "Web",
        label: "Add durable folders and saved chat threads before wiring real transcript jobs.",
      },
      {
        owner: "AI",
        label: "Use Gemini for proposal-aware assistant replies while audio processing is stubbed.",
      },
    ],
    transcriptText: `[14:00:10] Sarah (Product): Let's plan the Web app pipeline. When the puck is plugged in over USB, how does the session data transfer?
[14:00:30] Alex (Frontend): The user plugs in the device, and the browser can read the microSD card directly. We can let the user import the raw 16-bit 16kHz PCM WAV files.
[14:01:15] Elena (AI): Once imported, the backend passes the audio to speech-to-text. We'll use Whisper large-v3-turbo locally or a cloud STT API to generate timestamped transcripts.
[14:02:00] Sarah (Product): After getting the transcript, how do we generate notes?
[14:02:20] Elena (AI): We'll pass the transcript to Gemini with a structured prompt to extract the summary, decisions, and action items.
[14:03:00] Alex (Frontend): In the workspace UI, users will see the folders list in the sidebar and meeting chat threads in the main area.
[14:03:40] Sarah (Product): Excellent. Let's make sure we add Clerk + Convex auth integration before we release the public upload capabilities.
[14:04:10] Alex (Frontend): I'll work on the folders UI and thread listing first, keeping the database schemas clean.`,
    openingMessage:
      "I loaded the Transcript and Notes Pipeline chat. Ask me about transcription, optional context attachments, structured notes, exports, or how the web app should process SmartPuck sessions.",
  },
];

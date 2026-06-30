# SmartPuck: from captured audio to meeting intelligence

Simple 8-slide presentation script (about 6–8 minutes)

## Slide 1 — SmartPuck

**On the slide**

Capture the meeting. Keep the knowledge.

**Speaker script**

“SmartPuck is a local meeting-intelligence system. A small recorder captures the conversation, and our desktop app turns that audio into an organized, searchable workspace that we can read, edit, and chat with.”

---

## Slide 2 — Simple hardware

**On the slide**

Microphone + microSD + one button

- LOLIN S3 Pro
- INMP441 digital microphone
- Removable microSD storage
- Status LED and optional battery

**Speaker script**

“We keep the hardware focused. The recommended build is a LOLIN S3 Pro with an INMP441 microphone and a microSD card. Press once to record and again to stop. It records speech-ready, 16-kilohertz mono WAV audio directly to the card. The puck does not need the cloud to capture a meeting, and it does not waste power trying to run the AI itself.”

---

## Slide 3 — From the puck to the library

**On the slide**

Record → connect → sync

- Automatic discovery through `smartpuck.local`
- Works over normal Wi-Fi or the puck’s own hotspot
- Import one session or all new recordings
- Manual audio and microSD import remain available
- Review device storage and delete transferred sessions

**Speaker script**

“When the meeting ends, SmartPuck Desktop connects to the recorder over Wi-Fi. It can discover the puck by name, list its sessions, show available storage, and import new recordings. The transfer is validated before the device session is marked as uploaded. Users can also import ordinary audio files or a session folder manually, so the app is useful even without the puck nearby.”

---

## Slide 4 — A meeting library, not a pile of audio files

**On the slide**

- Create folders for classes, teams, projects, or clients
- Import, rename, move, archive, and delete recordings
- Play recordings inside the app
- Keep audio, transcript, timestamps, and metadata together
- Prevent duplicate imports using an audio fingerprint

**Speaker script**

“Our first major feature is the meeting library. Instead of leaving users with a folder full of random WAV files, the app organizes recordings into meaningful workspaces. A student might have one folder per subject; a company might use one per client or project. Every recording keeps its source audio, editable transcript, timestamp data, and metadata together. The app also fingerprints the audio to avoid importing the same recording twice.”

---

## Slide 5 — Local transcription with model choices

**On the slide**

Audio → faster-whisper → timestamped transcript

- Auto multilingual profile
- Fast English profile
- Khmer-focused profile
- High-quality Whisper Turbo profile
- GPU acceleration with CPU fallback

**Speaker script**

“The second major feature is local transcription. The desktop app starts a local Python worker powered by faster-whisper, so meeting audio does not have to be uploaded to a hosted transcription service. Users can choose a fast English model, a Khmer-focused model, or a higher-quality Whisper Turbo model. Auto mode detects the language and can reroute Khmer audio to the specialized model. If GPU execution is unavailable, the worker falls back to CPU.”

**Presenter note**

Model downloads may still require internet during initial setup; transcription itself is designed to run locally after the model is available.

---

## Slide 6 — Transcripts users can trust and control

**On the slide**

- Timestamped segments
- Detected language and model recorded
- Quality flags for uncertain output
- Read and edit the transcript
- Preserve the original segment JSON
- Clear states: imported, queued, transcribing, ready, no speech, or error

**Speaker script**

“A transcript is not treated as magic output. We save timestamped segments, the detected language, the model used, and quality indicators such as low language confidence. Users can open and correct the readable transcript while the original timestamp data remains preserved. The interface also clearly shows whether a recording is waiting, transcribing, ready, empty, or failed.”

---

## Slide 7 — Chat with a folder of meetings

**On the slide**

Ask across the meetings that belong together

Examples:

- “What decisions did we make this month?”
- “Find every mention of the launch date.”
- “Compare the client’s requests across these calls.”
- “Turn the latest discussion into action items.”

**Speaker script**

“The third major feature is folder chat. A chat is opened with the selected meeting folder as its working context. The agent can list the recordings, search transcript files, and read only the relevant passages. That means we do not stuff hours of transcript text into every prompt. Users can ask questions across a group of related meetings and still keep each project or client separated.”

---

## Slide 8 — Our product architecture

**On the slide**

Puck → Desktop library → Local transcription → Folder chat

**Speaker script**

“The architecture separates each responsibility. The puck is responsible for reliable audio capture and storage. The Electron desktop app handles device control, transfer, playback, organization, and a local SQLite index. A FastAPI and faster-whisper worker performs transcription on the user’s computer. The resulting audio, Markdown transcript, timestamp JSON, and metadata are normal local files. Finally, the agent works from the selected folder and reads those files as needed. This local-first design gives users ownership of their meeting data and lets us improve each layer independently.”

---

## Closing

**On the slide**

Small recorder. Complete meeting workspace.

**Speaker script**

“What we offer is the complete path after pressing record: reliable capture, automatic sync, a structured meeting library, local multilingual transcription, editable transcripts, and AI chat grounded in the meetings the user chooses. SmartPuck turns simple audio hardware into useful, private meeting memory.”

## Optional live demo order

1. Start and stop a recording from the puck or desktop controls.
2. Show the device connection, session list, and storage status.
3. Import the new session into a project folder.
4. Select a transcription model and show its processing state.
5. Open and edit the timestamped transcript.
6. Start a folder chat and ask for decisions or action items.

## Repo basis for the claims

- `Firmware/README.md`
- `Firmware/SmartPuckFirmware/SmartPuckFirmware.ino`
- `Desktop/src/renderer/src/screens/SmartPuck/SmartPuck.tsx`
- `Desktop/src/main/smartpuck-device.ts`
- `Desktop/src/main/smartpuck-library.ts`
- `Desktop/src/main/smartpuck-transcription.ts`
- `Desktop/resources/smartpuck/transcribe_server.py`
- `Desktop/src/renderer/src/screens/Chat/Chat.tsx`

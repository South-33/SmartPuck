This is the project's AGENTS.md

# AGENTS

## Notes
- Webapp uses Next.js 16 App Router + Convex -> keep `pnpm convex:dev` running while editing backend code -> generated client types drift if the watcher is off.
- Convex backend edits in `Webapp/convex` -> read `Webapp/convex/_generated/ai/guidelines.md` first -> avoids schema/query/auth patterns that Convex rejects.
- Live chat uses Convex Agent component (`@convex-dev/agent`) -> `meetings.agentThreadId` links workspace rows to Agent threads and `useUIMessages` renders streams -> run `pnpm convex:codegen` after component/schema edits.
- Chat attachments are draft-time context only -> text-like files are read in-browser and appended to the Agent prompt, not stored in Convex -> add Convex file storage before promising durable uploads.
- Clerk + Convex auth split envs -> Next.js needs Clerk publishable/secret keys but Convex only needs `CLERK_JWT_ISSUER_DOMAIN` in deployment env -> auth config and `pnpm convex:codegen` fail if the Convex env is missing.
- Gemini chat replies run from Convex actions -> set `GEMINI_API_KEY` and optional `GEMINI_MODEL` in Convex env -> missing key falls back to local proposal context. Gemini throws AI_UnsupportedFunctionalityError if system messages are sent in the middle of a thread; pass context in the prompt instead.
- OV5640 module manual lists optimal image distance 20-250 cm -> keep whiteboard/TV captures within ~0.2-2.5 m or quality drops.
- OV5640 module listings often mislabel USB/UVC in text -> verify DVP pinout (Y2-Y9, PCLK, VSYNC) before purchase to avoid incompatible modules.
- Product direction may pivot audio-first -> treat onboard camera as optional/experimental visual context -> avoids overpromising whiteboard/slide capture on cheap OV5640 hardware.
- Audio-first hardware shortlist favors LOLIN S3 Pro + INMP441 + PH2.0 LiPo -> onboard TF slot and battery port reduce wiring -> firmware is in Firmware/SmartPuckFirmware/ with verified pins.
- Firmware is written for Arduino IDE -> LOLIN S3 Pro uses SD CS=46/SPI and I2S SCK=4, WS=5, SD=6 -> ESP32-CAM uses SD_MMC 1-bit mode and I2S SCK=12, WS=13, SD=3.
- Web portal uses Web Audio API to play raw 16-bit 16kHz PCM chunks from `/stream` to bypass browser buffering latency; use `client.setNoDelay(true)` to disable TCP Nagling.
- Firmware runs a dual-core FreeRTOS layout: Core 1 runs a high-priority task reading I2S and writing to SD (synchronized via `fileMutex`), while Core 0 runs button checking and WiFi Web Server loops.
- Local AI target is a Python/FastAPI worker, not browser JS: faster-whisper + Whisper large-v3-turbo first, pyannote diarization later, then Gemini/local LLM chat over stored transcripts.
- Agent uses tools (listFolderMeetings, searchMeetingTranscripts, readMeetingTranscript) to search meeting transcripts in the database; do not stuff transcripts into system context.


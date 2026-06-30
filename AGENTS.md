This is the project's AGENTS.md

# AGENTS

## Notes
- Audio-first hardware: LOLIN S3 Pro + INMP441 + PH2.0 LiPo -> onboard TF slot and battery port reduce wiring -> firmware in `Firmware/SmartPuckFirmware/` with verified pins.
- Firmware is written for Arduino IDE -> LOLIN S3 Pro uses SD CS=46/SPI and I2S SCK=4, WS=5, SD=6 -> ESP32-CAM uses SD_MMC 1-bit mode and I2S SCK=12, WS=13, SD=3.
- Web portal uses Web Audio API to play raw 16-bit 16kHz PCM chunks from `/stream` to bypass browser buffering latency; use `client.setNoDelay(true)` to disable TCP Nagling.
- Firmware runs a dual-core FreeRTOS layout: Core 1 runs a high-priority task reading I2S and writing to SD (synchronized via `fileMutex`), while Core 0 runs button checking and WiFi Web Server loops.
- Desktop is filesystem-first: `Meetings/` stores each canonical meeting once; `Workspaces/` are playlist-like views via stable JSON ids, so renames/relinks never copy raw evidence.
- Agent integration is workspace-native, not chat/MCP: the library generates `AGENTS.md`, `CLAUDE.md`, and SmartPuck skills so Codex and Antigravity can use native `ls`/`rg`/read tools.
- Firmware `/download` must rely on `server.setContentLength()` only -> an extra `Content-Length` header makes Node reject the response; the Desktop app keeps a raw-stream fallback for already-flashed firmware.
- Firmware WAV header recovery must open existing audio with `"r+"`, never `FILE_WRITE`; ESP32 `FILE_WRITE` truncates a valid recording to its 44-byte header on reboot.
- Firmware advertises its HTTP service as `smartpuck.local` with mDNS -> the Desktop app tries that hostname before saved/AP addresses so DHCP changes do not break automatic sync.
- Bilingual auto-transcription batches encoder-only language ID for pause-bounded islands -> English uses `small.en`, non-English/uncertain uses the Khmer specialist in GPU batches -> do not compare cross-model confidence or normalize mixed speech by default.
- The focused Electron app owns library/device orchestration and launches the proven bilingual Python transcription service; do not reintroduce Hermes gateway, provider, OAuth, or embedded chat features.

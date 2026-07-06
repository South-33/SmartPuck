# SmartPuck

SmartPuck is a portable, audio-first meeting recorder with private local transcription and an agent-readable desktop library. Record away from your computer, sync later over USB-C or Wi-Fi, then open the generated workspace in Codex, Antigravity, or another filesystem-capable agent.

## What it does

- Records meetings to microSD from dedicated ESP32-S3 hardware.
- Connects after launch over USB-C, `smartpuck.local`, or a saved network address.
- Imports recordings into a local filesystem-first meeting library.
- Transcribes English, Khmer, and mixed English-Khmer speech locally.
- Preserves timestamped transcripts alongside the original audio.
- Generates `AGENTS.md`, `CLAUDE.md`, SmartPuck skills, `NEW.md`, and workspace indexes so external agents can search and organize meetings without loading every transcript.

Audio and transcripts remain local. Agent access happens through the files you choose to open in an agent harness.

## Typical workflow

1. Start recording from the SmartPuck hardware or the desktop controls.
2. Stop the recording when the meeting ends.
3. Connect the SmartPuck to the desktop app over USB-C or Wi-Fi.
4. Import the session and queue transcription.
5. Review or edit the timestamped transcript.
6. Open the SmartPuck workspace folder in Codex or another agent harness to summarize, rename, organize, or answer questions across meetings.

The desktop app shows real transcription milestones. Recordings are processed sequentially so multiple jobs do not compete for GPU memory.

## Run the desktop app from source

Requirements:

- Windows with Node.js and pnpm
- Python 3.11
- FFmpeg available on `PATH`
- An NVIDIA GPU is recommended for fast transcription

```powershell
cd Desktop
pnpm install
pnpm dev
```

The local speech worker dependencies are installed in `Desktop/.venv-stt`. The app can use a custom Python executable through `SMARTPUCK_PYTHON`.

### VRAM & Hardware Optimization on Windows
To guarantee fast transcription speeds on Windows laptops running other GPU-heavy background applications (Chrome, Discord, games), the STT service:
- Runs **Whisper ASR** on the GPU (`float16`) for blazing fast transcription (~18 seconds for a 9-minute file).
- Offloads **DeepFilterNet** denoising to the CPU. This saves ~1.5 GB of VRAM, completely avoiding slow WDDM memory paging to system RAM and reducing total processing time by over 2x.

## Hardware

The current reference build uses a LOLIN S3 Pro, an INMP441 I2S microphone, microSD storage, and a PH2.0 LiPo battery connection. Firmware and verified pin assignments live in `Firmware/SmartPuckFirmware/`.

See [`docs/hardware/`](docs/hardware/) for build notes and component documentation.

## Repository layout

- `Desktop/` - Electron desktop application and packaged transcription worker.
- `Firmware/` - Arduino firmware for SmartPuck hardware.
- `docs/hardware/` - hardware notes and component manuals.
- `docs/product/` - product proposals.
- `docs/presentations/` - presentation material.

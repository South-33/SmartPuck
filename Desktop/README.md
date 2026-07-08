# SmartPuck Desktop V1

A small local-first desktop app for connecting a SmartPuck, importing recordings, transcribing them locally, and organizing an agent-readable meeting workspace.

## Product boundary

- Automatic USB-C or mDNS/Wi-Fi device discovery, recording controls, idempotent sync, and storage state
- Live low-latency monitoring, device-session rename/delete, saved Wi-Fi management, and fallback-AP recovery
- Workspace and meeting organization using plain directories, playlist-like links, search, playback, assignment, and editable transcripts
- The proven SmartPuck bilingual pipeline: normalization, adaptive/on-demand denoise, pause-aware English/Khmer routing, quality flags, and GPU fallback
- Editable Markdown transcripts and preserved raw timestamp segments
- Preserved original audio plus the pipeline-selected processed review waveform
- Generated `AGENTS.md`, `CLAUDE.md`, and SmartPuck skills
- Generated `NEW.md` orientation index backed by canonical `meeting.json` curation state

There is intentionally no embedded AI chat, model provider, OAuth flow, MCP server, or Hermes runtime.

## Transcription performance defaults

- Desktop transcription requests `denoise_mode: auto`; clean audio skips DeepFilterNet and only pays the denoise cost when confidence/routing says it is useful.
- Speaker diarization is always requested so production agents get speaker context. It is CPU-heavy on long recordings, so the ONNX diarizer uses up to `SMARTPUCK_DIARIZATION_THREADS` threads, defaulting to a conservative CPU-aware value, and ignores implausibly high speaker counts.
- Mixed-language reference evidence passes are capped for long recordings to avoid doubling work on meeting-length audio.

## Generated agent tooling

SmartPuck generates one workspace CLI at `.agents/manage-library.js`. It is only for structural library changes: curation metadata, workspace create/rename/delete, linking/unlinking, trashing meetings, and rebuilding generated indexes. Agents should edit `transcript.md` and workspace memory notes directly instead of using a tool for normal Markdown cleanup.

## Development

```powershell
pnpm install
python -m pip install -r resources/requirements.txt
pnpm dev
```

Set `SMARTPUCK_HOME` to use a disposable meeting library and `SMARTPUCK_PYTHON` when Python is not available on PATH.

## Verification

```powershell
pnpm test
pnpm build
$env:SMARTPUCK_E2E_AUDIO = "C:\path\to\a\recording.mp3"
node scripts/e2e-foundation.cjs
```

The native E2E run uses an isolated library under the system temp directory and removes it, including its copied audio, when the run finishes. Set `SMARTPUCK_KEEP_E2E=1` only when the temporary workspace is needed for debugging.

## Workspace shape

```text
SmartPuck/
  AGENTS.md
  CLAUDE.md
  SMARTPUCK.md
  NEW.md
  Meetings/
    meeting-title-1234abcd/
      meeting.json
      audio.wav
      recording.processed.wav
      transcript.md
      transcript.segments.json
  Workspaces/
    workspace-name/
      .smartpuck-workspace.json
      meetings.md
  Trash/
```

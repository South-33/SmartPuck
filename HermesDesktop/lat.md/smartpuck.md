# SmartPuck

SmartPuck turns Hermes Desktop into a local meeting library backed by profile-owned folders that the existing Hermes agent can inspect like normal project files.

Audio imported from a device or loose files is copied under the active Hermes home alongside transcript and metadata files, keeping the heavy transcription/model work local instead of web-hosted.

The main-process library in [[src/main/smartpuck-library.ts]] owns the folder layout and SQLite index. Each meeting folder has a real directory, a `.smartpuck-folder.json` marker, and one subdirectory per recording containing `audio.*`, `transcript.md`, `transcript.segments.json`, and `metadata.json`.

The renderer screen in [[src/renderer/src/screens/SmartPuck/SmartPuck.tsx]] is the front door for creating folders and importing recordings. It launches folder-scoped chat by creating a Hermes chat run with an initial context folder instead of creating a separate SmartPuck-only agent stack.

`ChatRun.initialContextFolder` in [[src/renderer/src/screens/Layout/chatRuns.ts]] is the bridge between SmartPuck and existing chat transport. The folder path is passed into [[src/renderer/src/screens/Chat/Chat.tsx]], persisted once a session exists, and later sent to the dashboard/agent transport as the working directory.

Transcription is intentionally represented as local files and status now, not a web-hosted model. A later local worker should fill `transcript.md` and segment JSON in place so the agent can search/read the relevant files lazily instead of stuffing hours of transcript text into a prompt.

Queueing transcription writes `transcription.request.json` beside the recording and updates the indexed model/status. The first worker target is faster-whisper with `large-v3-turbo`; the request file is the stable handoff boundary so model execution can be added without moving meeting data into the renderer or cloud.

[[src/main/smartpuck-device.ts]] connects to the firmware's existing HTTP API for status, session listing, audio download, and upload marking. Device audio streams to a temporary file with byte-count validation before entering the normal library import path; upload marking happens only after the local copy and index update succeed.

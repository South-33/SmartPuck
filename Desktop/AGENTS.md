This is the project's AGENTS.md

# SmartPuck Desktop

- Filesystem is authoritative: `Meetings/` contains canonical meeting folders once, while `Workspaces/` are playlist-like views generated from meeting metadata.
- Stable ids live in JSON metadata, while directory names and transcript Markdown are user/agent editable.
- Original audio and `transcript.segments.json` are evidence files and must not be modified by agents.
- The active product is a focused Electron manager plus the proven local bilingual transcription service; do not add chat, model-provider, OAuth, or Hermes runtime features.

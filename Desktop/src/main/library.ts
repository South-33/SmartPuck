import { randomUUID } from "crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, extname, join, relative } from "path";
import { app } from "electron";
import type {
  LibrarySnapshot,
  Meeting,
  MeetingMetadata,
  Workplace,
  WorkplaceMetadata,
} from "../shared/types";

const WORKSPACE_INSTRUCTIONS = `# SmartPuck Assistant

## Who You Are
You are a personal assistant for this meeting library. The user records meetings and conversations with a SmartPuck device and imports them here. Your job is to help them get value from those recordings — curating new imports, understanding what was discussed, finding things, editing transcripts, and keeping the library organized.

You have internal tools for doing this work (a CLI script, index files, JSON manifests). Use them silently. The user never needs to know about file names, IDs, or commands — speak to them entirely in human terms: meeting titles, topics, workspace names, dates. In particular, never say file names like "NEW.md" or "meeting.json" out loud. If you need to reference pending imports, say "your inbox" or "new recordings".

Never paste raw file contents or technical output into your responses. Read files to understand state, then summarize in plain language.

## When the Conversation Starts
If the user says something like "start", "hello", or opens a fresh conversation: check the inbox for any new recordings that need curating. If there are pending recordings, take care of them — curate, summarize, link to a workspace — then let the user know in plain language what you did. If the inbox is clear, greet the user briefly, give a one-sentence summary of the library state, and ask what they need help with.



## 2. Command Reference Cheat Sheet
The library root contains \`node .agents/manage-library.js\`. Use this script for **all** structural modifications. Never edit JSON files or move directories manually.

| Action | Command Example | When to use it |
| :--- | :--- | :--- |
| **Curate & Link** | \`node .agents/manage-library.js curate <meeting-id> --title "My Title" --summary "Brief summary" --workspaces "IELTS Study"\` | Finalize title, summary, and workspace categories for a pending meeting. |
| **Create Workspace** | \`node .agents/manage-library.js create-workspace "Khmer Language"\` | Categorize meetings under a new workspace. |
| **Link Meeting** | \`node .agents/manage-library.js link <meeting-id> "Khmer Language"\` | Link an already-curated meeting to an additional workspace. |
| **Safely Delete Workspace**| \`node .agents/manage-library.js delete-workspace "Khmer Language"\` | Safely remove a workspace. *Never use raw shell delete/remove commands.* |
| **Rename Workspace** | \`node .agents/manage-library.js rename-workspace "Khmer Language" "Khmer Study"\` | Rename a workspace folder and manifest in sync. |
| **Trash Meeting** | \`node .agents/manage-library.js trash <meeting-id>\` | Move a meeting folder safely to Trash and rebuild indexes. |
| **Rebuild Indexes** | \`node .agents/manage-library.js rebuild\` | Force rebuild NEW.md and workspace meetings.md files. |

## 3. Playbook Rules (How to avoid mistakes)
- The SmartPuck library root is the directory containing the Meetings/ and Workspaces/ folders (usually two levels up from the active workspace directory). Go directly to the library root; never list or crawl directory levels above the library root (which is out of scope and slow).
- Always keep canonical meeting folders under Meetings/. To link a meeting to a workspace, only append the workspace ID to meeting.json.workspaceIds. Never physically move folders from Meetings/ to Workspaces/ (which is a legacy layout).
- Follow a strict curation order: check the inbox first to locate pending meetings, update their metadata, and let the app auto-generate workspace index files.
- Never use shell commands (like 'rm', 'rmdir', or 'Remove-Item') to delete library folders or files (which destroys user data, transcripts, and custom memory notes in meetings.md). If a file/folder already exists or a conflict arises, reuse the existing resource or ask the user for confirmation.
- **Editing Transcripts**: You are fully authorized and expected to edit the \`transcript.md\` file inside any meeting folder directly to clean up transcription mistakes, fix speaker labels/tags (diarization), remove promotional text/ads, and improve readability. You do not need to run any CLI commands or scripts to edit the transcript text itself — just edit the file directly using your file editing tools.
- Transcripts are UTF-8. If a legacy Windows terminal renders Khmer as garbled characters, read with an UTF-8-aware file tool (for PowerShell, Get-Content -Encoding UTF8); do not "repair" valid transcript bytes based on terminal display.
- **Low-confidence alternatives**: When a transcript line is followed by \`Alternatives:\`, treat those alternatives as raw ASR evidence, not final transcript text. During cleanup, compare the main line and alternatives against surrounding context, pick or rewrite the most likely spoken words, preserve the correct language/script, and delete the \`Alternatives:\` line from the cleaned transcript. Do not leave multiple guesses in curated output unless the user explicitly asks for forensic uncertainty.
- **ASR Evidence sections**: \`## ASR Evidence\` contains full-pass fallback transcripts for noisy or low-confidence audio. Use it to repair missing/garbled transcript spans, then remove the evidence section from curated output unless the user asks to keep forensic notes.

## 4. SmartPuck Workspace & JSON Schema Reference
- Meetings/ contains every canonical meeting folder exactly once: metadata, original audio, processed audio, transcript.md, and immutable transcript.segments.json.
- Workspaces/ contains playlist-like workspace folders. Each meetings.md is a generated view and may be overwritten by the app.
- Trash/ contains recoverable meetings removed from the active library. Ignore it unless asked.
- The inbox is a pending-work index. Curated means a meeting has a title and summary; it may remain in the inbox if placement is ambiguous.

### JSON Manifests

#### Workspace Manifest (\`Workspaces/<slug>/.smartpuck-workspace.json\`)
\`\`\`json
{
  "schemaVersion": 1,
  "id": "<UUID-v4>",
  "name": "<Workspace Display Name>",
  "sortOrder": <integer>,
  "createdAt": "<ISO-8601-timestamp>",
  "updatedAt": "<ISO-8601-timestamp>"
}
\`\`\`

#### Meeting Metadata (\`Meetings/<meeting-id>/meeting.json\`)
\`\`\`json
{
  "schemaVersion": 1,
  "id": "<UUID-v4>",
  "title": "<Curation Title>",
  "status": "pending" | "processing" | "ready" | "error",
  "curationStatus": "pending" | "curated",
  "workspaceIds": ["<workspace-id>"],
  "capturedAt": "<ISO-8601-timestamp>",
  "updatedAt": "<ISO-8601-timestamp>",
  "audioFile": "recording.wav",
  "processedAudioFile": "recording.processed.wav",
  "durationSeconds": <number-or-null>,
  "error": "<error-message-or-null>"
}
\`\`\`
`;

const CLAUDE_INSTRUCTIONS = `@AGENTS.md
`;

const SKILL = `---
name: smartpuck-meetings
description: Search, analyze, summarize, clean, rename, and organize meetings in a SmartPuck transcript workspace.
---

# SmartPuck Assistant

## Who You Are
You are a personal assistant for this meeting library. The user records meetings and conversations with a SmartPuck device and imports them here. Your job is to help them get value from those recordings — curating new imports, understanding what was discussed, finding things, editing transcripts, and keeping the library organized.

You have internal tools for doing this work (a CLI script, index files, JSON manifests). Use them silently. The user never needs to know about file names, IDs, or commands — speak to them entirely in human terms: meeting titles, topics, workspace names, dates. In particular, never say file names like "NEW.md" or "meeting.json" out loud. If you need to reference pending imports, say "your inbox" or "new recordings".

Never paste raw file contents or technical output into your responses. Read files to understand state, then summarize in plain language.

## When the Conversation Starts
If the user says something like "start", "hello", or opens a fresh conversation: check the inbox for any new recordings that need curating. If there are pending recordings, take care of them — curate, summarize, link to a workspace — then let the user know in plain language what you did. If the inbox is clear, greet the user briefly, give a one-sentence summary of the library state, and ask what they need help with.



## 2. Command Reference Cheat Sheet
The library root contains \`node .agents/manage-library.js\`. Use this script for **all** structural modifications. Never edit JSON files or move directories manually.

| Action | Command Example | When to use it |
| :--- | :--- | :--- |
| **Curate & Link** | \`node .agents/manage-library.js curate <meeting-id> --title "My Title" --summary "Brief summary" --workspaces "IELTS Study"\` | Finalize title, summary, and workspace categories for a pending meeting. |
| **Create Workspace** | \`node .agents/manage-library.js create-workspace "Khmer Language"\` | Categorize meetings under a new workspace. |
| **Link Meeting** | \`node .agents/manage-library.js link <meeting-id> "Khmer Language"\` | Link an already-curated meeting to an additional workspace. |
| **Safely Delete Workspace**| \`node .agents/manage-library.js delete-workspace "Khmer Language"\` | Safely remove a workspace. *Never use raw shell delete/remove commands.* |
| **Rename Workspace** | \`node .agents/manage-library.js rename-workspace "Khmer Language" "Khmer Study"\` | Rename a workspace folder and manifest in sync. |
| **Trash Meeting** | \`node .agents/manage-library.js trash <meeting-id>\` | Move a meeting folder safely to Trash and rebuild indexes. |
| **Rebuild Indexes** | \`node .agents/manage-library.js rebuild\` | Force rebuild NEW.md and workspace meetings.md files. |

## 3. Playbook Rules (How to avoid mistakes)
- The SmartPuck library root is the directory containing the Meetings/ and Workspaces/ folders (usually two levels up from the active workspace directory). Go directly to the library root; never list or crawl directory levels above the library root (which is out of scope and slow).
- Always keep canonical meeting folders under Meetings/. To link a meeting to a workspace, only append the workspace ID to meeting.json.workspaceIds. Never physically move folders from Meetings/ to Workspaces/ (which is a legacy layout).
- Follow a strict curation order: check the inbox first to locate pending meetings, update their metadata, and let the app auto-generate workspace index files.
- Never use shell commands (like 'rm', 'rmdir', or 'Remove-Item') to delete library folders or files (which destroys user data, transcripts, and custom memory notes in meetings.md). If a file/folder already exists or a conflict arises, reuse the existing resource or ask the user for confirmation.
- **Editing Transcripts**: You are fully authorized and expected to edit the \`transcript.md\` file inside any meeting folder directly to clean up transcription mistakes, fix speaker labels/tags (diarization), remove promotional text/ads, and improve readability. You do not need to run any CLI commands or scripts to edit the transcript text itself — just edit the file directly using your file editing tools.
- Transcripts are UTF-8. If a legacy Windows terminal renders Khmer as garbled characters, read with an UTF-8-aware file tool (for PowerShell, Get-Content -Encoding UTF8); do not "repair" valid transcript bytes based on terminal display.
- **Low-confidence alternatives**: When a transcript line is followed by \`Alternatives:\`, treat those alternatives as raw ASR evidence, not final transcript text. During cleanup, compare the main line and alternatives against surrounding context, pick or rewrite the most likely spoken words, preserve the correct language/script, and delete the \`Alternatives:\` line from the cleaned transcript. Do not leave multiple guesses in curated output unless the user explicitly asks for forensic uncertainty.
- **ASR Evidence sections**: \`## ASR Evidence\` contains full-pass fallback transcripts for noisy or low-confidence audio. Use it to repair missing/garbled transcript spans, then remove the evidence section from curated output unless the user asks to keep forensic notes.

## 4. SmartPuck Workspace & JSON Schema Reference
- Meetings/ contains every canonical meeting folder exactly once: metadata, original audio, processed audio, transcript.md, and immutable transcript.segments.json.
- Workspaces/ contains playlist-like workspace folders. Each meetings.md is a generated view and may be overwritten by the app.
- Trash/ contains recoverable meetings removed from the active library. Ignore it unless asked.
- The inbox is a pending-work index. Curated means a meeting has a title and summary; it may remain in the inbox if placement is ambiguous.

### JSON Manifests

#### Workspace Manifest (\`Workspaces/<slug>/.smartpuck-workspace.json\`)
\`\`\`json
{
  "schemaVersion": 1,
  "id": "<UUID-v4>",
  "name": "<Workspace Display Name>",
  "sortOrder": <integer>,
  "createdAt": "<ISO-8601-timestamp>",
  "updatedAt": "<ISO-8601-timestamp>"
}
\`\`\`

#### Meeting Metadata (\`Meetings/<meeting-id>/meeting.json\`)
\`\`\`json
{
  "schemaVersion": 1,
  "id": "<UUID-v4>",
  "title": "<Curation Title>",
  "status": "pending" | "processing" | "ready" | "error",
  "curationStatus": "pending" | "curated",
  "workspaceIds": ["<workspace-id>"],
  "capturedAt": "<ISO-8601-timestamp>",
  "updatedAt": "<ISO-8601-timestamp>",
  "audioFile": "recording.wav",
  "processedAudioFile": "recording.processed.wav",
  "durationSeconds": <number-or-null>,
  "error": "<error-message-or-null>"
}
\`\`\`
`;



let rootOverride = "";
const MEETINGS_DIR = "Meetings";
const WORKSPACES_DIR = "Workspaces";

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function writeIfChanged(path: string, content: string): void {
  if (existsSync(path)) return;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function meetingStorePath(root = ensureLibrary()): string {
  return join(root, MEETINGS_DIR);
}

function workspacesPath(root = ensureLibrary()): string {
  return join(root, WORKSPACES_DIR);
}

function isMeetingDirectory(path: string): boolean {
  return existsSync(join(path, "meeting.json"));
}

function upgradeLegacyGeneratedFile(path: string, content: string, legacySignature: string): void {
  if (!existsSync(path)) {
    writeIfChanged(path, content);
    return;
  }
  const existing = readFileSync(path, "utf8");
  if (existing.includes(legacySignature) && existing.trim() !== content.trim()) {
    writeFileSync(path, content, "utf8");
  }
}

export function libraryRoot(): string {
  return rootOverride || process.env.SMARTPUCK_HOME || join(app.getPath("documents"), "SmartPuck");
}

export function setLibraryRoot(path: string): void {
  rootOverride = path;
  ensureLibrary();
}

export function ensureLibrary(): string {
  const root = libraryRoot();
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, MEETINGS_DIR), { recursive: true });
  mkdirSync(join(root, WORKSPACES_DIR), { recursive: true });
  mkdirSync(join(root, "Trash"), { recursive: true });
  
  mkdirSync(join(root, ".agents"), { recursive: true });
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".agents", "manage-library.js"), CLI_MANAGER_CODE, "utf8");
  writeFileSync(join(root, ".claude", "manage-library.js"), CLI_MANAGER_CODE, "utf8");

  const legacyGuidePath = join(root, "SMARTPUCK.md");
  if (existsSync(legacyGuidePath)) {
    try { rmSync(legacyGuidePath, { force: true }); } catch {}
  }

  upgradeLegacyGeneratedFile(join(root, "AGENTS.md"), WORKSPACE_INSTRUCTIONS, "# SmartPuck");
  upgradeLegacyGeneratedFile(join(root, "CLAUDE.md"), CLAUDE_INSTRUCTIONS, "# SmartPuck");
  writeIfChanged(join(root, "NEW.md"), "# Inbox\n\nPending: 0\n\n_Nothing is waiting for curation._\n");
  upgradeLegacyGeneratedFile(join(root, ".agents", "skills", "smartpuck-meetings", "SKILL.md"), SKILL, "name: smartpuck-meetings");
  upgradeLegacyGeneratedFile(join(root, ".claude", "skills", "smartpuck-meetings", "SKILL.md"), SKILL, "name: smartpuck-meetings");
  migrateLegacyWorkspaceOwnedMeetings(root);
  return root;
}

function moveDirectorySafe(source: string, target: string): string {
  let next = target;
  if (existsSync(next)) next = `${target}-${Date.now()}`;
  renameSync(source, next);
  return next;
}

function migrateLegacyWorkspaceOwnedMeetings(root: string): void {
  const meetingsRoot = join(root, MEETINGS_DIR);
  const workspaceRoot = join(root, WORKSPACES_DIR);
  for (const legacyRoot of [join(root, "Inbox")]) {
    if (!existsSync(legacyRoot)) continue;
    for (const entry of readdirSync(legacyRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(legacyRoot, entry.name);
      if (!isMeetingDirectory(path)) continue;
      const meeting = readMeeting(path);
      if (meeting) writeMeeting(meeting);
      moveDirectorySafe(path, join(meetingsRoot, entry.name));
    }
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || [MEETINGS_DIR, WORKSPACES_DIR, "Inbox", "Trash"].includes(entry.name)) continue;
    const source = join(root, entry.name);
    const manifestPath = join(source, ".smartpuck-workspace.json");
    const workspaceMetadata = readJson<WorkplaceMetadata>(manifestPath);
    if (!workspaceMetadata?.id) continue;
    for (const meetingEntry of readdirSync(source, { withFileTypes: true })) {
      if (!meetingEntry.isDirectory() || meetingEntry.name.startsWith(".")) continue;
      const path = join(source, meetingEntry.name);
      if (!isMeetingDirectory(path)) continue;
      const meeting = readMeeting(path);
      if (meeting) {
        meeting.metadata.workspaceIds = [...new Set([...(meeting.metadata.workspaceIds || []), workspaceMetadata.id])];
        writeMeeting(meeting);
      }
      moveDirectorySafe(path, join(meetingsRoot, meetingEntry.name));
    }
    const target = join(workspaceRoot, entry.name);
    if (!existsSync(target)) renameSync(source, target);
  }
}

function displayNameFromFolder(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase()) || "Untitled workspace";
}

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

function readMeeting(path: string): Meeting | null {
  const metadata = readJson<MeetingMetadata>(join(path, "meeting.json"));
  if (!metadata?.id) return null;
  const legacyMetadata = metadata as MeetingMetadata & { workplaceId?: string; linkedWorkplaceIds?: string[] };
  metadata.curationStatus ||= "pending";
  const legacyWorkspaceIds = [
    legacyMetadata.workplaceId,
    ...(legacyMetadata.linkedWorkplaceIds || []),
  ].filter((id): id is string => !!id && id !== "inbox");
  metadata.workspaceIds = [...new Set([...(metadata.workspaceIds || []), ...legacyWorkspaceIds])];
  delete legacyMetadata.workplaceId;
  delete legacyMetadata.linkedWorkplaceIds;
  const transcriptPath = join(path, "transcript.md");
  const primaryAudioPath = join(path, metadata.audioFile);
  const processedAudioPath = metadata.processedAudioFile ? join(path, metadata.processedAudioFile) : "";
  return {
    path,
    metadata,
    transcript: existsSync(transcriptPath) ? readFileSync(transcriptPath, "utf8") : "",
    audioAvailable: existsSync(primaryAudioPath) || (!!processedAudioPath && existsSync(processedAudioPath)),
  };
}

function meetingDirs(path: string): Meeting[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => readMeeting(join(path, entry.name)))
    .filter((meeting): meeting is Meeting => !!meeting)
    .sort((a, b) => b.metadata.capturedAt.localeCompare(a.metadata.capturedAt));
}

function allCanonicalMeetings(root = ensureLibrary()): Meeting[] {
  return meetingDirs(join(root, MEETINGS_DIR));
}

function readPhysicalWorkplaces(root = ensureLibrary()): Workplace[] {
  const workspaceRoot = join(root, WORKSPACES_DIR);
  if (!existsSync(workspaceRoot)) return [];
  const now = new Date().toISOString();
  return readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry): Workplace | null => {
      const path = join(workspaceRoot, entry.name);
      const manifestPath = join(path, ".smartpuck-workspace.json");
      let metadata = readJson<WorkplaceMetadata>(manifestPath);
      if (!metadata?.id) {
        metadata = {
          schemaVersion: 1,
          id: randomUUID(),
          name: displayNameFromFolder(entry.name),
          createdAt: now,
          updatedAt: now,
        };
        writeFileSync(manifestPath, JSON.stringify(metadata, null, 2));
      }
      return metadata ? { path, metadata, meetings: [] } : null;
    })
    .filter((workplace): workplace is Workplace => !!workplace)
    .sort((a, b) => {
      const left = a.metadata.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const right = b.metadata.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return left - right || a.metadata.createdAt.localeCompare(b.metadata.createdAt) || a.metadata.name.localeCompare(b.metadata.name);
    });
}

function reconcileAgentFilesystemEdits(root: string): void {
  const meetingsRoot = meetingStorePath(root);
  const workplaces = readPhysicalWorkplaces(root);
  for (const workplace of workplaces) {
    for (const entry of readdirSync(workplace.path, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const path = join(workplace.path, entry.name);
      if (!isMeetingDirectory(path)) continue;
      const meeting = readMeeting(path);
      if (!meeting) continue;
      meeting.metadata.workspaceIds = [...new Set([...(meeting.metadata.workspaceIds || []), workplace.metadata.id])];
      writeMeeting(meeting);
      moveDirectorySafe(path, join(meetingsRoot, entry.name));
    }
  }
}

function writeWorkplace(workplace: Workplace): void {
  workplace.metadata.updatedAt = new Date().toISOString();
  writeFileSync(join(workplace.path, ".smartpuck-workspace.json"), JSON.stringify(workplace.metadata, null, 2));
}

function writeWorkspaceIndexes(workplaces: Workplace[]): void {
  for (const workplace of workplaces) {
    const meetingsPath = join(workplace.path, "meetings.md");
    let customNotes = "";
    
    if (existsSync(meetingsPath)) {
      const currentContent = readFileSync(meetingsPath, "utf8");
      const dividerIndex = currentContent.indexOf("## Linked Meetings");
      if (dividerIndex !== -1) {
        let rawNotes = currentContent.substring(0, dividerIndex).trim();
        while (rawNotes.endsWith("---")) {
          rawNotes = rawNotes.substring(0, rawNotes.length - 3).trim();
        }
        customNotes = rawNotes + "\n\n";
      } else {
        customNotes = currentContent.trim() + "\n\n";
      }
    } else {
      customNotes = `# ${workplace.metadata.name}\n\n## Memory & Notes\nUse this section to store workspace-specific jargon, names, and memory. AI agents will read this to get context.\n\n`;
    }

    const indexLines = [
      "## Linked Meetings",
      "This section is automatically updated by SmartPuck. Do not edit manually.",
      "",
    ];

    if (workplace.meetings.length === 0) {
      indexLines.push("_No meetings linked yet._", "");
    } else {
      for (const meeting of workplace.meetings) {
        const transcript = relative(workplace.path, join(meeting.path, "transcript.md")).replaceAll("\\", "/");
        const metadata = relative(workplace.path, join(meeting.path, "meeting.json")).replaceAll("\\", "/");
        indexLines.push(`- [${meeting.metadata.title}](${transcript}) — [metadata](${metadata})`);
      }
      indexLines.push("");
    }

    // Clean up legacy files
    const oldReadme = join(workplace.path, "README.md");
    if (existsSync(oldReadme)) {
      try { rmSync(oldReadme); } catch {}
    }
    const oldMemoryMd = join(workplace.path, "memory.md");
    if (existsSync(oldMemoryMd)) {
      try { rmSync(oldMemoryMd); } catch {}
    }

    const finalContent = customNotes.trim() + "\n\n---\n\n" + indexLines.join("\n") + "\n";
    writeFileSync(meetingsPath, finalContent, "utf8");
  }
}

function writeNewIndex(root: string, meetings: Meeting[]): void {
  const unique = [...new Map(meetings.map((meeting) => [meeting.metadata.id, meeting])).values()];
  const pending = unique.filter((meeting) => meeting.metadata.curationStatus === "pending");
  const lines = [
    "# New SmartPuck meetings",
    "",
    "This is a disposable index generated from canonical `meeting.json` metadata. Curate ready meetings, then set `curationStatus` to `curated` and remove their entries here. SmartPuck rebuilds this file whenever it scans the library.",
    "",
    `Pending: ${pending.length}`,
    "",
  ];
  if (pending.length === 0) {
    lines.push("_Nothing is waiting for curation._", "");
  } else {
    for (const meeting of pending) {
      const metadataPath = relative(root, join(meeting.path, "meeting.json")).replaceAll("\\", "/");
      lines.push(
        `- [${meeting.metadata.title}](${metadataPath}) — ${meeting.metadata.status}; captured ${meeting.metadata.capturedAt}`,
      );
    }
    lines.push("");
  }
  writeFileSync(join(root, "NEW.md"), `${lines.join("\n")}\n`, "utf8");
}

export function snapshot(): LibrarySnapshot {
  const root = ensureLibrary();
  reconcileAgentFilesystemEdits(root);
  const physicalWorkplaces = readPhysicalWorkplaces(root);
  const canonicalMeetings = allCanonicalMeetings(root);
  const linkedIds = new Set(physicalWorkplaces.map((workplace) => workplace.metadata.id));
  for (const meeting of canonicalMeetings) {
    const nextWorkspaceIds = meeting.metadata.workspaceIds.filter((id) => linkedIds.has(id));
    if (nextWorkspaceIds.length !== meeting.metadata.workspaceIds.length) {
      meeting.metadata.workspaceIds = nextWorkspaceIds;
      writeMeeting(meeting);
    }
  }
  const inbox = canonicalMeetings.filter((meeting) => !meeting.metadata.workspaceIds.some((id) => linkedIds.has(id)));
  const workplaces = physicalWorkplaces.map((workplace) => {
    const linked = canonicalMeetings.filter((meeting) =>
      meeting.metadata.workspaceIds.includes(workplace.metadata.id),
    );
    const meetings = [...new Map(linked.map((meeting) => [meeting.metadata.id, meeting])).values()]
      .sort((a, b) => b.metadata.capturedAt.localeCompare(a.metadata.capturedAt));
    return { ...workplace, meetings };
  });
  writeWorkspaceIndexes(workplaces);
  writeNewIndex(root, canonicalMeetings);
  return { rootPath: root, workplaces, inbox };
}

export function createWorkplace(name: string): LibrarySnapshot {
  const clean = name.trim();
  if (!clean) throw new Error("Workspace name is required.");
  const now = new Date().toISOString();
  const path = join(workspacesPath(), slug(clean));
  if (existsSync(path) && existsSync(join(path, ".smartpuck-workspace.json"))) throw new Error("A workspace with that name already exists.");
  mkdirSync(path, { recursive: true });
  const nextSortOrder = readPhysicalWorkplaces()
    .reduce((max, workplace) => Math.max(max, workplace.metadata.sortOrder ?? -1), -1) + 1;
  const metadata: WorkplaceMetadata = {
    schemaVersion: 1, id: randomUUID(), name: clean, sortOrder: nextSortOrder, createdAt: now, updatedAt: now,
  };
  writeFileSync(join(path, ".smartpuck-workspace.json"), JSON.stringify(metadata, null, 2));
  return snapshot();
}

function findPhysicalWorkplace(id: string): Workplace {
  const workplace = readPhysicalWorkplaces().find((item) => item.metadata.id === id);
  if (!workplace) throw new Error("Workspace not found.");
  return workplace;
}

export function renameWorkplace(id: string, name: string): LibrarySnapshot {
  const clean = name.trim();
  if (!clean) throw new Error("Workspace name is required.");
  const workplace = findPhysicalWorkplace(id);
  workplace.metadata.name = clean;
  writeWorkplace(workplace);
  const next = join(join(workplace.path, ".."), slug(clean));
  if (next !== workplace.path) {
    if (existsSync(next)) throw new Error("A workspace with that folder name already exists.");
    renameSync(workplace.path, next);
  }
  return snapshot();
}

export function reorderWorkplaces(ids: string[]): LibrarySnapshot {
  const order = new Map(ids.map((id, index) => [id, index]));
  for (const workplace of readPhysicalWorkplaces()) {
    const next = order.get(workplace.metadata.id);
    if (next === undefined) continue;
    workplace.metadata.sortOrder = next;
    writeWorkplace(workplace);
  }
  return snapshot();
}

function findMeeting(id: string): Meeting {
  const meeting = allCanonicalMeetings().find((item) => item.metadata.id === id);
  if (!meeting) throw new Error("Meeting not found.");
  return meeting;
}

function workplacePath(id?: string): { id: string; path?: string } {
  if (!id) return { id: "inbox" };
  const workplace = snapshot().workplaces.find((item) => item.metadata.id === id);
  if (!workplace) throw new Error("Workspace not found.");
  return { id: workplace.metadata.id, path: workplace.path };
}

export function importAudio(paths: string[], workplaceId?: string, sourceDevicePath?: string): LibrarySnapshot {
  const target = workplacePath(workplaceId);
  for (const source of paths) {
    if (!existsSync(source) || !statSync(source).isFile()) continue;
    const id = randomUUID();
    const title = basename(source, extname(source));
    const meetingPath = join(meetingStorePath(), `${slug(title)}-${id.slice(0, 8)}`);
    mkdirSync(meetingPath, { recursive: true });
    const audioFile = `audio${extname(source).toLowerCase() || ".wav"}`;
    copyFileSync(source, join(meetingPath, audioFile));
    const now = new Date().toISOString();
    const sourceStat = statSync(source);
    const metadata: MeetingMetadata = {
      schemaVersion: 1, id, title, workspaceIds: target.id === "inbox" ? [] : [target.id], sourceFileName: basename(source), sourceDevicePath,
      audioFile, status: "queued", progressPercent: 0, curationStatus: "pending",
      capturedAt: sourceStat.mtime.toISOString(), updatedAt: now,
    };
    writeFileSync(join(meetingPath, "meeting.json"), JSON.stringify(metadata, null, 2));
    writeFileSync(join(meetingPath, "transcript.md"), `# ${title}\n\n## Summary\n\n_Not generated yet._\n\n## Transcript\n\n_Not transcribed yet._\n`);
  }
  return snapshot();
}

function writeMeeting(meeting: Meeting): void {
  const metadata = meeting.metadata as MeetingMetadata & { workplaceId?: string; linkedWorkplaceIds?: string[] };
  meeting.metadata.updatedAt = new Date().toISOString();
  meeting.metadata.workspaceIds = [...new Set(meeting.metadata.workspaceIds || [])].filter(Boolean);
  delete metadata.workplaceId;
  delete metadata.linkedWorkplaceIds;
  writeFileSync(join(meeting.path, "meeting.json"), JSON.stringify(meeting.metadata, null, 2));
}

export function renameMeeting(id: string, title: string): LibrarySnapshot {
  const meeting = findMeeting(id);
  const clean = title.trim();
  if (!clean) throw new Error("Meeting title is required.");
  meeting.metadata.title = clean;
  const transcriptPath = join(meeting.path, "transcript.md");
  if (existsSync(transcriptPath)) {
    const transcript = readFileSync(transcriptPath, "utf8");
    const aligned = transcript.match(/^# .*(\r?\n|$)/)
      ? transcript.replace(/^# .*(\r?\n|$)/, (_match, newline: string) => `# ${clean}${newline}`)
      : `# ${clean}\n\n${transcript}`;
    writeFileSync(transcriptPath, aligned, "utf8");
  }
  writeMeeting(meeting);
  const next = join(join(meeting.path, ".."), `${slug(clean)}-${id.slice(0, 8)}`);
  if (next !== meeting.path && !existsSync(next)) renameSync(meeting.path, next);
  return snapshot();
}

export function moveMeeting(id: string, workplaceId?: string): LibrarySnapshot {
  const meeting = findMeeting(id);
  const target = workplacePath(workplaceId);
  meeting.metadata.workspaceIds = target.id === "inbox" ? [] : [target.id];
  writeMeeting(meeting);
  return snapshot();
}

export function addMeetingToWorkplace(meetingId: string, workplaceId: string): LibrarySnapshot {
  const meeting = findMeeting(meetingId);
  const target = workplacePath(workplaceId);
  const links = new Set(meeting.metadata.workspaceIds || []);
  links.add(target.id);
  meeting.metadata.workspaceIds = [...links];
  writeMeeting(meeting);
  return snapshot();
}

export function removeMeetingFromWorkplace(meetingId: string, workplaceId: string): LibrarySnapshot {
  const meeting = findMeeting(meetingId);
  meeting.metadata.workspaceIds = (meeting.metadata.workspaceIds || []).filter((id) => id !== workplaceId);
  writeMeeting(meeting);
  return snapshot();
}

export function deleteMeeting(id: string): LibrarySnapshot {
  const meeting = findMeeting(id);
  const trash = join(ensureLibrary(), "Trash");
  mkdirSync(trash, { recursive: true });
  let target = join(trash, basename(meeting.path));
  if (existsSync(target)) target = join(trash, `${basename(meeting.path)}-${Date.now()}`);
  renameSync(meeting.path, target);
  return snapshot();
}

export function deleteWorkplace(id: string): LibrarySnapshot {
  const workplace = findPhysicalWorkplace(id);
  for (const meeting of allCanonicalMeetings()) {
    meeting.metadata.workspaceIds = (meeting.metadata.workspaceIds || []).filter((linkedId) => linkedId !== id);
    writeMeeting(meeting);
  }
  rmSync(workplace.path, { recursive: true, force: true });
  return snapshot();
}

export function saveTranscript(id: string, transcript: string): LibrarySnapshot {
  const meeting = findMeeting(id);
  writeFileSync(join(meeting.path, "transcript.md"), transcript, "utf8");
  writeMeeting(meeting);
  return snapshot();
}

export function meetingById(id: string): Meeting { return findMeeting(id); }
export function hasImportedDeviceSession(sourceDevicePath: string): boolean {
  return [...allCanonicalMeetings(), ...meetingDirs(join(ensureLibrary(), "Trash"))]
    .some((meeting) => meeting.metadata.sourceDevicePath === sourceDevicePath && meeting.audioAvailable);
}
export function updateMeetingMetadata(id: string, update: Partial<MeetingMetadata>): void {
  const meeting = findMeeting(id);
  meeting.metadata = { ...meeting.metadata, ...update, id: meeting.metadata.id, schemaVersion: 1 };
  writeMeeting(meeting);
}

export const CLI_MANAGER_CODE = `const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const MEETINGS_DIR = "Meetings";
const WORKSPACES_DIR = "Workspaces";

function getLibraryRoot() {
  return process.env.SMARTPUCK_HOME || path.join(os.homedir(), "Documents", "SmartPuck");
}

function slug(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}]+/gu, "-")
    .replace(/^-+|-+\$/g, "")
    .slice(0, 80) || "untitled";
}

function loadLibrary(root) {
  const meetingsDir = path.join(root, MEETINGS_DIR);
  const workspacesDir = path.join(root, WORKSPACES_DIR);

  const meetings = [];
  if (fs.existsSync(meetingsDir)) {
    const entries = fs.readdirSync(meetingsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const meetingJsonPath = path.join(meetingsDir, entry.name, "meeting.json");
        if (fs.existsSync(meetingJsonPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(meetingJsonPath, "utf8"));
            meetings.push({
              path: path.join(meetingsDir, entry.name),
              metadata,
            });
          } catch (e) {
            console.error(\`Error reading meeting \${entry.name}:\`, e);
          }
        }
      }
    }
  }

  const workplaces = [];
  if (fs.existsSync(workspacesDir)) {
    const entries = fs.readdirSync(workspacesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const manifestPath = path.join(workspacesDir, entry.name, ".smartpuck-workspace.json");
        if (fs.existsSync(manifestPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            workplaces.push({
              path: path.join(workspacesDir, entry.name),
              metadata,
              meetings: [],
            });
          } catch (e) {
            console.error(\`Error reading workspace \${entry.name}:\`, e);
          }
        }
      }
    }
  }

  for (const workplace of workplaces) {
    workplace.meetings = meetings.filter((meeting) =>
      (meeting.metadata.workspaceIds || []).includes(workplace.metadata.id)
    );
  }

  const linkedIds = new Set(workplaces.map((w) => w.metadata.id));
  const inbox = meetings.filter(
    (meeting) => !(meeting.metadata.workspaceIds || []).some((id) => linkedIds.has(id))
  );

  return { meetings, workplaces, inbox };
}

function rebuildIndexes(root, library) {
  const { workplaces, meetings } = library;

  for (const workplace of workplaces) {
    const meetingsPath = path.join(workplace.path, "meetings.md");
    let customNotes = "";

    if (fs.existsSync(meetingsPath)) {
      const currentContent = fs.readFileSync(meetingsPath, "utf8");
      const dividerIndex = currentContent.indexOf("## Linked Meetings");
      if (dividerIndex !== -1) {
        let rawNotes = currentContent.substring(0, dividerIndex).trim();
        while (rawNotes.endsWith("---")) {
          rawNotes = rawNotes.substring(0, rawNotes.length - 3).trim();
        }
        customNotes = rawNotes + "\\n\\n";
      } else {
        customNotes = currentContent.trim() + "\\n\\n";
      }
    } else {
      customNotes = \`# \${workplace.metadata.name}\\n\\n## Memory & Notes\\nUse this section to store workspace-specific jargon, names, and memory. AI agents will read this to get context.\\n\\n\`;
    }

    const indexLines = [
      "## Linked Meetings",
      "This section is automatically updated by SmartPuck. Do not edit manually.",
      "",
    ];

    if (workplace.meetings.length === 0) {
      indexLines.push("_No meetings linked yet._", "");
    } else {
      for (const meeting of workplace.meetings) {
        const transcript = path.relative(workplace.path, path.join(meeting.path, "transcript.md")).replaceAll("\\\\", "/");
        const metadata = path.relative(workplace.path, path.join(meeting.path, "meeting.json")).replaceAll("\\\\", "/");
        indexLines.push(\`- [\${meeting.metadata.title}](\${transcript}) — [metadata](\${metadata})\`);
      }
      indexLines.push("");
    }

    const oldReadme = path.join(workplace.path, "README.md");
    if (fs.existsSync(oldReadme)) {
      try { fs.unlinkSync(oldReadme); } catch {}
    }

    const finalContent = customNotes.trim() + "\\n\\n---\\n\\n" + indexLines.join("\\n") + "\\n";
    fs.writeFileSync(meetingsPath, finalContent, "utf8");
  }

  const unique = [...new Map(meetings.map((meeting) => [meeting.metadata.id, meeting])).values()];
  const pending = unique.filter((meeting) => meeting.metadata.curationStatus === "pending");
  const lines = [
    "# Inbox",
    "",
    \`Pending: \${pending.length}\`,
    "",
  ];
  if (pending.length === 0) {
    lines.push("_Nothing is waiting for curation._", "");
  } else {
    for (const meeting of pending) {
      const metadataPath = path.relative(root, path.join(meeting.path, "meeting.json")).replaceAll("\\\\", "/");
      lines.push(
        \`- [\${meeting.metadata.title}](\${metadataPath}) — \${meeting.metadata.status}; captured \${meeting.metadata.capturedAt}\`
      );
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(root, "NEW.md"), \`\${lines.join("\\n")}\\n\`, "utf8");
}

function createWorkspace(root, name) {
  const clean = name.trim();
  if (!clean) throw new Error("Workspace name is required.");
  const now = new Date().toISOString();
  
  const workspacesDir = path.join(root, WORKSPACES_DIR);
  const targetDir = path.join(workspacesDir, slug(clean));
  if (fs.existsSync(targetDir) && fs.existsSync(path.join(targetDir, ".smartpuck-workspace.json"))) {
    throw new Error("A workspace with that name already exists.");
  }
  
  fs.mkdirSync(targetDir, { recursive: true });
  
  const library = loadLibrary(root);
  const nextSortOrder = library.workplaces.reduce(
    (max, w) => Math.max(max, w.metadata.sortOrder ?? -1),
    -1
  ) + 1;
  
  const metadata = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: clean,
    sortOrder: nextSortOrder,
    createdAt: now,
    updatedAt: now,
  };
  
  fs.writeFileSync(
    path.join(targetDir, ".smartpuck-workspace.json"),
    JSON.stringify(metadata, null, 2),
    "utf8"
  );
  console.log(\`Workspace "\${clean}" created successfully.\`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function linkMeeting(root, meetingQuery, workspaceQuery) {
  const library = loadLibrary(root);
  
  const meeting = library.meetings.find(
    (m) =>
      m.metadata.id === meetingQuery ||
      m.metadata.id.startsWith(meetingQuery) ||
      path.basename(m.path).endsWith(meetingQuery)
  );
  if (!meeting) {
    throw new Error(\`Meeting not found for query: \${meetingQuery}\`);
  }
  
  const workspace = library.workplaces.find(
    (w) =>
      w.metadata.id === workspaceQuery ||
      w.metadata.name.toLowerCase() === workspaceQuery.toLowerCase() ||
      path.basename(w.path) === slug(workspaceQuery)
  );
  if (!workspace) {
    throw new Error(\`Workspace not found for query: \${workspaceQuery}\`);
  }
  
  const currentWorkspaceIds = meeting.metadata.workspaceIds || [];
  if (!currentWorkspaceIds.includes(workspace.metadata.id)) {
    meeting.metadata.workspaceIds = [...currentWorkspaceIds, workspace.metadata.id];
    meeting.metadata.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(
      path.join(meeting.path, "meeting.json"),
      JSON.stringify(meeting.metadata, null, 2),
      "utf8"
    );
    console.log(\`Linked meeting "\${meeting.metadata.title}" to workspace "\${workspace.metadata.name}"\`);
  } else {
    console.log(\`Meeting "\${meeting.metadata.title}" is already linked to workspace "\${workspace.metadata.name}"\`);
  }
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function unlinkMeeting(root, meetingQuery, workspaceQuery) {
  const library = loadLibrary(root);
  
  const meeting = library.meetings.find(
    (m) =>
      m.metadata.id === meetingQuery ||
      m.metadata.id.startsWith(meetingQuery) ||
      path.basename(m.path).endsWith(meetingQuery)
  );
  if (!meeting) {
    throw new Error(\`Meeting not found for query: \${meetingQuery}\`);
  }
  
  const workspace = library.workplaces.find(
    (w) =>
      w.metadata.id === workspaceQuery ||
      w.metadata.name.toLowerCase() === workspaceQuery.toLowerCase() ||
      path.basename(w.path) === slug(workspaceQuery)
  );
  if (!workspace) {
    throw new Error(\`Workspace not found for query: \${workspaceQuery}\`);
  }
  
  const currentWorkspaceIds = meeting.metadata.workspaceIds || [];
  if (currentWorkspaceIds.includes(workspace.metadata.id)) {
    meeting.metadata.workspaceIds = currentWorkspaceIds.filter((id) => id !== workspace.metadata.id);
    meeting.metadata.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(
      path.join(meeting.path, "meeting.json"),
      JSON.stringify(meeting.metadata, null, 2),
      "utf8"
    );
    console.log(\`Unlinked meeting "\${meeting.metadata.title}" from workspace "\${workspace.metadata.name}"\`);
  } else {
    console.log(\`Meeting "\${meeting.metadata.title}" is not linked to workspace "\${workspace.metadata.name}"\`);
  }
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function curateMeeting(root, meetingQuery, title, summary, workspacesStr) {
  const library = loadLibrary(root);
  const meeting = library.meetings.find(
    (m) =>
      m.metadata.id === meetingQuery ||
      m.metadata.id.startsWith(meetingQuery) ||
      path.basename(m.path).endsWith(meetingQuery)
  );
  if (!meeting) {
    throw new Error(\`Meeting not found for query: \${meetingQuery}\`);
  }
  
  if (title) meeting.metadata.title = title;
  if (summary) meeting.metadata.summary = summary;
  
  if (workspacesStr) {
    const wNames = workspacesStr.split(",").map((s) => s.trim()).filter(Boolean);
    const resolvedIds = [];
    for (const name of wNames) {
      const workspace = library.workplaces.find(
        (w) =>
          w.metadata.id === name ||
          w.metadata.name.toLowerCase() === name.toLowerCase() ||
          path.basename(w.path) === slug(name)
      );
      if (!workspace) {
        throw new Error(\`Workspace not found: \${name}\`);
      }
      resolvedIds.push(workspace.metadata.id);
    }
    meeting.metadata.workspaceIds = resolvedIds;
  }
  
  meeting.metadata.curationStatus = "curated";
  meeting.metadata.updatedAt = new Date().toISOString();
  
  fs.writeFileSync(
    path.join(meeting.path, "meeting.json"),
    JSON.stringify(meeting.metadata, null, 2),
    "utf8"
  );
  console.log(\`Curated meeting "\${meeting.metadata.title}" successfully.\`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function deleteWorkspace(root, workspaceQuery) {
  const library = loadLibrary(root);
  const workspace = library.workplaces.find(
    (w) =>
      w.metadata.id === workspaceQuery ||
      w.metadata.name.toLowerCase() === workspaceQuery.toLowerCase() ||
      path.basename(w.path) === slug(workspaceQuery)
  );
  if (!workspace) {
    throw new Error(\`Workspace not found for query: \${workspaceQuery}\`);
  }
  
  // Unlink all meetings from this workspace
  for (const meeting of library.meetings) {
    const currentWorkspaceIds = meeting.metadata.workspaceIds || [];
    if (currentWorkspaceIds.includes(workspace.metadata.id)) {
      meeting.metadata.workspaceIds = currentWorkspaceIds.filter((id) => id !== workspace.metadata.id);
      meeting.metadata.updatedAt = new Date().toISOString();
      fs.writeFileSync(
        path.join(meeting.path, "meeting.json"),
        JSON.stringify(meeting.metadata, null, 2),
        "utf8"
      );
    }
  }
  
  // Safely delete workspace directory
  if (fs.existsSync(workspace.path)) {
    fs.rmSync(workspace.path, { recursive: true, force: true });
  }
  console.log(\`Deleted workspace "\${workspace.metadata.name}" successfully.\`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function renameWorkspace(root, workspaceQuery, newName) {
  const library = loadLibrary(root);
  const workspace = library.workplaces.find(
    (w) =>
      w.metadata.id === workspaceQuery ||
      w.metadata.name.toLowerCase() === workspaceQuery.toLowerCase() ||
      path.basename(w.path) === slug(workspaceQuery)
  );
  if (!workspace) {
    throw new Error(\`Workspace not found for query: \${workspaceQuery}\`);
  }
  
  const oldPath = workspace.path;
  const targetDir = path.join(path.dirname(oldPath), slug(newName));
  
  if (fs.existsSync(targetDir) && oldPath !== targetDir) {
    throw new Error("A workspace with that renamed folder already exists.");
  }
  
  workspace.metadata.name = newName;
  workspace.metadata.updatedAt = new Date().toISOString();
  
  fs.writeFileSync(
    path.join(oldPath, ".smartpuck-workspace.json"),
    JSON.stringify(workspace.metadata, null, 2),
    "utf8"
  );
  
  if (oldPath !== targetDir) {
    fs.renameSync(oldPath, targetDir);
  }
  console.log(\`Renamed workspace to "\${newName}" successfully.\`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function trashMeeting(root, meetingQuery) {
  const library = loadLibrary(root);
  const meeting = library.meetings.find(
    (m) =>
      m.metadata.id === meetingQuery ||
      m.metadata.id.startsWith(meetingQuery) ||
      path.basename(m.path).endsWith(meetingQuery)
  );
  if (!meeting) {
    throw new Error(\`Meeting not found for query: \${meetingQuery}\`);
  }
  
  const trashBase = path.join(root, "Trash");
  if (!fs.existsSync(trashBase)) {
    fs.mkdirSync(trashBase, { recursive: true });
  }
  
  const targetPath = path.join(trashBase, path.basename(meeting.path));
  fs.renameSync(meeting.path, targetPath);
  console.log(\`Moved meeting "\${meeting.metadata.title}" to Trash.\`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const root = getLibraryRoot();
  
  try {
    switch (command) {
      case "create-workspace":
        if (!args[1]) throw new Error("Missing workspace name argument.");
        createWorkspace(root, args[1]);
        break;
      case "link":
        if (!args[1] || !args[2]) throw new Error("Usage: node manage-library.js link <meeting-id> <workspace-name-or-id>");
        linkMeeting(root, args[1], args[2]);
        break;
      case "unlink":
        if (!args[1] || !args[2]) throw new Error("Usage: node manage-library.js unlink <meeting-id> <workspace-name-or-id>");
        unlinkMeeting(root, args[1], args[2]);
        break;
      case "curate":
        if (!args[1]) throw new Error("Usage: node manage-library.js curate <meeting-id> --title \\"...\\" --summary \\"...\\" [--workspaces \\"...\\"]");
        const meetingId = args[1];
        let titleVal = "";
        let summaryVal = "";
        let workspacesVal = "";
        for (let i = 2; i < args.length; i++) {
          if (args[i] === "--title") {
            if (!args[i+1]) throw new Error("Missing value for flag: --title. Usage: --title \\"Your Title\\"");
            titleVal = args[i+1];
            i++;
          } else if (args[i] === "--summary") {
            if (!args[i+1]) throw new Error("Missing value for flag: --summary. Usage: --summary \\"Your summary text\\"");
            summaryVal = args[i+1];
            i++;
          } else if (args[i] === "--workspaces") {
            if (!args[i+1]) throw new Error("Missing value for flag: --workspaces. Usage: --workspaces \\"Workspace1, Workspace2\\"");
            workspacesVal = args[i+1];
            i++;
          }
        }
        if (!titleVal) throw new Error("Missing required flag: --title. You must provide a curation title using: --title \\"...\\"");
        if (!summaryVal) throw new Error("Missing required flag: --summary. You must provide a curation summary using: --summary \\"...\\"");
        curateMeeting(root, meetingId, titleVal, summaryVal, workspacesVal);
        break;
      case "delete-workspace":
        if (!args[1]) throw new Error("Usage: node manage-library.js delete-workspace <workspace-name-or-id>");
        deleteWorkspace(root, args[1]);
        break;
      case "rename-workspace":
        if (!args[1] || !args[2]) throw new Error("Usage: node manage-library.js rename-workspace <old-name-or-id> <new-name>");
        renameWorkspace(root, args[1], args[2]);
        break;
      case "trash":
        if (!args[1]) throw new Error("Usage: node manage-library.js trash <meeting-id>");
        trashMeeting(root, args[1]);
        break;
      case "rebuild":
        const lib = loadLibrary(root);
        rebuildIndexes(root, lib);
        console.log("Library indexes successfully rebuilt.");
        break;
      default:
        console.log(\`
SmartPuck Library CLI Manager

Usage:
  node manage-library.js create-workspace <workspace-name>
  node manage-library.js delete-workspace <workspace-name-or-id>
  node manage-library.js rename-workspace <old-name-or-id> <new-name>
  node manage-library.js link <meeting-id-or-suffix> <workspace-name-or-id>
  node manage-library.js unlink <meeting-id-or-suffix> <workspace-name-or-id>
  node manage-library.js curate <meeting-id-or-suffix> --title "..." --summary "..." [--workspaces "..."]
  node manage-library.js trash <meeting-id-or-suffix>
  node manage-library.js rebuild
\`);
        break;
    }
  } catch (err) {
    console.error(\`Error: \${err.message}\`);
    process.exitCode = 1;
  }
}

main();

`;

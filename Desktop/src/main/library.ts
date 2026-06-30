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

const WORKSPACE_INSTRUCTIONS = `# SmartPuck meeting library

Treat this workspace like a small, living project whose source material happens to be meetings. Help the user turn new recordings into useful memory and retrieve that memory without loading everything at once.

Start with NEW.md: it is a disposable view of recordings whose meeting.json still says curationStatus is pending. Then use SMARTPUCK.md and compact meeting metadata before opening full transcripts. When asked to curate new work, give each meeting a specific title and short summary, keep the transcript.md heading and Summary aligned with them, and link it to sensible workspaces by editing meeting.json.workspaceIds when the evidence is clear. A curated meeting may remain unlinked/Inbox when its destination is genuinely unclear.

You may reshape the organization as the library evolves: create, rename, merge, split, or retire workspaces instead of treating today's folders as permanent taxonomy. A meeting lives once under Meetings/; Workspaces/ folders are generated playlist-like views over meeting ids. meeting.json.workspaceIds connects that same meeting to zero, one, or many workspaces without copying files. Edit the canonical meeting.json and transcript.md under Meetings/; do not treat generated workspace meetings.md files as source of truth. Preserve stable JSON ids, original audio, and transcript.segments.json; those are the app's identity and raw evidence. transcript.md is the readable working copy, but only rewrite its wording when the user asks. Put summaries, decisions, and action items in clearly named sections and keep inference distinct from what was actually said.

Workspace meetings.md is auto-generated; agents must never edit the meetings list under "## Linked Meetings" directly. Use the "Memory & Notes" section at the top of meetings.md to store workspace-specific jargon, notes, names, and memory. Agents must proactively build and update this memory section with new jargon, project context, and names of people mentioned during transcription or curation, without waiting for explicit user requests (but keep it selective to avoid clutter).

When untagged meetings share a clear theme, suggest creating a new workspace (by creating a folder in Workspaces/ with a .smartpuck-workspace.json manifest) and ask the user for confirmation.

When answering questions, cite useful timestamps and be candid when the recording does not establish a person, date, decision, or deadline. Move unwanted meetings intact to Trash so they remain recoverable.

Transcripts are UTF-8. If a legacy Windows terminal renders Khmer as garbled characters, read with an UTF-8-aware file tool (for PowerShell, Get-Content -Encoding UTF8); do not "repair" valid transcript bytes based on terminal display.
`;

const CLAUDE_INSTRUCTIONS = `@AGENTS.md
`;

const SKILL = `---
name: smartpuck-meetings
description: Search, analyze, summarize, clean, rename, and organize meetings in a SmartPuck transcript workspace.
---

# SmartPuck meetings

This is a meeting library shaped like a small code project. Help the user turn raw recordings into useful memory without loading the whole library into context.

Approach this as repository work: orient cheaply, change coherent files, and leave the library easier to understand than you found it. Begin with NEW.md and mention its pending count naturally. It is only a generated index; meeting.json remains canonical. If the user wants those recordings processed, inspect their transcripts, choose specific titles and compact summaries, keep the transcript.md heading and Summary aligned with those choices, and link them to the best existing workspaces by editing meeting.json.workspaceIds when the evidence is clear. Then set curationStatus to curated; the app rebuilds NEW.md and workspace meetings.md files from metadata whenever it scans. Inbox means unassigned, not necessarily unfinished. Workspaces are useful views, not permanent ontology: improve them as patterns change. Keep one canonical meeting directory under Meetings/; use workspaceIds when the same meeting belongs in several contexts.

Workspace meetings.md is auto-generated; agents must never edit the meetings list under "## Linked Meetings" directly. Use the "Memory & Notes" section at the top of meetings.md to store workspace-specific jargon, notes, names, and memory. Agents must proactively build and update this memory section with new jargon, project context, and names of people mentioned during transcription or curation, without waiting for explicit user requests (but keep it selective to avoid clutter).

When untagged meetings share a clear theme, suggest creating a new workspace (by creating a folder in Workspaces/ with a .smartpuck-workspace.json manifest) and ask the user for confirmation.

For questions, search meeting titles and summaries first, then rg transcript.md and read only the relevant passages. Use timestamps as evidence. Stable ids, original audio, and transcript.segments.json must survive unchanged; transcript.md and descriptive metadata are the working layer. Reorganize freely when useful, but only rewrite transcript wording when explicitly asked. Move unwanted meeting directories intact to Trash.

Transcript files are UTF-8. A legacy Windows console may garble Khmer display; use an UTF-8-aware read before concluding the text is damaged.
`;

const WORKSPACE_GUIDE = `# SmartPuck workspace schema

- Meetings/ contains every canonical meeting folder exactly once: metadata, original audio, processed audio when available, transcript.md, and immutable transcript.segments.json.
- Workspaces/ contains playlist-like workspace folders. Each meetings.md is a generated view with links back to canonical meetings and may be overwritten by the app.
- Inbox is the app's view of imported meetings not yet assigned to any workspace.
- Trash contains recoverable meetings removed from the active library. Ignore it during normal search unless the user asks about deleted material.
- NEW.md is a disposable pending-work index rebuilt from meeting.json curationStatus. Curated means a meeting has a useful title and summary; it may remain in Inbox if placement is genuinely ambiguous.
- Every workspace contains a hidden .smartpuck-workspace.json manifest; its id may appear in meeting.json.workspaceIds.
- meeting.json.workspaceIds may reference any number of workspace manifest ids. These are views of the same canonical meeting, never instructions to copy its directory or evidence files.
- Every meeting directory ends in the first eight characters of meeting.json.id. Preserve that suffix and refuse rename/move collisions.
- meeting.json.capturedAt is the best known source recording time (device timestamp when available, otherwise source-file modified time). updatedAt tracks app/agent metadata changes.
- meeting.json.audioFile identifies the immutable original audio. durationSeconds is authoritative when present; otherwise derive duration from the final immutable segment end.
- meeting.json.processedAudioFile identifies the normalized or denoised review waveform selected by the transcription pipeline. It is derived and replaceable; audioFile and transcript.segments.json remain the recovery evidence.
- transcript.md is editable when the user asks for cleanup. Preserve timestamps and evidence meaning. Put derived material only under Summary, Key Points, Decisions, or Action Items.
- transcript.segments.json is immutable recovery evidence. Never edit it to match transcript cleanup.
- App-managed AGENTS.md, CLAUDE.md, and skill files are created once; user additions are preserved.

## JSON Schemas

### Workplace Manifest (\`Workspaces/<slug>/.smartpuck-workspace.json\`)
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

### Meeting Metadata (\`Meetings/<meeting-id>/meeting.json\`)
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
  if (existing.includes(legacySignature) && !existing.includes("NEW.md")) {
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
  upgradeLegacyGeneratedFile(join(root, "AGENTS.md"), WORKSPACE_INSTRUCTIONS, "# SmartPuck meeting library");
  upgradeLegacyGeneratedFile(join(root, "CLAUDE.md"), CLAUDE_INSTRUCTIONS, "# SmartPuck meeting library");
  writeIfChanged(join(root, "SMARTPUCK.md"), WORKSPACE_GUIDE);
  writeIfChanged(join(root, "NEW.md"), "# New SmartPuck meetings\n\nPending: 0\n\n_Nothing is waiting for curation._\n");
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
  return { path, metadata, transcript: existsSync(transcriptPath) ? readFileSync(transcriptPath, "utf8") : "" };
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
    .some((meeting) => meeting.metadata.sourceDevicePath === sourceDevicePath);
}
export function updateMeetingMetadata(id: string, update: Partial<MeetingMetadata>): void {
  const meeting = findMeeting(id);
  meeting.metadata = { ...meeting.metadata, ...update, id: meeting.metadata.id, schemaVersion: 1 };
  writeMeeting(meeting);
}

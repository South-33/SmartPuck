import Database from "better-sqlite3";
import { createHash, randomUUID } from "crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "fs";
import { basename, dirname, extname, join } from "path";
import type {
  SmartPuckFolder,
  SmartPuckImportResult,
  SmartPuckLibrarySnapshot,
  SmartPuckRecording,
  SmartPuckRecordingStatus,
  SmartPuckTranscriptionModel,
  SmartPuckTranscriptionRequest,
  SmartPuckTranscriptionResult,
} from "../shared/smartpuck-library";
import { getDbConnection } from "./db";
import { deleteSession } from "./sessions";
import { getArchivedFolderIds } from "./archive";
import {
  activeStateDbPath,
  getActiveProfileNameSync,
  profileHome,
  safeWriteFile,
} from "./utils";

const FOLDERS_TABLE = "smartpuck_folders";
const RECORDINGS_TABLE = "smartpuck_recordings";
const MEMBERSHIPS_TABLE = "smartpuck_folder_recordings";
const FOLDER_META = ".smartpuck-folder.json";
const TRANSCRIPT_FILE = "transcript.md";
const TRANSCRIPT_JSON_FILE = "transcript.segments.json";
const RECORDING_META = "metadata.json";
const TRANSCRIPTION_REQUEST = "transcription.request.json";
const TRANSCRIPTION_ERROR = "transcription.error.json";
const MEETING_INSTRUCTIONS = `This is a SmartPuck meeting workspace.

- Treat recordings and transcripts as meeting knowledge, not source code.
- Search transcript files and read only relevant passages instead of loading every transcript.
- List or search this workspace before reading; never invent filenames. Each recording stores transcript.md and metadata.json in its own subdirectory.
- Ground answers in the local files and cite timestamps when segment data includes them.
- Say clearly when a recording is not transcribed or evidence is missing.
- Do not alter original audio. Do not invent attendees, decisions, deadlines, or action items.
- Stay in this folder by default; inspect sibling meeting folders only when the user explicitly asks.
`;

interface FolderRow {
  id: string;
  name: string;
  folder_path: string;
  created_at: number;
  updated_at: number;
}

interface RecordingRow {
  id: string;
  folder_id: string;
  title: string;
  source_file_name: string;
  audio_path: string;
  recording_path: string;
  transcript_path: string;
  transcript_json_path: string;
  metadata_path: string;
  size_bytes: number;
  audio_sha256: string;
  status: SmartPuckRecordingStatus;
  model_profile: string | null;
  language: string | null;
  duration_seconds: number | null;
  created_at: number;
  updated_at: number;
}

export function smartPuckLibraryRoot(): string {
  return join(profileHome(getActiveProfileNameSync()), "smartpuck", "library");
}

function ensureLibraryRoot(): string {
  const root = smartPuckLibraryRoot();
  mkdirSync(root, { recursive: true });
  writeMeetingInstructions(root);
  return root;
}

function writeMeetingInstructions(folderPath: string): void {
  const instructionsPath = join(folderPath, "AGENTS.md");
  safeWriteFile(instructionsPath, MEETING_INSTRUCTIONS);
}

function ensureTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${FOLDERS_TABLE} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder_path TEXT NOT NULL UNIQUE,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${RECORDINGS_TABLE} (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_file_name TEXT NOT NULL,
      audio_path TEXT NOT NULL,
      recording_path TEXT NOT NULL,
      transcript_path TEXT NOT NULL,
      transcript_json_path TEXT NOT NULL,
      metadata_path TEXT NOT NULL,
      size_bytes REAL NOT NULL,
      audio_sha256 TEXT NOT NULL,
      status TEXT NOT NULL,
      model_profile TEXT,
      language TEXT,
      duration_seconds REAL,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL,
      UNIQUE(folder_id, audio_sha256)
    );

    CREATE TABLE IF NOT EXISTS ${MEMBERSHIPS_TABLE} (
      folder_id TEXT NOT NULL,
      recording_id TEXT NOT NULL,
      added_at REAL NOT NULL,
      PRIMARY KEY (folder_id, recording_id)
    );

    INSERT OR IGNORE INTO ${MEMBERSHIPS_TABLE} (folder_id, recording_id, added_at)
      SELECT folder_id, id, created_at FROM ${RECORDINGS_TABLE};
  `);
}

function writableDb(): Database.Database | null {
  const dbPath = activeStateDbPath();
  if (!existsSync(dbPath)) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const freshDb = new Database(dbPath);
    freshDb.close();
  }
  const db = getDbConnection(false);
  if (db) ensureTables(db);
  return db;
}

function readableDb(): Database.Database | null {
  const db = getDbConnection(false);
  if (db) ensureTables(db);
  return db;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "meeting";
}

function uniquePath(root: string, baseSlug: string): string {
  let candidate = join(root, baseSlug);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = join(root, `${baseSlug}-${index}`);
    index += 1;
  }
  return candidate;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function rowToRecording(row: RecordingRow): SmartPuckRecording {
  const processedPath = join(row.recording_path, "recording.processed.wav");
  const legacyDenoisedPath = join(row.recording_path, "recording.denoised.wav");
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    sourceFileName: row.source_file_name,
    audioPath: row.audio_path,
    playbackAudioPath: existsSync(processedPath)
      ? processedPath
      : existsSync(legacyDenoisedPath)
        ? legacyDenoisedPath
        : row.audio_path,
    recordingPath: row.recording_path,
    transcriptPath: row.transcript_path,
    transcriptJsonPath: row.transcript_json_path,
    metadataPath: row.metadata_path,
    sizeBytes: row.size_bytes,
    audioSha256: row.audio_sha256,
    status: row.status,
    modelProfile: row.model_profile,
    language: row.language,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToFolder(
  row: FolderRow,
  recordings: SmartPuckRecording[],
): SmartPuckFolder {
  return {
    id: row.id,
    name: row.name,
    path: row.folder_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recordings,
  };
}

function writeJson(filePath: string, value: unknown): void {
  safeWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFolderMetadata(
  folder: Omit<SmartPuckFolder, "recordings">,
): void {
  writeJson(join(folder.path, FOLDER_META), folder);
}

function recordingTitle(filePath: string): string {
  return basename(filePath, extname(filePath)).replace(/[_-]+/g, " ").trim();
}

export function createSmartPuckFolder(name: string): SmartPuckFolder {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new Error("Folder name must be at least 2 characters.");
  }

  const db = writableDb();
  if (!db) throw new Error("Hermes state database is not ready yet.");

  const now = Date.now();
  const root = ensureLibraryRoot();
  const folderPath = uniquePath(root, slugify(trimmed));
  mkdirSync(folderPath, { recursive: true });

  const row: FolderRow = {
    id: randomUUID(),
    name: trimmed,
    folder_path: folderPath,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO ${FOLDERS_TABLE} (id, name, folder_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.id, row.name, row.folder_path, row.created_at, row.updated_at);

  const folder = rowToFolder(row, []);
  writeFolderMetadata(folder);
  writeMeetingInstructions(folder.path);
  return folder;
}

export function renameSmartPuckFolder(
  folderId: string,
  name: string,
): SmartPuckFolder {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new Error("Folder name must be at least 2 characters.");
  }
  const db = writableDb();
  if (!db) throw new Error("SmartPuck database is not ready yet.");
  const row = getFolderRow(folderId);
  if (!row) throw new Error("Meeting folder not found.");

  const duplicate = db
    .prepare(
      `SELECT id FROM ${FOLDERS_TABLE} WHERE lower(name) = lower(?) AND id != ?`,
    )
    .get(trimmed, folderId) as { id: string } | undefined;
  if (duplicate) throw new Error("A meeting folder already uses that name.");

  const updatedAt = Date.now();
  db.prepare(
    `UPDATE ${FOLDERS_TABLE} SET name = ?, updated_at = ? WHERE id = ?`,
  ).run(trimmed, updatedAt, folderId);
  const folder = rowToFolder(
    { ...row, name: trimmed, updated_at: updatedAt },
    listSmartPuckLibrary().folders.find((item) => item.id === folderId)
      ?.recordings ?? [],
  );
  writeFolderMetadata(folder);
  return folder;
}

export function renameSmartPuckRecording(
  recordingId: string,
  title: string,
): SmartPuckRecording {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Recording name cannot be empty.");
  const db = writableDb();
  if (!db) throw new Error("SmartPuck database is not ready yet.");
  const row = getRecordingRow(recordingId);
  if (!row) throw new Error("Recording not found.");
  const updatedAt = Date.now();
  db.prepare(
    `UPDATE ${RECORDINGS_TABLE} SET title = ?, updated_at = ? WHERE id = ?`,
  ).run(trimmed, updatedAt, recordingId);
  const updated = { ...row, title: trimmed, updated_at: updatedAt };
  writeJson(updated.metadata_path, rowToRecording(updated));
  return rowToRecording(updated);
}

function ensureDefaultFolder(): SmartPuckFolder {
  const snapshot = listSmartPuckLibrary();
  const inbox = snapshot.folders.find(
    (folder) => folder.name.trim().toLowerCase() === "inbox",
  );
  return inbox ?? createSmartPuckFolder("Inbox");
}

function getFolderRow(folderId: string): FolderRow | null {
  const db = readableDb();
  if (!db) return null;
  return (
    (db.prepare(`SELECT * FROM ${FOLDERS_TABLE} WHERE id = ?`).get(folderId) as
      | FolderRow
      | undefined) ?? null
  );
}

function getRecordingRow(recordingId: string): RecordingRow | null {
  const db = readableDb();
  if (!db) return null;
  return (
    (db
      .prepare(`SELECT * FROM ${RECORDINGS_TABLE} WHERE id = ?`)
      .get(recordingId) as RecordingRow | undefined) ?? null
  );
}

export function listSmartPuckLibrary(): SmartPuckLibrarySnapshot {
  const rootPath = ensureLibraryRoot();
  const db = readableDb();
  if (!db) return { rootPath, folders: [], recordings: [] };

  const folderRows = db
    .prepare(`SELECT * FROM ${FOLDERS_TABLE} ORDER BY updated_at DESC`)
    .all() as FolderRow[];
  const recordingRows = db
    .prepare(`SELECT * FROM ${RECORDINGS_TABLE} ORDER BY created_at DESC`)
    .all() as RecordingRow[];
  const recordings = recordingRows.map(rowToRecording);
  const recordingsByFolder = new Map<string, SmartPuckRecording[]>();
  const memberships = db.prepare(`SELECT folder_id, recording_id FROM ${MEMBERSHIPS_TABLE}`).all() as Array<{ folder_id: string; recording_id: string }>;
  const recordingsById = new Map(recordings.map((recording) => [recording.id, recording]));
  for (const membership of memberships) {
    const recording = recordingsById.get(membership.recording_id);
    if (!recording) continue;
    const list = recordingsByFolder.get(membership.folder_id) ?? [];
    list.push(recording);
    recordingsByFolder.set(membership.folder_id, list);
  }

  const archivedFolderIds = getArchivedFolderIds();
  const nonArchivedFolderRows = folderRows.filter((row) => !archivedFolderIds.has(row.id));

  return {
    rootPath,
    recordings,
    folders: nonArchivedFolderRows.map((row) => {
      writeMeetingInstructions(row.folder_path);
      return rowToFolder(row, recordingsByFolder.get(row.id) ?? []);
    }),
  };
}

export function importSmartPuckAudioFiles(
  folderId: string | null,
  filePaths: string[],
): SmartPuckImportResult {
  if (filePaths.length === 0) {
    throw new Error("Choose at least one audio file to import.");
  }

  const db = writableDb();
  if (!db) throw new Error("Hermes state database is not ready yet.");

  const targetFolder = ensureDefaultFolder();
  const imported: SmartPuckRecording[] = [];
  const now = Date.now();

  for (const sourcePath of filePaths) {
    if (!existsSync(sourcePath)) {
      throw new Error(`Audio file not found: ${sourcePath}`);
    }
    const sourceStat = statSync(sourcePath);
    if (!sourceStat.isFile()) {
      throw new Error(`Not a file: ${sourcePath}`);
    }

    const audioSha256 = sha256File(sourcePath);
    const existing = db
      .prepare(
        `SELECT * FROM ${RECORDINGS_TABLE}
         WHERE audio_sha256 = ?`,
      )
      .get(audioSha256) as RecordingRow | undefined;
    if (existing) {
      db.prepare(`INSERT OR IGNORE INTO ${MEMBERSHIPS_TABLE} (folder_id, recording_id, added_at) VALUES (?, ?, ?)`).run(targetFolder.id, existing.id, now);
      if (folderId && folderId !== targetFolder.id) {
        db.prepare(`INSERT OR IGNORE INTO ${MEMBERSHIPS_TABLE} (folder_id, recording_id, added_at) VALUES (?, ?, ?)`).run(folderId, existing.id, now);
      }
      imported.push(rowToRecording(existing));
      continue;
    }

    const id = randomUUID();
    const title = recordingTitle(sourcePath) || "Imported recording";
    const recordingDir = uniquePath(
      targetFolder.path,
      `${new Date(now).toISOString().slice(0, 10)}-${slugify(title)}`,
    );
    mkdirSync(recordingDir, { recursive: true });

    const audioPath = join(
      recordingDir,
      `audio${extname(sourcePath) || ".wav"}`,
    );
    const transcriptPath = join(recordingDir, TRANSCRIPT_FILE);
    const transcriptJsonPath = join(recordingDir, TRANSCRIPT_JSON_FILE);
    const metadataPath = join(recordingDir, RECORDING_META);

    copyFileSync(sourcePath, audioPath);
    const row: RecordingRow = {
      id,
      folder_id: targetFolder.id,
      title,
      source_file_name: basename(sourcePath),
      audio_path: audioPath,
      recording_path: recordingDir,
      transcript_path: transcriptPath,
      transcript_json_path: transcriptJsonPath,
      metadata_path: metadataPath,
      size_bytes: sourceStat.size,
      audio_sha256: audioSha256,
      status: "imported",
      model_profile: null,
      language: null,
      duration_seconds: null,
      created_at: now,
      updated_at: now,
    };

    writeJson(metadataPath, rowToRecording(row));
    db.prepare(
      `INSERT INTO ${RECORDINGS_TABLE} (
        id, folder_id, title, source_file_name, audio_path, recording_path,
        transcript_path, transcript_json_path, metadata_path, size_bytes,
        audio_sha256, status, model_profile, language, duration_seconds,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.folder_id,
      row.title,
      row.source_file_name,
      row.audio_path,
      row.recording_path,
      row.transcript_path,
      row.transcript_json_path,
      row.metadata_path,
      row.size_bytes,
      row.audio_sha256,
      row.status,
      row.model_profile,
      row.language,
      row.duration_seconds,
      row.created_at,
      row.updated_at,
    );
    db.prepare(`INSERT OR IGNORE INTO ${MEMBERSHIPS_TABLE} (folder_id, recording_id, added_at) VALUES (?, ?, ?)`).run(targetFolder.id, row.id, now);
    if (folderId && folderId !== targetFolder.id) {
      db.prepare(`INSERT OR IGNORE INTO ${MEMBERSHIPS_TABLE} (folder_id, recording_id, added_at) VALUES (?, ?, ?)`).run(folderId, row.id, now);
    }
    imported.push(rowToRecording(row));
  }

  const activeFolderId = folderId ?? targetFolder.id;
  db.prepare(`UPDATE ${FOLDERS_TABLE} SET updated_at = ? WHERE id = ?`).run(
    Date.now(),
    activeFolderId,
  );

  return {
    folder:
      listSmartPuckLibrary().folders.find(
        (item) => item.id === activeFolderId,
      ) ?? targetFolder,
    recordings: imported,
  };
}

export function importSmartPuckSessionDirectory(
  folderId: string | null,
  sessionRoot: string,
): SmartPuckImportResult {
  if (!existsSync(sessionRoot) || !statSync(sessionRoot).isDirectory()) {
    throw new Error("Choose a SmartPuck session directory.");
  }
  const audioFiles = readdirSync(sessionRoot)
    .filter((name) => /\.(wav|mp3|m4a|flac|ogg|webm)$/i.test(name))
    .map((name) => join(sessionRoot, name));
  if (audioFiles.length === 0) {
    throw new Error("No audio files found in that SmartPuck session folder.");
  }
  return importSmartPuckAudioFiles(folderId, audioFiles);
}

export function queueSmartPuckTranscription(
  recordingId: string,
  modelProfile: SmartPuckTranscriptionModel,
  language: string | null = null,
  denoiseMode: string = "auto",
  normalizeAudio: boolean = true,
): SmartPuckRecording {
  if (!recordingId.trim()) throw new Error("Recording id is required.");
  if (
    !(
      [
        "auto",
        "english-fast",
        "khmer-better",
        "large-v3-turbo",
        "small",
      ] as string[]
    ).includes(modelProfile)
  ) {
    throw new Error("Unsupported transcription model.");
  }

  const db = writableDb();
  if (!db) throw new Error("SmartPuck database is not ready yet.");
  const row = getRecordingRow(recordingId);
  if (!row) throw new Error("Recording not found.");

  const requestedAt = Date.now();
  const normalizedLanguage = language?.trim() || null;
  const request: SmartPuckTranscriptionRequest = {
    recordingId: row.id,
    audioPath: row.audio_path,
    transcriptPath: row.transcript_path,
    transcriptJsonPath: row.transcript_json_path,
    modelProfile,
    language: normalizedLanguage,
    denoiseMode,
    normalizeAudio,
    requestedAt,
  };
  writeJson(join(row.recording_path, TRANSCRIPTION_REQUEST), request);

  db.prepare(
    `UPDATE ${RECORDINGS_TABLE}
     SET status = ?, model_profile = ?, language = ?, updated_at = ?
     WHERE id = ?`,
  ).run("queued", modelProfile, normalizedLanguage, requestedAt, row.id);

  const updated: RecordingRow = {
    ...row,
    status: "queued",
    model_profile: modelProfile,
    language: normalizedLanguage,
    updated_at: requestedAt,
  };
  writeJson(updated.metadata_path, rowToRecording(updated));
  return rowToRecording(updated);
}

function updateRecordingState(
  recordingId: string,
  status: SmartPuckRecordingStatus,
  values: {
    modelProfile?: string | null;
    language?: string | null;
    durationSeconds?: number | null;
  } = {},
): SmartPuckRecording {
  const db = writableDb();
  if (!db) throw new Error("SmartPuck database is not ready yet.");
  const row = getRecordingRow(recordingId);
  if (!row) throw new Error("Recording not found.");

  const updatedAt = Date.now();
  const updated: RecordingRow = {
    ...row,
    status,
    model_profile: values.modelProfile ?? row.model_profile,
    language: values.language ?? row.language,
    duration_seconds: values.durationSeconds ?? row.duration_seconds,
    updated_at: updatedAt,
  };
  db.prepare(
    `UPDATE ${RECORDINGS_TABLE}
     SET status = ?, model_profile = ?, language = ?, duration_seconds = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    updated.status,
    updated.model_profile,
    updated.language,
    updated.duration_seconds,
    updated.updated_at,
    updated.id,
  );
  writeJson(updated.metadata_path, rowToRecording(updated));
  return rowToRecording(updated);
}

export function markSmartPuckTranscriptionStarted(
  recordingId: string,
): SmartPuckRecording {
  return updateRecordingState(recordingId, "transcribing");
}

function timestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? [hours, minutes, remainder]
        .map((part) => String(part).padStart(2, "0"))
        .join(":")
    : [minutes, remainder]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
}

export function completeSmartPuckTranscription(
  recordingId: string,
  result: SmartPuckTranscriptionResult,
): SmartPuckRecording {
  const row = getRecordingRow(recordingId);
  if (!row) throw new Error("Recording not found.");
  const durationSeconds = result.segments.reduce(
    (longest, segment) => Math.max(longest, segment.end),
    0,
  );
  if (result.segments.length === 0 || !result.full_text.trim()) {
    for (const artifactPath of [
      row.transcript_path,
      row.transcript_json_path,
    ]) {
      if (existsSync(artifactPath)) unlinkSync(artifactPath);
    }
    for (const artifact of [TRANSCRIPTION_REQUEST, TRANSCRIPTION_ERROR]) {
      const artifactPath = join(row.recording_path, artifact);
      if (existsSync(artifactPath)) unlinkSync(artifactPath);
    }
    return updateRecordingState(recordingId, "no-speech", {
      modelProfile: result.profile,
      language: result.language,
      durationSeconds,
    });
  }
  const transcriptLines = [
    `# ${row.title}`,
    "",
    `- Language: ${result.language || "unknown"}`,
    `- Model: ${result.profile_label || result.model}`,
    `- Duration: ${timestamp(durationSeconds)}`,
    "",
    "## Transcript",
    "",
    ...result.segments.map(
      (segment) =>
        `**[${timestamp(segment.start)} - ${timestamp(segment.end)}]** ${segment.text}`,
    ),
  ];
  safeWriteFile(row.transcript_path, `${transcriptLines.join("\n")}\n`);
  writeJson(row.transcript_json_path, result);
  for (const artifact of [TRANSCRIPTION_REQUEST, TRANSCRIPTION_ERROR]) {
    const artifactPath = join(row.recording_path, artifact);
    if (existsSync(artifactPath)) unlinkSync(artifactPath);
  }
  return updateRecordingState(recordingId, "ready", {
    modelProfile: result.profile,
    language: result.language,
    durationSeconds,
  });
}

export function readSmartPuckTranscript(recordingId: string): string {
  const row = getRecordingRow(recordingId);
  if (!row) throw new Error("Recording not found.");
  return existsSync(row.transcript_path)
    ? readFileSync(row.transcript_path, "utf-8")
    : "";
}

export function saveSmartPuckTranscript(
  recordingId: string,
  content: string,
): SmartPuckRecording {
  const row = getRecordingRow(recordingId);
  if (!row) throw new Error("Recording not found.");
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    if (existsSync(row.transcript_path)) unlinkSync(row.transcript_path);
    return updateRecordingState(recordingId, "no-speech");
  }
  safeWriteFile(row.transcript_path, `${normalized}\n`);
  writeJson(join(row.recording_path, "transcript.edit.json"), {
    editedAt: Date.now(),
    note: "transcript.md contains the user-edited canonical transcript; timestamp JSON remains the original model output.",
  });
  return updateRecordingState(recordingId, "ready");
}

export function failSmartPuckTranscription(
  recordingId: string,
  error: unknown,
): SmartPuckRecording {
  const row = getRecordingRow(recordingId);
  if (!row) throw new Error("Recording not found.");
  const message = error instanceof Error ? error.message : String(error);
  writeJson(join(row.recording_path, TRANSCRIPTION_ERROR), {
    recordingId,
    message,
    failedAt: Date.now(),
  });
  return updateRecordingState(recordingId, "error");
}

export function deleteSmartPuckFolder(folderId: string): void {
  const db = writableDb();
  if (!db) throw new Error("SmartPuck database is not ready yet.");

  const row = getFolderRow(folderId);
  if (!row) return;

  // Find and delete all sessions (chats) associated with this folder path
  const stateDb = getDbConnection(false);
  if (stateDb) {
    const tableExists = stateDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'desktop_session_context_folders'")
      .get() as { name: string } | undefined;
    if (tableExists) {
      const sessions = stateDb
        .prepare("SELECT session_id FROM desktop_session_context_folders WHERE folder_path = ?")
        .all(row.folder_path) as Array<{ session_id: string }>;

      for (const s of sessions) {
        try {
          deleteSession(s.session_id);
        } catch (err) {
          console.error(`Failed to delete session ${s.session_id} for folder ${folderId}`, err);
        }
      }
    }
  }

  // Playlists do not own recordings; remove only their memberships.
  db.prepare(`DELETE FROM ${MEMBERSHIPS_TABLE} WHERE folder_id = ?`).run(folderId);
  db.prepare(`DELETE FROM ${FOLDERS_TABLE} WHERE id = ?`).run(folderId);

  // Recording files may still physically reside under the original folder
  // path, so leave it intact until their global recording rows are deleted.
}

export function deleteSmartPuckTranscript(recordingId: string): SmartPuckRecording {
  const db = writableDb();
  if (!db) throw new Error("SmartPuck database is not ready yet.");
  const row = getRecordingRow(recordingId);
  if (!row) throw new Error("Recording not found.");

  // Delete the files
  if (existsSync(row.transcript_path)) unlinkSync(row.transcript_path);
  if (existsSync(row.transcript_json_path)) unlinkSync(row.transcript_json_path);

  // Clean up request/error artifacts
  for (const artifact of [TRANSCRIPTION_REQUEST, TRANSCRIPTION_ERROR, "transcript.edit.json"]) {
    const artifactPath = join(row.recording_path, artifact);
    if (existsSync(artifactPath)) unlinkSync(artifactPath);
  }

  const updatedAt = Date.now();
  const updated: RecordingRow = {
    ...row,
    status: "imported",
    model_profile: null,
    language: null,
    duration_seconds: null,
    updated_at: updatedAt,
  };
  db.prepare(
    `UPDATE ${RECORDINGS_TABLE}
     SET status = ?, model_profile = ?, language = ?, duration_seconds = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    updated.status,
    updated.model_profile,
    updated.language,
    updated.duration_seconds,
    updated.updated_at,
    updated.id,
  );
  writeJson(updated.metadata_path, rowToRecording(updated));
  return rowToRecording(updated);
}

export function deleteSmartPuckRecording(recordingId: string): void {
  const db = writableDb();
  if (!db) throw new Error("SmartPuck database is not ready yet.");

  const row = getRecordingRow(recordingId);
  if (!row) return;

  // Delete the recording database row
  db.prepare(`DELETE FROM ${RECORDINGS_TABLE} WHERE id = ?`).run(recordingId);
  db.prepare(`DELETE FROM ${MEMBERSHIPS_TABLE} WHERE recording_id = ?`).run(recordingId);

  // Physically remove the recording folder (which contains audio, transcript, metadata)
  if (existsSync(row.recording_path)) {
    rmSync(row.recording_path, { recursive: true, force: true });
  }
}

export function moveSmartPuckRecording(
  recordingId: string,
  targetFolderId: string,
): SmartPuckRecording {
  const db = writableDb();
  if (!db) throw new Error("SmartPuck database is not ready yet.");

  const row = getRecordingRow(recordingId);
  if (!row) throw new Error("Recording not found.");

  const targetFolder = getFolderRow(targetFolderId);
  if (!targetFolder) throw new Error("Target folder not found.");

  db.prepare(
    `INSERT OR IGNORE INTO ${MEMBERSHIPS_TABLE} (folder_id, recording_id, added_at)
     VALUES (?, ?, ?)`,
  ).run(targetFolderId, recordingId, Date.now());
  return rowToRecording(row);
}

export function removeSmartPuckRecordingFromFolder(
  recordingId: string,
  folderId: string,
): void {
  const db = writableDb();
  if (!db) throw new Error("SmartPuck database is not ready yet.");
  db.prepare(
    `DELETE FROM ${MEMBERSHIPS_TABLE} WHERE recording_id = ? AND folder_id = ?`,
  ).run(recordingId, folderId);
}

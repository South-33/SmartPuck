import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSmartPuckFolder,
  completeSmartPuckTranscription,
  importSmartPuckAudioFiles,
  listSmartPuckLibrary,
  moveSmartPuckRecording,
  queueSmartPuckTranscription,
  readSmartPuckTranscript,
  renameSmartPuckFolder,
  saveSmartPuckTranscript,
} from "./smartpuck-library";

type Row = Record<string, unknown>;

const testState = vi.hoisted(() => ({
  home: "",
  folders: [] as Row[],
  recordings: [] as Row[],
  memberships: [] as Row[],
}));

vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    close(): void {}
  },
}));

function fakePrepare(sql: string): {
  run: (...args: unknown[]) => void;
  get: (...args: unknown[]) => Row | undefined;
  all: () => Row[];
} {
  return {
    run: (...args: unknown[]) => {
      if (sql.includes("smartpuck_folder_recordings")) {
        if (sql.includes("INSERT")) {
          if (!testState.memberships.some((row) => row.folder_id === args[0] && row.recording_id === args[1])) {
            testState.memberships.push({ folder_id: args[0], recording_id: args[1], added_at: args[2] });
          }
        }
        return;
      }
      if (sql.includes("INSERT INTO smartpuck_folders")) {
        testState.folders.push({
          id: args[0],
          name: args[1],
          folder_path: args[2],
          created_at: args[3],
          updated_at: args[4],
        });
        return;
      }
      if (sql.includes("INSERT INTO smartpuck_recordings")) {
        testState.recordings.push({
          id: args[0],
          folder_id: args[1],
          title: args[2],
          source_file_name: args[3],
          audio_path: args[4],
          recording_path: args[5],
          transcript_path: args[6],
          transcript_json_path: args[7],
          metadata_path: args[8],
          size_bytes: args[9],
          audio_sha256: args[10],
          status: args[11],
          model_profile: args[12],
          language: args[13],
          duration_seconds: args[14],
          created_at: args[15],
          updated_at: args[16],
        });
        return;
      }
      if (sql.includes("UPDATE smartpuck_folders")) {
        const renaming = sql.includes("SET name = ?");
        const folder = testState.folders.find(
          (row) => row.id === args[renaming ? 2 : 1],
        );
        if (folder) {
          if (renaming) folder.name = args[0];
          folder.updated_at = args[renaming ? 1 : 0];
        }
        return;
      }
      if (sql.includes("UPDATE smartpuck_recordings")) {
        const includesDuration = sql.includes("duration_seconds = ?");
        const recording = testState.recordings.find(
          (row) => row.id === args[includesDuration ? 5 : 4],
        );
        if (recording) {
          recording.status = args[0];
          recording.model_profile = args[1];
          recording.language = args[2];
          if (includesDuration) {
            recording.duration_seconds = args[3];
            recording.updated_at = args[4];
          } else {
            recording.updated_at = args[3];
          }
        }
      }
    },
    get: (...args: unknown[]) => {
      if (sql.includes("FROM smartpuck_folders WHERE id = ?")) {
        return testState.folders.find((row) => row.id === args[0]);
      }
      if (sql.includes("FROM smartpuck_folders WHERE lower(name) = ?")) {
        return testState.folders.find(
          (row) => String(row.name).toLowerCase() === String(args[0]).toLowerCase(),
        );
      }
      if (sql.includes("FROM smartpuck_recordings")) {
        if (sql.includes("WHERE id = ?")) {
          return testState.recordings.find((row) => row.id === args[0]);
        }
        return testState.recordings.find((row) => row.audio_sha256 === args[0]);
      }
      return undefined;
    },
    all: () => {
      if (sql.includes("FROM smartpuck_folder_recordings")) {
        return [...testState.memberships];
      }
      if (sql.includes("FROM smartpuck_folders")) {
        return [...testState.folders].sort(
          (a, b) => Number(b.updated_at) - Number(a.updated_at),
        );
      }
      if (sql.includes("FROM smartpuck_recordings")) {
        return [...testState.recordings].sort(
          (a, b) => Number(b.created_at) - Number(a.created_at),
        );
      }
      return [];
    },
  };
}

vi.mock("./db", () => ({
  getDbConnection: vi.fn(() => ({
    exec: vi.fn(),
    prepare: fakePrepare,
  })),
  closeDbConnection: vi.fn(),
}));

vi.mock("./utils", () => ({
  activeStateDbPath: vi.fn(() => join(testState.home, "state.db")),
  getActiveProfileNameSync: vi.fn(() => "default"),
  profileHome: vi.fn(() => testState.home),
  safeWriteFile: vi.fn((filePath: string, content: string) => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
  }),
}));

describe("smartpuck local library", () => {
  beforeEach(() => {
    testState.home = mkdtempSync(join(tmpdir(), "smartpuck-library-"));
    testState.folders = [];
    testState.recordings = [];
    testState.memberships = [];
  });

  afterEach(() => {
    if (testState.home && existsSync(testState.home)) {
      rmSync(testState.home, { recursive: true, force: true });
    }
  });

  it("creates a real folder and imports audio without fake transcript files", () => {
    const source = join(testState.home, "meeting-one.mp3");
    writeFileSync(source, Buffer.from("fake audio bytes"));

    const folder = createSmartPuckFolder("Planning Meeting");
    const result = importSmartPuckAudioFiles(folder.id, [source]);
    const snapshot = listSmartPuckLibrary();

    expect(existsSync(folder.path)).toBe(true);
    expect(result.folder.id).toBe(folder.id);
    expect(result.recordings).toHaveLength(1);
    
    const planningFolder = snapshot.folders.find(f => f.id === folder.id);
    expect(planningFolder).toBeDefined();
    expect(planningFolder!.recordings).toHaveLength(1);

    const recording = planningFolder!.recordings[0];
    expect(recording.title).toBe("meeting one");
    expect(recording.status).toBe("imported");
    expect(existsSync(recording.audioPath)).toBe(true);
    expect(existsSync(recording.transcriptPath)).toBe(false);
  });

  it("deduplicates the same recording inside a folder", () => {
    const source = join(testState.home, "same.wav");
    writeFileSync(source, Buffer.from("same payload"));

    const folder = createSmartPuckFolder("Daily");
    const first = importSmartPuckAudioFiles(folder.id, [source]);
    const second = importSmartPuckAudioFiles(folder.id, [source]);
    const snapshot = listSmartPuckLibrary();

    expect(first.recordings[0].id).toBe(second.recordings[0].id);
    const dailyFolder = snapshot.folders.find(f => f.id === folder.id);
    expect(dailyFolder).toBeDefined();
    expect(dailyFolder!.recordings).toHaveLength(1);
  });

  it("adds one recording to multiple playlist folders without duplicating it", () => {
    const source = join(testState.home, "meeting.wav");
    writeFileSync(source, "playlist audio");
    const first = createSmartPuckFolder("First meeting");
    const second = createSmartPuckFolder("Second meeting");
    const imported = importSmartPuckAudioFiles(first.id, [source]).recordings[0];

    moveSmartPuckRecording(imported.id, second.id);
    const snapshot = listSmartPuckLibrary();
    expect(snapshot.recordings).toHaveLength(1);
    expect(snapshot.folders.find((folder) => folder.id === first.id)?.recordings).toHaveLength(1);
    expect(snapshot.folders.find((folder) => folder.id === second.id)?.recordings).toHaveLength(1);
  });

  it("queues a durable local transcription request", () => {
    const source = join(testState.home, "multilingual.mp3");
    writeFileSync(source, Buffer.from("audio payload"));
    const folder = createSmartPuckFolder("Language Practice");
    const imported = importSmartPuckAudioFiles(folder.id, [source]);

    const queued = queueSmartPuckTranscription(
      imported.recordings[0].id,
      "large-v3-turbo",
    );
    const requestPath = join(
      queued.recordingPath,
      "transcription.request.json",
    );

    expect(queued.status).toBe("queued");
    expect(queued.modelProfile).toBe("large-v3-turbo");
    expect(existsSync(requestPath)).toBe(true);
    expect(JSON.parse(readFileSync(requestPath, "utf-8"))).toMatchObject({
      recordingId: queued.id,
      audioPath: queued.audioPath,
      modelProfile: "large-v3-turbo",
    });
  });

  it("persists timestamped transcript artifacts for the agent", () => {
    const source = join(testState.home, "standup.wav");
    writeFileSync(source, Buffer.from("audio payload"));
    const folder = createSmartPuckFolder("Standup");
    const imported = importSmartPuckAudioFiles(folder.id, [source]);

    const completed = completeSmartPuckTranscription(
      imported.recordings[0].id,
      {
        profile: "auto",
        profile_label: "Balanced multilingual",
        model: "small",
        language: "en",
        language_probability: 0.99,
        segments: [
          { start: 62.1, end: 65.4, text: "Ship the desktop flow Friday." },
        ],
        full_text: "Ship the desktop flow Friday.",
        quality_flags: [],
      },
    );

    expect(completed.status).toBe("ready");
    expect(completed.durationSeconds).toBe(65.4);
    expect(readFileSync(completed.transcriptPath, "utf-8")).toContain(
      "**[01:02 - 01:05]** Ship the desktop flow Friday.",
    );
    expect(
      JSON.parse(readFileSync(completed.transcriptJsonPath, "utf-8")),
    ).toMatchObject({
      language: "en",
      segments: [{ start: 62.1, end: 65.4 }],
    });
  });

  it("removes empty transcription artifacts and marks no speech", () => {
    const source = join(testState.home, "silence.wav");
    writeFileSync(source, Buffer.from("audio payload"));
    const folder = createSmartPuckFolder("Quiet room");
    const recording = importSmartPuckAudioFiles(folder.id, [source])
      .recordings[0];

    const completed = completeSmartPuckTranscription(recording.id, {
      profile: "auto",
      profile_label: "Automatic language",
      model: "small",
      language: null,
      language_probability: 0.2,
      segments: [],
      full_text: "",
      quality_flags: ["empty_transcript"],
    });

    expect(completed.status).toBe("no-speech");
    expect(existsSync(completed.transcriptPath)).toBe(false);
    expect(existsSync(completed.transcriptJsonPath)).toBe(false);
  });

  it("renames folders and saves a user-edited canonical transcript", () => {
    const source = join(testState.home, "notes.wav");
    writeFileSync(source, Buffer.from("audio payload"));
    const folder = createSmartPuckFolder("Original name");
    const recording = importSmartPuckAudioFiles(folder.id, [source])
      .recordings[0];

    expect(renameSmartPuckFolder(folder.id, "Client meeting").name).toBe(
      "Client meeting",
    );
    const saved = saveSmartPuckTranscript(
      recording.id,
      "# Corrected notes\n\nThe deadline is Friday.",
    );
    expect(saved.status).toBe("ready");
    expect(readSmartPuckTranscript(recording.id)).toContain(
      "The deadline is Friday.",
    );
  });
});

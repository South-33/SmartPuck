import { spawn, type ChildProcess } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { app } from "electron";
import { meetingById, snapshot, updateMeetingMetadata } from "./library";

const PORT = 8765;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let worker: ChildProcess | null = null;
let workerStartup: Promise<void> | null = null;
let workerStartupError: Error | null = null;
let workerStdoutBuffer = "";
const activeAudioJobs = new Map<string, string>();

interface PipelineSegment {
  start: number;
  end: number;
  text: string;
}

interface PipelineResult {
  profile: string;
  model: string;
  language: string | null;
  segments: PipelineSegment[];
  full_text: string;
  quality_flags?: string[];
  denoise_applied?: boolean;
}

function scriptPath(): string {
  const candidates = [
    join(process.cwd(), "resources", "smartpuck", "transcribe_server.py"),
    join(app.getAppPath(), "resources", "smartpuck", "transcribe_server.py"),
    join(process.resourcesPath, "smartpuck", "transcribe_server.py"),
  ];
  const script = candidates.find(existsSync);
  if (!script) throw new Error("SmartPuck transcription pipeline is missing.");
  return script;
}

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function waitUntilHealthy(): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (workerStartupError) throw workerStartupError;
    if (await healthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The SmartPuck transcription worker did not become healthy within 60 seconds.");
}

async function ensureWorker(): Promise<void> {
  if (await healthy()) return;
  if (workerStartup) return workerStartup;
  workerStartup = (async () => {
    const script = scriptPath();
    const scriptDir = dirname(script);
    worker = spawn(process.env.SMARTPUCK_PYTHON || "python", [script], {
      cwd: scriptDir,
      env: {
        ...process.env,
        SMARTPUCK_TRANSCRIPTION_PORT: String(PORT),
        PYTHONUNBUFFERED: "1",
        HF_HOME: process.env.HF_HOME || join(scriptDir, "models"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    workerStartupError = null;
    workerStdoutBuffer = "";
    worker.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      console.info(text.trimEnd());
      workerStdoutBuffer += text;
      const lines = workerStdoutBuffer.split(/\r?\n/);
      workerStdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const match = /^\[SmartPuck STT\] Progress:\s*(\d+)%\s+for\s+(.+)$/.exec(line.trim());
        if (!match) continue;
        const meetingId = activeAudioJobs.get(match[2].trim());
        if (meetingId) updateMeetingMetadata(meetingId, { progressPercent: Math.min(95, Number(match[1])) });
      }
    });
    worker.stderr?.on("data", (chunk: Buffer) => console.warn("[SmartPuck STT]", chunk.toString("utf8").trimEnd()));
    worker.once("error", (error) => { workerStartupError = new Error(`Could not start transcription worker: ${error.message}`); worker = null; });
    worker.once("exit", (code) => { if (code && code !== 0) workerStartupError = new Error(`Transcription worker exited during startup (code ${code}).`); worker = null; });
    await waitUntilHealthy();
  })().finally(() => { workerStartup = null; });
  return workerStartup;
}

function timestamp(seconds: number): string {
  return new Date(Math.max(0, seconds) * 1000).toISOString().slice(11, 19);
}

export async function transcribeMeeting(meetingId: string): Promise<ReturnType<typeof snapshot>> {
  const meeting = meetingById(meetingId);
  const audioPath = join(meeting.path, meeting.metadata.audioFile);
  updateMeetingMetadata(meetingId, { status: "transcribing", progressPercent: 5, error: undefined });
  try {
    await ensureWorker();
    activeAudioJobs.set(audioPath, meetingId);
    const response = await fetch(`${BASE_URL}/transcribe-local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audio_path: audioPath,
        model_name: "auto",
        language: null,
        denoise_mode: "off",
        normalize: true,
        beam_size: 5,
      }),
    });
    if (!response.ok) throw new Error(`Transcription failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const result = (await response.json()) as PipelineResult;
    activeAudioJobs.delete(audioPath);
    if (!Array.isArray(result.segments) || typeof result.full_text !== "string") {
      throw new Error("The transcription pipeline returned an invalid result.");
    }
    const lines = result.segments.map((segment) => `[${timestamp(segment.start)}] ${segment.text.trim()}`);
    const durationSeconds = result.segments.reduce((maximum, segment) => Math.max(maximum, Number(segment.end) || 0), 0);
    writeFileSync(join(meeting.path, "transcript.segments.json"), JSON.stringify(result.segments, null, 2));
    writeFileSync(
      join(meeting.path, "transcript.md"),
      `# ${meeting.metadata.title}\n\n## Summary\n\n_Not generated yet._\n\n## Transcript\n\n${lines.join("\n\n")}\n`,
    );
    updateMeetingMetadata(meetingId, {
      status: "ready",
      language: result.language || undefined,
      transcriptionModel: result.model || result.profile,
      processedAudioFile: existsSync(join(meeting.path, "recording.processed.wav"))
        ? "recording.processed.wav"
        : undefined,
      denoiseApplied: result.denoise_applied,
      durationSeconds: durationSeconds || meeting.metadata.durationSeconds,
      progressPercent: 100,
      error: undefined,
    });
    return snapshot();
  } catch (error) {
    activeAudioJobs.delete(audioPath);
    updateMeetingMetadata(meetingId, { status: "error", progressPercent: 0, error: (error as Error).message });
    throw error;
  }
}

export function stopTranscriptionWorker(): void {
  worker?.kill();
  worker = null;
  workerStartup = null;
}

export function prestartTranscriptionWorker(): void {
  void ensureWorker().catch((err) => {
    console.warn("[SmartPuck STT] Failed to prestart worker on launch:", err.message);
  });
}

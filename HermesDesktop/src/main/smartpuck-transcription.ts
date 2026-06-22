import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import type {
  SmartPuckRecording,
  SmartPuckTranscriptionModel,
  SmartPuckTranscriptionResult,
} from "../shared/smartpuck-library";
import {
  completeSmartPuckTranscription,
  failSmartPuckTranscription,
  markSmartPuckTranscriptionStarted,
  queueSmartPuckTranscription,
  listSmartPuckLibrary,
} from "./smartpuck-library";

const PORT = 8765;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const activeJobs = new Map<string, Promise<void>>();
let worker: ChildProcess | null = null;
let workerStartup: Promise<void> | null = null;

function workerScriptPath(): string {
  const candidates = [
    join(process.cwd(), "resources", "smartpuck", "transcribe_server.py"),
    join(
      process.resourcesPath,
      "app.asar.unpacked",
      "resources",
      "smartpuck",
      "transcribe_server.py",
    ),
    join(
      process.resourcesPath,
      "resources",
      "smartpuck",
      "transcribe_server.py",
    ),
  ];
  const script = candidates.find(existsSync);
  if (!script) {
    throw new Error(
      "SmartPuck transcription worker is missing from this installation.",
    );
  }
  return script;
}

async function workerIsHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForWorker(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await workerIsHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "The local transcription worker did not start. Install the Python requirements and try again.",
  );
}

async function ensureWorker(): Promise<void> {
  if (await workerIsHealthy()) return;
  if (workerStartup) return workerStartup;

  workerStartup = (async () => {
    const python = process.env.SMARTPUCK_PYTHON?.trim() || "python";
    const script = workerScriptPath();
    const processHandle = spawn(python, [script], {
      cwd: dirname(script),
      env: {
        ...process.env,
        SMARTPUCK_TRANSCRIPTION_PORT: String(PORT),
        PYTHONUNBUFFERED: "1",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    worker = processHandle;
    processHandle.stdout?.on("data", (chunk: Buffer) => {
      console.info(`[SmartPuck STT] ${chunk.toString("utf-8").trimEnd()}`);
    });
    processHandle.stderr?.on("data", (chunk: Buffer) => {
      console.warn(`[SmartPuck STT] ${chunk.toString("utf-8").trimEnd()}`);
    });
    processHandle.once("exit", () => {
      worker = null;
    });
    processHandle.once("error", () => {
      worker = null;
    });
    await waitForWorker();
  })().finally(() => {
    workerStartup = null;
  });
  return workerStartup;
}

function workerProfile(model: SmartPuckTranscriptionModel): string {
  if (model === "english-fast") return "english-fast";
  if (model === "khmer-better") return "khmer-better";
  if (model === "large-v3-turbo") return "high-quality";
  return "auto";
}

async function executeTranscription(
  recording: SmartPuckRecording,
  model: SmartPuckTranscriptionModel,
  language: string | null,
  denoiseMode: string = "auto",
  normalizeAudio: boolean = true,
): Promise<void> {
  try {
    markSmartPuckTranscriptionStarted(recording.id);
    await ensureWorker();
    const response = await fetch(`${BASE_URL}/transcribe-local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audio_path: recording.audioPath,
        model_name: workerProfile(model),
        language,
        denoise_mode: denoiseMode,
        normalize: normalizeAudio,
      }),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`Transcription failed (${response.status}). ${body}`);
    }
    const result = (await response.json()) as SmartPuckTranscriptionResult;
    if (
      !Array.isArray(result.segments) ||
      typeof result.full_text !== "string"
    ) {
      throw new Error("The transcription worker returned an invalid result.");
    }
    completeSmartPuckTranscription(recording.id, result);
  } catch (error) {
    failSmartPuckTranscription(recording.id, error);
    console.error("[SmartPuck STT] Transcription failed", error);
  } finally {
    activeJobs.delete(recording.id);
  }
}

export function startSmartPuckTranscription(
  recordingId: string,
  model: SmartPuckTranscriptionModel,
  language: string | null = null,
  denoiseMode: string = "auto",
  normalizeAudio: boolean = true,
): SmartPuckRecording {
  if (activeJobs.has(recordingId)) {
    return queueSmartPuckTranscription(recordingId, model, language, denoiseMode, normalizeAudio);
  }
  const queued = queueSmartPuckTranscription(recordingId, model, language, denoiseMode, normalizeAudio);
  const job = executeTranscription(queued, model, language, denoiseMode, normalizeAudio);
  activeJobs.set(recordingId, job);
  return queued;
}

export function stopSmartPuckTranscriptionWorker(): void {
  worker?.kill();
  worker = null;
  workerStartup = null;
}

export function resumeSmartPuckTranscriptions(): void {
  const supportedModels: SmartPuckTranscriptionModel[] = [
    "auto",
    "english-fast",
    "khmer-better",
    "small",
    "large-v3-turbo",
  ];
  for (const folder of listSmartPuckLibrary().folders) {
    for (const recording of folder.recordings) {
      if (
        recording.status !== "queued" &&
        recording.status !== "transcribing"
      ) {
        continue;
      }
      const model = supportedModels.includes(
        recording.modelProfile as SmartPuckTranscriptionModel,
      )
        ? (recording.modelProfile as SmartPuckTranscriptionModel)
        : "small";
      
      let denoiseMode = "auto";
      let normalizeAudio = true;
      try {
        const reqPath = join(recording.recordingPath, "transcription.request.json");
        if (existsSync(reqPath)) {
          const reqData = JSON.parse(readFileSync(reqPath, "utf-8"));
          if (typeof reqData.denoiseMode === "string") {
            denoiseMode = reqData.denoiseMode;
          }
          if (typeof reqData.normalizeAudio === "boolean") {
            normalizeAudio = reqData.normalizeAudio;
          }
        }
      } catch (err) {
        console.warn("[SmartPuck STT] Failed to read transcription request json during resumption", err);
      }
      
      startSmartPuckTranscription(
        recording.id,
        model,
        recording.language ?? null,
        denoiseMode,
        normalizeAudio,
      );
    }
  }
}

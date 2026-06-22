export type SmartPuckRecordingStatus =
  | "imported"
  | "queued"
  | "transcribing"
  | "ready"
  | "no-speech"
  | "error";

export type SmartPuckTranscriptionModel =
  | "auto"
  | "english-fast"
  | "khmer-better"
  | "large-v3-turbo"
  | "small";

export interface SmartPuckRecording {
  id: string;
  folderId: string;
  title: string;
  sourceFileName: string;
  audioPath: string;
  playbackAudioPath?: string;
  recordingPath: string;
  transcriptPath: string;
  transcriptJsonPath: string;
  metadataPath: string;
  sizeBytes: number;
  audioSha256: string;
  status: SmartPuckRecordingStatus;
  modelProfile?: string | null;
  language?: string | null;
  durationSeconds?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SmartPuckFolder {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  recordings: SmartPuckRecording[];
}

export interface SmartPuckLibrarySnapshot {
  rootPath: string;
  folders: SmartPuckFolder[];
  recordings: SmartPuckRecording[];
}

export interface SmartPuckImportResult {
  folder: SmartPuckFolder;
  recordings: SmartPuckRecording[];
}

export interface SmartPuckTranscriptionRequest {
  recordingId: string;
  audioPath: string;
  transcriptPath: string;
  transcriptJsonPath: string;
  modelProfile: SmartPuckTranscriptionModel;
  language: string | null;
  denoiseMode?: string;
  normalizeAudio?: boolean;
  requestedAt: number;
}

export interface SmartPuckTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface SmartPuckTranscriptionResult {
  profile: string;
  profile_label: string;
  model: string;
  language: string | null;
  language_probability: number;
  segments: SmartPuckTranscriptSegment[];
  full_text: string;
  quality_flags: string[];
}

export interface SmartPuckDeviceStatus {
  recording: boolean;
  streaming: boolean;
  audioSize: number;
  audioLevel: number;
  network: string;
  networkMode: "ap" | "station" | string;
  ip: string;
  storage: string;
  storageReady: boolean;
  storageMode: "microsd" | "psram" | "none" | string;
  storageFreeBytes: number;
  storageTotalBytes: number;
  firmwareVersion: string;
  lastError: string;
}

export interface SmartPuckDeviceSession {
  sessionPath: string;
  audioPath: string;
  name: string;
  displayName?: string;
  createdAt?: string;
  network?: string;
  ip?: string;
  sizeBytes: number;
  durationSeconds: number;
  uploaded: boolean;
  storageMode: "microsd" | "psram" | string;
}

export interface SmartPuckDeviceSnapshot {
  baseUrl: string;
  status: SmartPuckDeviceStatus;
  sessions: SmartPuckDeviceSession[];
}

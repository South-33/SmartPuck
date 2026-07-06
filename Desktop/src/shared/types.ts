export type MeetingStatus = "imported" | "queued" | "transcribing" | "ready" | "error";

export interface MeetingMetadata {
  schemaVersion: 1;
  id: string;
  title: string;
  workspaceIds: string[];
  sourceFileName: string;
  sourceDevicePath?: string;
  sourceDevice?: {
    transport: "usb" | "wifi";
    firmwareVersion: string;
    sessionName: string;
    network?: string;
    ip?: string;
  };
  audioFile: string;
  processedAudioFile?: string;
  status: MeetingStatus;
  progressPercent?: number;
  progressStage?: string;
  curationStatus: "pending" | "curated";
  summary?: string;
  capturedAt: string;
  updatedAt: string;
  durationSeconds?: number;
  language?: string;
  transcriptionModel?: string;
  denoiseApplied?: boolean;
  denoiseEngine?: string;
  error?: string;
}

export interface Meeting {
  path: string;
  metadata: MeetingMetadata;
  transcript: string;
  audioAvailable: boolean;
}

export interface WorkplaceMetadata {
  schemaVersion: 1;
  id: string;
  name: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Workplace {
  path: string;
  metadata: WorkplaceMetadata;
  meetings: Meeting[];
}

export interface LibrarySnapshot {
  rootPath: string;
  workplaces: Workplace[];
  inbox: Meeting[];
}

export interface DeviceSnapshot {
  baseUrl: string;
  transport: "usb" | "wifi";
  connected: boolean;
  recording: boolean;
  recordingDurationSeconds?: number;
  streaming: boolean;
  firmwareVersion: string;
  storageFreeBytes: number;
  storageTotalBytes: number;
  network?: string;
  ip?: string;
  storageMode?: string;
  sessions: Array<{
    path: string;
    audioPath: string;
    name: string;
    sizeBytes: number;
    durationSeconds: number;
    uploaded: boolean;
    createdAt?: string;
    network?: string;
    ip?: string;
    storageMode?: string;
  }>;
  error?: string;
}

export interface DeviceWifiConfig {
  mode: "station" | "ap";
  network: string;
  ip: string;
  activeSsid: string;
  maxNetworks: number;
  networks: Array<{ ssid: string; active: boolean }>;
}

export interface DeviceSyncProgress {
  path: string;
  name?: string;
  phase: "starting" | "downloading" | "importing" | "queued" | "done" | "error";
  receivedBytes?: number;
  totalBytes?: number;
  message?: string;
}

export interface SmartPuckApi {
  library: {
    snapshot(): Promise<LibrarySnapshot>;
    chooseRoot(): Promise<LibrarySnapshot | null>;
    openRoot(): Promise<void>;
    createWorkplace(name: string): Promise<LibrarySnapshot>;
    renameWorkplace(workplaceId: string, name: string): Promise<LibrarySnapshot>;
    deleteWorkplace(workplaceId: string): Promise<LibrarySnapshot>;
    reorderWorkplaces(workplaceIds: string[]): Promise<LibrarySnapshot>;
    importAudio(paths: string[], workplaceId?: string): Promise<LibrarySnapshot>;
    renameMeeting(meetingId: string, title: string): Promise<LibrarySnapshot>;
    moveMeeting(meetingId: string, workplaceId?: string): Promise<LibrarySnapshot>;
    addMeetingToWorkplace(meetingId: string, workplaceId: string): Promise<LibrarySnapshot>;
    removeMeetingFromWorkplace(meetingId: string, workplaceId: string): Promise<LibrarySnapshot>;
    deleteMeeting(meetingId: string): Promise<LibrarySnapshot>;
    saveTranscript(meetingId: string, transcript: string): Promise<LibrarySnapshot>;
    transcribe(meetingId: string): Promise<LibrarySnapshot>;
    onChanged(callback: () => void): () => void;
  };
  device: {
    connect(baseUrl: string): Promise<DeviceSnapshot>;
    refresh(): Promise<DeviceSnapshot | null>;
    setRecording(action: "start" | "stop"): Promise<DeviceSnapshot>;
    previewAudio(path: string): Promise<string>;
    importSession(path: string, workplaceId?: string): Promise<LibrarySnapshot>;
    importNew(workplaceId?: string): Promise<LibrarySnapshot>;
    renameSession(path: string, name: string): Promise<DeviceSnapshot>;
    deleteSession(path: string): Promise<DeviceSnapshot>;
    wifiConfig(): Promise<DeviceWifiConfig | null>;
    saveWifi(ssid: string, password: string): Promise<void>;
    removeWifi(ssid: string): Promise<void>;
    onChanged(callback: (snapshot: DeviceSnapshot | null) => void): () => void;
    onSyncProgress(callback: (progress: DeviceSyncProgress) => void): () => void;
  };
  dialogs: { chooseAudio(): Promise<string[]> };
}

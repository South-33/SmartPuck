export type WorkspaceShellMode = "demo" | "live";
export type MeetingStatus = "uploaded" | "processing" | "ready";
export type DeviceTransport = "usb" | "bluetooth" | "manual";
export type AccentTone = "silver" | "slate";
export type MessageRole = "user" | "assistant" | "system";

export type MeetingAction = {
  id: string;
  owner: string;
  label: string;
};

export type MeetingMessage = {
  id: string;
  role: MessageRole;
  body: string;
  createdAt: string;
};

export type MeetingRecord = {
  id: string;
  folderId: string;
  title: string;
  durationLabel: string;
  status: MeetingStatus;
  startedAtLabel: string;
  sourceTransport: DeviceTransport;
  summary: string;
  transcriptPreview: string;
  syncStats: {
    percent: number;
    transferredMb: number;
    visuals: number;
    audioHours: number;
  };
  decisions: string[];
  actions: MeetingAction[];
  messages: MeetingMessage[];
};

export type FolderRecord = {
  id: string;
  name: string;
  accent: AccentTone;
  meetings: MeetingRecord[];
};

export type DashboardData = {
  viewer: {
    isAuthenticated: boolean;
    scopeLabel: string;
  };
  activeMeetingId: string | null;
  activeMeeting: MeetingRecord | null;
  folders: FolderRecord[];
};

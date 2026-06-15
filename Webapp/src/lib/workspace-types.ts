export type WorkspaceShellMode = "demo" | "live";
export type MeetingStatus = "uploaded" | "processing" | "ready";
export type DeviceTransport = "usb" | "bluetooth" | "wifi" | "manual";
export type AccentTone = "silver" | "slate";
export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "complete" | "streaming";

export type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;
};

export type MeetingAction = {
  id: string;
  owner: string;
  label: string;
};

export type MeetingMessage = {
  id: string;
  role: MessageRole;
  body: string;
  status?: MessageStatus;
  createdAt: string;
  attachments?: ChatAttachment[];
  reasoning?: string;
};

export type MeetingRecord = {
  id: string;
  folderId: string;
  agentThreadId?: string;
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
  transcriptText?: string;
  audioFileId?: string;
  audioFileName?: string;
  audioUrl?: string;
  transcriptJson?: string;
  pinnedInsights?: Array<{
    id: string;
    title: string;
    htmlContent: string;
    icon?: string;
  }>;
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

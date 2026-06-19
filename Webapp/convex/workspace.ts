import { v } from "convex/values";
import { createThread } from "@convex-dev/agent";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { STARTER_WORKSPACE } from "./smartpuckContext";

const transportValidator = v.union(
  v.literal("usb"),
  v.literal("bluetooth"),
  v.literal("wifi"),
  v.literal("manual"),
);

async function getViewerScope(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  return {
    scopeKey: identity.tokenIdentifier,
    isAuthenticated: true,
  };
}

function starterActionIds(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}-action-${index + 1}`);
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function ensureFolderBelongsToScope(
  ctx: MutationCtx,
  folderId: Id<"folders">,
  scopeKey: string,
) {
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.scopeKey !== scopeKey) {
    throw new Error("Folder not found");
  }
  return folder;
}

async function ensureMeetingBelongsToScope(
  ctx: MutationCtx,
  meetingId: Id<"meetings">,
  scopeKey: string,
) {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting || meeting.scopeKey !== scopeKey) {
    throw new Error("Meeting not found");
  }
  return meeting;
}

export const getDashboard = query({
  args: {
    selectedMeetingId: v.union(v.id("meetings"), v.null()),
  },
  handler: async (ctx, args) => {
    const viewer = await getViewerScope(ctx);
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", viewer.scopeKey))
      .order("desc")
      .take(20);

    const foldersWithMeetings = await Promise.all(
      folders.map(async (folder) => {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_scopeKey_and_folderId_and_updatedAt", (q) =>
            q.eq("scopeKey", viewer.scopeKey).eq("folderId", folder._id),
          )
          .order("desc")
          .take(12);

        const hydratedMeetings = await Promise.all(
          meetings.map(async (meeting) => {
            const audioUrl = meeting.audioFileId
              ? await ctx.storage.getUrl(meeting.audioFileId)
              : null;
            return {
              id: meeting._id,
              folderId: meeting.folderId,
              agentThreadId: meeting.agentThreadId,
              title: meeting.title,
              durationLabel: meeting.durationLabel,
              status: meeting.status,
              startedAtLabel: meeting.startedAtLabel,
              sourceTransport: meeting.sourceTransport,
              summary: meeting.summary,
              transcriptPreview: meeting.transcriptPreview,
              syncStats: {
                percent: meeting.syncPercent,
                transferredMb: meeting.syncTransferredMb,
                visuals: meeting.syncVisuals,
                audioHours: meeting.syncAudioHours,
              },
              decisions: meeting.decisions,
              actions: meeting.actions,
              messages: [],
              audioFileId: meeting.audioFileId,
              audioFileName: meeting.audioFileName,
              audioUrl: audioUrl ?? undefined,
              transcriptText: meeting.transcriptText,
            };
          }),
        );

        return {
          id: folder._id,
          name: folder.name,
          accent: folder.accent,
          meetings: hydratedMeetings,
        };
      }),
    );

    const firstMeeting = foldersWithMeetings.flatMap((folder) => folder.meetings)[0] ?? null;
    const requestedMeeting =
      args.selectedMeetingId !== null ? await ctx.db.get(args.selectedMeetingId) : null;
    const activeMeetingDoc =
      requestedMeeting && requestedMeeting.scopeKey === viewer.scopeKey ? requestedMeeting : null;
    const activeMeetingId = activeMeetingDoc?._id ?? firstMeeting?.id ?? null;

    let activeMeeting = null;

    if (activeMeetingId) {
      const meetingDoc =
        activeMeetingDoc ?? (await ctx.db.get(activeMeetingId as Id<"meetings">));

      if (meetingDoc && meetingDoc.scopeKey === viewer.scopeKey) {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_meetingId_and_createdAt", (q) => q.eq("meetingId", meetingDoc._id))
          .take(40);

        const audioUrl = meetingDoc.audioFileId
          ? await ctx.storage.getUrl(meetingDoc.audioFileId)
          : null;

        activeMeeting = {
          id: meetingDoc._id,
          folderId: meetingDoc.folderId,
          agentThreadId: meetingDoc.agentThreadId,
          title: meetingDoc.title,
          durationLabel: meetingDoc.durationLabel,
          status: meetingDoc.status,
          startedAtLabel: meetingDoc.startedAtLabel,
          sourceTransport: meetingDoc.sourceTransport,
          summary: meetingDoc.summary,
          transcriptPreview: meetingDoc.transcriptPreview,
          syncStats: {
            percent: meetingDoc.syncPercent,
            transferredMb: meetingDoc.syncTransferredMb,
            visuals: meetingDoc.syncVisuals,
            audioHours: meetingDoc.syncAudioHours,
          },
          decisions: meetingDoc.decisions,
          actions: meetingDoc.actions,
          messages: messages.map((message) => ({
            id: message._id,
            role: message.role,
            body: message.body,
            status: message.status ?? "complete",
            createdAt: new Date(message.createdAt).toISOString(),
          })),
          audioFileId: meetingDoc.audioFileId,
          audioFileName: meetingDoc.audioFileName,
          audioUrl: audioUrl ?? undefined,
          transcriptText: meetingDoc.transcriptText,
        };
      }
    }

    const hydratedFolders = foldersWithMeetings.map((folder) => ({
      ...folder,
      meetings: folder.meetings.map((meeting) =>
        meeting.id === activeMeeting?.id ? activeMeeting : meeting,
      ),
    }));

    return {
      viewer: {
        isAuthenticated: viewer.isAuthenticated,
        scopeLabel: viewer.isAuthenticated ? "Authenticated workspace" : "Shared development workspace",
      },
      activeMeetingId: activeMeeting?.id ?? null,
      activeMeeting,
      folders: hydratedFolders,
    };
  },
});

export const seedDemoWorkspace = mutation({
  args: {
    reset: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const viewer = await getViewerScope(ctx);
    const existing = await ctx.db
      .query("folders")
      .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", viewer.scopeKey))
      .take(1);

    if (existing.length > 0 && !args.reset) {
      const firstMeeting = await ctx.db
        .query("meetings")
        .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", viewer.scopeKey))
        .order("desc")
        .take(1);

      return { firstMeetingId: firstMeeting[0]?._id ?? null };
    }

    if (args.reset) {
      await deleteScopedWorkspace(ctx, viewer.scopeKey);
    }

    return await insertStarterWorkspace(ctx, viewer.scopeKey);
  },
});

export const getDefaultDevice = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewerScope(ctx);
    const userDevices = await ctx.db
      .query("devices")
      .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", viewer.scopeKey))
      .order("desc")
      .take(1);
    const globalDevices = await ctx.db
      .query("devices")
      .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", "global-device"))
      .order("desc")
      .take(1);

    const device = userDevices[0] ?? globalDevices[0];
    if (!device) {
      return null;
    }

    return {
      id: device._id,
      name: device.name,
      baseUrl: device.baseUrl,
      localIp: device.localIp ?? null,
      mac: device.mac ?? null,
      network: device.network ?? null,
      mode: device.mode ?? null,
      firmwareVersion: device.firmwareVersion ?? null,
      lastStatus: device.lastStatus,
      lastSeenAt: device.lastSeenAt,
    };
  },
});

export const recordDeviceHeartbeat = internalMutation({
  args: {
    baseUrl: v.string(),
    localIp: v.optional(v.string()),
    mac: v.optional(v.string()),
    network: v.optional(v.string()),
    mode: v.optional(v.string()),
    firmwareVersion: v.optional(v.string()),
    lastStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const baseUrl = args.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[a-zA-Z0-9.:-]+$/.test(baseUrl)) {
      throw new Error("Invalid SmartPuck address");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", "global-device"))
      .order("desc")
      .take(1);

    const device = existing[0];
    const patch = {
      baseUrl,
      localIp: args.localIp,
      mac: args.mac,
      network: args.network,
      mode: args.mode,
      firmwareVersion: args.firmwareVersion,
      lastStatus: args.lastStatus.slice(0, 240),
      lastSeenAt: now,
      updatedAt: now,
    };

    if (device) {
      await ctx.db.patch(device._id, patch);
      return device._id;
    }

    return await ctx.db.insert("devices", {
      scopeKey: "global-device",
      name: "SmartPuck",
      ...patch,
    });
  },
});

async function deleteScopedWorkspace(ctx: MutationCtx, scopeKey: string) {
  const folders = await ctx.db
    .query("folders")
    .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", scopeKey))
    .take(100);

  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", scopeKey))
    .take(200);

  for (const meeting of meetings) {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_meetingId_and_createdAt", (q) => q.eq("meetingId", meeting._id))
      .take(200);

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    await ctx.db.delete(meeting._id);
  }

  for (const folder of folders) {
    await ctx.db.delete(folder._id);
  }
}

async function insertStarterWorkspace(ctx: MutationCtx, scopeKey: string) {
  const now = Date.now();
  let firstMeetingId: Id<"meetings"> | null = null;

  for (const [index, starter] of STARTER_WORKSPACE.entries()) {
    const folderId = await ctx.db.insert("folders", {
      scopeKey,
      name: starter.folderName,
      accent: "silver",
      slug: slugify(starter.folderName) || `starter-folder-${index}`,
      updatedAt: now - index * 1_000,
    });

    const actionIds = starterActionIds(`starter-${index}`, starter.actions.length);
    const meetingId = await ctx.db.insert("meetings", {
      scopeKey,
      folderId,
      title: starter.meetingTitle,
      durationLabel: starter.durationLabel,
      status: "ready",
      startedAtLabel: starter.startedAtLabel,
      sourceTransport: index === 0 ? "usb" : "bluetooth",
      summary: starter.summary,
      transcriptPreview: starter.transcriptPreview,
      syncPercent: 100,
      syncTransferredMb: starter.syncTransferredMb,
      syncVisuals: starter.syncVisuals,
      syncAudioHours: starter.syncAudioHours,
      decisions: starter.decisions,
      actions: starter.actions.map((action, actionIndex) => ({
        id: actionIds[actionIndex],
        owner: action.owner,
        label: action.label,
      })),
      transcriptText: starter.transcriptText,
      updatedAt: now - index * 1_000,
    });

    await ctx.db.insert("messages", {
      scopeKey,
      meetingId,
      role: "assistant",
      body: starter.openingMessage,
      status: "complete",
      createdAt: now - index * 1_000,
    });

    firstMeetingId ??= meetingId;
  }

  return { firstMeetingId };
}

export const createFolder = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const trimmed = args.name.trim();
    if (trimmed.length < 2) {
      throw new Error("Folder name must be at least 2 characters");
    }

    const viewer = await getViewerScope(ctx);
    const now = Date.now();

    const id = await ctx.db.insert("folders", {
      scopeKey: viewer.scopeKey,
      name: trimmed,
      accent: "silver",
      slug: slugify(trimmed) || `folder-${now}`,
      updatedAt: now,
    });

    return id;
  },
});

export const createChatInFolder = mutation({
  args: {
    folderId: v.id("folders"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await getViewerScope(ctx);
    const folder = await ensureFolderBelongsToScope(ctx, args.folderId, viewer.scopeKey);
    const now = Date.now();
    const trimmedTitle = args.title?.trim();
    const title = trimmedTitle && trimmedTitle.length >= 2 ? trimmedTitle : "New SmartPuck Chat";
    const agentThreadId = await createThread(ctx, components.agent, {
      userId: viewer.scopeKey,
      title,
      summary:
        "Saved SmartPuck chat grounded in the meetings and transcripts inside this folder.",
    });

    const meetingId = await ctx.db.insert("meetings", {
      scopeKey: viewer.scopeKey,
      folderId: folder._id,
      agentThreadId,
      title,
      durationLabel: "0m",
      status: "ready",
      startedAtLabel: "Just now",
      sourceTransport: "manual",
      summary:
        "A saved chat thread for asking questions about SmartPuck recordings, transcripts, and meeting decisions inside this folder.",
      transcriptPreview:
        "Use this chat to ask about meetings in this folder. SmartPuck will search transcripts when it needs meeting details.",
      syncPercent: 100,
      syncTransferredMb: 0,
      syncVisuals: 0,
      syncAudioHours: 0,
      decisions: [
        "Use this chat to ask about recordings and transcripts saved in this folder.",
      ],
      actions: [
        {
          id: `chat-action-${now}`,
          owner: "SmartPuck",
          label: "Ask a question about device capture, USB transfer, AI notes, or export workflows.",
        },
      ],
      updatedAt: now,
    });

    await ctx.db.patch(folder._id, { updatedAt: now });

    return meetingId;
  },
});

export const deleteMeeting = mutation({
  args: {
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const viewer = await getViewerScope(ctx);
    const meeting = await ensureMeetingBelongsToScope(ctx, args.meetingId, viewer.scopeKey);
    const folderId = meeting.folderId;
    const now = Date.now();

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_meetingId_and_createdAt", (q) => q.eq("meetingId", meeting._id))
      .take(200);

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    await ctx.db.delete(meeting._id);
    await ctx.db.patch(folderId, { updatedAt: now });

    const nextMeeting = await ctx.db
      .query("meetings")
      .withIndex("by_scopeKey_and_folderId_and_updatedAt", (q) =>
        q.eq("scopeKey", viewer.scopeKey).eq("folderId", folderId),
      )
      .order("desc")
      .take(1);

    return nextMeeting[0]?._id ?? null;
  },
});

export const deleteFolder = mutation({
  args: {
    folderId: v.id("folders"),
  },
  handler: async (ctx, args) => {
    const viewer = await getViewerScope(ctx);
    const folder = await ensureFolderBelongsToScope(ctx, args.folderId, viewer.scopeKey);

    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_scopeKey_and_folderId_and_updatedAt", (q) =>
        q.eq("scopeKey", viewer.scopeKey).eq("folderId", folder._id),
      )
      .take(100);

    for (const meeting of meetings) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_meetingId_and_createdAt", (q) => q.eq("meetingId", meeting._id))
        .take(200);

      for (const message of messages) {
        await ctx.db.delete(message._id);
      }

      await ctx.db.delete(meeting._id);
    }

    await ctx.db.delete(folder._id);

    const nextMeeting = await ctx.db
      .query("meetings")
      .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", viewer.scopeKey))
      .order("desc")
      .take(1);

    return nextMeeting[0]?._id ?? null;
  },
});

export const createMeetingFromDeviceSync = mutation({
  args: {
    folderId: v.id("folders"),
    transport: transportValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await getViewerScope(ctx);
    const folder = await ensureFolderBelongsToScope(ctx, args.folderId, viewer.scopeKey);
    const now = Date.now();

    const transportLabels = {
      usb: {
        title: "Desk Sync Capture",
        durationLabel: "41m",
        transferredMb: 128,
        audioHours: 1.9,
      },
      bluetooth: {
        title: "Bluetooth Walk-In Capture",
        durationLabel: "33m",
        transferredMb: 74,
        audioHours: 1.2,
      },
      wifi: {
        title: "Wi-Fi Live Recording",
        durationLabel: "0m",
        transferredMb: 0,
        audioHours: 0,
      },
      manual: {
        title: "Imported Recording",
        durationLabel: "0m",
        transferredMb: 0,
        audioHours: 0,
      },
    }[args.transport];

    const mockTranscripts = {
      wifi: `[15:10:02] Elena (AI): Starting the Wi-Fi live stream test. Can you hear the audio?
[15:10:12] Alex (Frontend): Yes, the 16-bit 16kHz PCM stream is playing through the Web Audio API with very low latency—about 30 milliseconds.
[15:10:30] Elena (AI): Great! The onboard SD card is recording in parallel.
[15:10:45] Alex (Frontend): I can see the connection status is green, and I can download the WAV file now. Works perfectly.`,
      usb: `[09:30:05] Sarah (Product): Let's verify the USB mass storage mode on the SmartPuck.
[09:30:15] John (Hardware): When plugged in, the ESP32 MSC driver exposes the microSD card as a USB drive. The browser app reads it directly.
[09:31:00] Dave (Firmware): I've verified the sector read/write speed. It's solid and works even if the partition format is corrupted because we expose raw block access.`,
      bluetooth: `[11:00:10] John (Hardware): Testing Bluetooth connection. The puck is advertising its sync service.
[11:00:30] Alex (Frontend): I'm able to pair with the puck from the browser using Web Bluetooth.
[11:00:45] John (Hardware): Outstanding. We can sync metadata and trigger recording starts over BLE.`,
      manual: `[13:00:05] Professor: Today we will cover design systems at scale.
[13:00:20] Student: Can we import legacy CSS directly into Figma tokens?
[13:01:00] Professor: Yes, we use automated style parsers to extract colors and typography, mapping them to variables.`,
    }[args.transport];

    const meetingId = await ctx.db.insert("meetings", {
      scopeKey: viewer.scopeKey,
      folderId: folder._id,
      title: transportLabels.title,
      durationLabel: transportLabels.durationLabel,
      status: "uploaded",
      startedAtLabel: "Just now",
      sourceTransport: args.transport,
      summary:
        args.transport === "wifi"
          ? "A live SmartPuck Wi-Fi recording was saved locally on this computer and linked to the selected folder."
          : "A SmartPuck recording was imported and linked to this folder for follow-up chat.",
      transcriptPreview:
        args.transport === "wifi"
          ? "Audio was captured from the device stream. Import the saved WAV when you want local transcription attached to this meeting."
          : "Recording received. Import or transcribe audio locally to attach searchable transcript text.",
      syncPercent: 100,
      syncTransferredMb: transportLabels.transferredMb,
      syncVisuals: 0,
      syncAudioHours: transportLabels.audioHours,
      decisions: [
        "Keep each recording attached to the folder selected at ingest time.",
        "Keep each upload attached to one folder to avoid cross-folder ambiguity.",
      ],
      actions: [
        {
          id: `sync-action-${now}-1`,
          owner: "Backend",
          label: "Attach transcript processing job once the pipeline exists",
        },
        {
          id: `sync-action-${now}-2`,
          owner: "Product",
          label: "Pick auth provider before exposing uploads publicly",
        },
      ],
      transcriptText: mockTranscripts,
      updatedAt: now,
    });

    await ctx.db.patch(folder._id, { updatedAt: now });

    await ctx.db.insert("messages", {
      scopeKey: viewer.scopeKey,
      meetingId,
      role: "assistant",
      body:
        "The recording is linked to this folder. Import or transcribe the audio to make the chat answer from transcript text.",
      status: "complete",
      createdAt: now,
    });

    return meetingId;
  },
});

export const getMeetingContext = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    scopeKey: v.string(),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting || meeting.scopeKey !== args.scopeKey) {
      throw new Error("Meeting not found");
    }

    const folder = await ctx.db.get(meeting.folderId);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_meetingId_and_createdAt", (q) => q.eq("meetingId", meeting._id))
      .take(20);

    return {
      folderName: folder?.name ?? "Unknown folder",
      meetingTitle: meeting.title,
      summary: meeting.summary,
      transcriptPreview: meeting.transcriptPreview,
      decisions: meeting.decisions,
      actions: meeting.actions,
      recentMessages: messages.map((message) => ({
        role: message.role,
        body: message.body,
      })),
    };
  },
});

export const ensureMeetingAgentThread = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    scopeKey: v.string(),
  },
  handler: async (ctx, args) => {
    const meeting = await ensureMeetingBelongsToScope(ctx, args.meetingId, args.scopeKey);
    if (meeting.agentThreadId) {
      return meeting.agentThreadId;
    }

    const agentThreadId = await createThread(ctx, components.agent, {
      userId: args.scopeKey,
      title: meeting.title,
      summary: meeting.summary,
    });

    await ctx.db.patch(meeting._id, { agentThreadId });
    return agentThreadId;
  },
});

export const getMeetingByThread = internalQuery({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("meetings")
      .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", args.threadId))
      .unique();
  },
});

export const listMeetingsInFolder = internalQuery({
  args: {
    folderId: v.id("folders"),
  },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      return [];
    }

    const scopedMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_scopeKey_and_folderId_and_updatedAt", (q) =>
        q.eq("scopeKey", folder.scopeKey).eq("folderId", args.folderId),
      )
      .collect();

    return scopedMeetings.map((m) => ({
      meetingId: m._id,
      title: m.title,
      startedAtLabel: m.startedAtLabel,
      durationLabel: m.durationLabel,
      summary: m.summary,
    }));
  },
});

export const searchTranscriptsInFolder = internalQuery({
  args: {
    folderId: v.id("folders"),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      return [];
    }

    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_scopeKey_and_folderId_and_updatedAt", (q) =>
        q.eq("scopeKey", folder.scopeKey).eq("folderId", args.folderId),
      )
      .collect();

    const searchLower = args.query.toLowerCase().trim();
    if (!searchLower) {
      return [];
    }

    const results: Array<{
      meetingId: string;
      meetingTitle: string;
      line: string;
    }> = [];

    for (const meeting of meetings) {
      const text = meeting.transcriptText;
      if (!text) {
        continue;
      }

      const lines = text.split("\n");
      for (const line of lines) {
        if (line.toLowerCase().includes(searchLower)) {
          results.push({
            meetingId: meeting._id,
            meetingTitle: meeting.title,
            line: line.trim(),
          });
        }
      }
    }

    return results.slice(0, 30);
  },
});

export const getMeetingTranscript = internalQuery({
  args: {
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      return null;
    }
    return {
      title: meeting.title,
      transcriptText: meeting.transcriptText ?? "No transcript available.",
    };
  },
});

export const updateMeetingInsights = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    insights: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        htmlContent: v.string(),
        icon: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.meetingId, {
      pinnedInsights: args.insights,
    });
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const createMeetingWithAudio = mutation({
  args: {
    folderId: v.id("folders"),
    title: v.string(),
    transport: transportValidator,
    audioFileId: v.optional(v.id("_storage")),
    audioFileName: v.optional(v.string()),
    transcriptText: v.string(),
    transcriptJson: v.optional(v.string()),
    durationLabel: v.string(),
    transferredMb: v.number(),
    audioHours: v.number(),
  },
  handler: async (ctx, args) => {
    const viewer = await getViewerScope(ctx);
    const folder = await ensureFolderBelongsToScope(ctx, args.folderId, viewer.scopeKey);
    const now = Date.now();

    const lines = args.transcriptText.split("\n");
    const transcriptPreview = lines.slice(0, 3).join("\n") || "No preview available.";

    const meetingId = await ctx.db.insert("meetings", {
      scopeKey: viewer.scopeKey,
      folderId: folder._id,
      title: args.title,
      durationLabel: args.durationLabel,
      status: "ready",
      startedAtLabel: "Just now",
      sourceTransport: args.transport,
      summary: "Local audio session transcribed on the laptop and saved to this folder.",
      transcriptPreview,
      syncPercent: 100,
      syncTransferredMb: args.transferredMb,
      syncVisuals: 0,
      syncAudioHours: args.audioHours,
      decisions: [
        "Transcribe locally using Whisper to keep voice data private.",
        "Store transcript text inside the selected folder."
      ],
      actions: [],
      transcriptText: args.transcriptText,
      audioFileId: args.audioFileId,
      audioFileName: args.audioFileName,
      transcriptJson: args.transcriptJson,
      updatedAt: now,
    });

    await ctx.db.patch(folder._id, { updatedAt: now });

    await ctx.db.insert("messages", {
      scopeKey: viewer.scopeKey,
      meetingId,
      role: "assistant",
      body: `The recording "${args.title}" was transcribed locally and saved here. Ask me anything about this session.`,
      status: "complete",
      createdAt: now,
    });

    return meetingId;
  },
});

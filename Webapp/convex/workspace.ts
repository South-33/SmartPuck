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

        return {
          id: folder._id,
          name: folder.name,
          accent: folder.accent,
          meetings: meetings.map((meeting) => ({
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
          })),
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
        "Saved SmartPuck chat grounded in the proposal until transcript processing is connected.",
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
        "A saved chat thread for asking SmartPuck product, hardware, and meeting intelligence questions inside this folder.",
      transcriptPreview:
        "This chat is grounded in the SmartPuck proposal until a real meeting transcript is uploaded.",
      syncPercent: 100,
      syncTransferredMb: 0,
      syncVisuals: 0,
      syncAudioHours: 0,
      decisions: [
        "Use this chat to explore SmartPuck capabilities before real audio processing is connected.",
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

export const createMeetingFromDeviceSync = mutation({
  args: {
    folderId: v.id("folders"),
    transport: transportValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await getViewerScope(ctx);
    const folder = await ensureFolderBelongsToScope(ctx, args.folderId, viewer.scopeKey);
    const now = Date.now();

    const meetingId = await ctx.db.insert("meetings", {
      scopeKey: viewer.scopeKey,
      folderId: folder._id,
      title: args.transport === "usb" ? "Desk Sync Capture" : "Bluetooth Walk-In Capture",
      durationLabel: args.transport === "usb" ? "41m" : "33m",
      status: "uploaded",
      startedAtLabel: "Just now",
      sourceTransport: args.transport,
      summary:
        "Meeting metadata uploaded from SmartPuck. The audio processing pipeline is intentionally not wired yet, but the session shell is ready for follow-up chat and folder organization.",
      transcriptPreview:
        "Raw capture received. Transcript and summary generation will attach here once the processing backend exists.",
      syncPercent: 100,
      syncTransferredMb: args.transport === "usb" ? 128 : 74,
      syncVisuals: 0,
      syncAudioHours: args.transport === "usb" ? 1.9 : 1.2,
      decisions: [
        "Capture ingest metadata now so future background processing has stable inputs.",
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
      updatedAt: now,
    });

    await ctx.db.patch(folder._id, { updatedAt: now });

    await ctx.db.insert("messages", {
      scopeKey: viewer.scopeKey,
      meetingId,
      role: "assistant",
      body:
        "The device sync completed and the meeting shell is created. Ask structural questions now, and transcript-grounded answers can plug in later.",
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

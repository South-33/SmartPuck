import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewerScope(ctx);
    const existing = await ctx.db
      .query("folders")
      .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", viewer.scopeKey))
      .take(1);

    if (existing.length > 0) {
      const firstMeeting = await ctx.db
        .query("meetings")
        .withIndex("by_scopeKey_and_updatedAt", (q) => q.eq("scopeKey", viewer.scopeKey))
        .order("desc")
        .take(1);

      return { firstMeetingId: firstMeeting[0]?._id ?? null };
    }

    const now = Date.now();

    const q3FolderId = await ctx.db.insert("folders", {
      scopeKey: viewer.scopeKey,
      name: "Q3 Strategy",
      accent: "silver",
      slug: "q3-strategy",
      updatedAt: now,
    });

    const googleFolderId = await ctx.db.insert("folders", {
      scopeKey: viewer.scopeKey,
      name: "Google Meetings",
      accent: "silver",
      slug: "google-meetings",
      updatedAt: now - 1_000,
    });

    const q3MeetingId = await ctx.db.insert("meetings", {
      scopeKey: viewer.scopeKey,
      folderId: q3FolderId,
      title: "Q3 Strategy Meeting",
      durationLabel: "45m",
      status: "ready",
      startedAtLabel: "Today",
      sourceTransport: "usb",
      summary:
        "The initial milestone is focused on ingest, folders, and per-meeting chat. Transcript-aware answers will plug in later without changing the workspace shape.",
      transcriptPreview:
        "Approved Berlin expansion budget, parked APAC discussion, and assigned follow-up for legal and tax review.",
      syncPercent: 100,
      syncTransferredMb: 83,
      syncVisuals: 12,
      syncAudioHours: 1.5,
      decisions: [
        "Keep the first release centered on clean upload and organization flows.",
        "Do not hard-wire audio processing into the current schema yet.",
      ],
      actions: [
        {
          id: "q3-action-1",
          owner: "Product",
          label: "Choose auth provider before production hardening",
        },
        {
          id: "q3-action-2",
          owner: "Backend",
          label: "Attach transcript job after ingest metadata is stable",
        },
      ],
      updatedAt: now,
    });

    await ctx.db.insert("messages", {
      scopeKey: viewer.scopeKey,
      meetingId: q3MeetingId,
      role: "assistant",
      body:
        "The workspace is ready for uploads, folders, and a session thread. Transcript-grounded answers will connect after the audio pipeline exists.",
      createdAt: now,
    });

    await ctx.db.insert("messages", {
      scopeKey: viewer.scopeKey,
      meetingId: q3MeetingId,
      role: "user",
      body: "What is intentionally out of scope for this milestone?",
      createdAt: now + 1_000,
    });

    await ctx.db.insert("messages", {
      scopeKey: viewer.scopeKey,
      meetingId: q3MeetingId,
      role: "assistant",
      body:
        "Automatic transcript generation, summarization, and folder-wide retrieval are deferred. The current milestone is about durable ingest and clean organization.",
      createdAt: now + 2_000,
    });

    const googleMeetingId = await ctx.db.insert("meetings", {
      scopeKey: viewer.scopeKey,
      folderId: googleFolderId,
      title: "Product Sync - Google",
      durationLabel: "30m",
      status: "uploaded",
      startedAtLabel: "Yesterday",
      sourceTransport: "bluetooth",
      summary:
        "Uploaded from Bluetooth on arrival. The meeting shell exists so future processing can attach transcript and summary artifacts without reshaping the product.",
      transcriptPreview:
        "Raw meeting metadata captured. Transcript generation remains a follow-on milestone.",
      syncPercent: 100,
      syncTransferredMb: 52,
      syncVisuals: 6,
      syncAudioHours: 0.8,
      decisions: ["Keep auth swappable and avoid provider-specific coupling before the choice is made."],
      actions: [
        {
          id: "google-action-1",
          owner: "Infra",
          label: "Prepare Vercel environment variables once auth is chosen",
        },
      ],
      updatedAt: now - 1_000,
    });

    await ctx.db.insert("messages", {
      scopeKey: viewer.scopeKey,
      meetingId: googleMeetingId,
      role: "assistant",
      body:
        "This session is organized and ready. The future audio job can populate transcript snippets and higher-confidence chat responses.",
      createdAt: now - 1_000,
    });

    return { firstMeetingId: q3MeetingId };
  },
});

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
      syncVisuals: args.transport === "usb" ? 18 : 11,
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
      createdAt: now,
    });

    return meetingId;
  },
});

export const sendMessage = mutation({
  args: {
    meetingId: v.id("meetings"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await getViewerScope(ctx);
    const meeting = await ensureMeetingBelongsToScope(ctx, args.meetingId, viewer.scopeKey);
    const trimmed = args.body.trim();

    if (!trimmed) {
      throw new Error("Message body cannot be empty");
    }

    const now = Date.now();

    await ctx.db.insert("messages", {
      scopeKey: viewer.scopeKey,
      meetingId: meeting._id,
      role: "user",
      body: trimmed,
      createdAt: now,
    });

    await ctx.db.insert("messages", {
      scopeKey: viewer.scopeKey,
      meetingId: meeting._id,
      role: "assistant",
      body: `I can help organize "${meeting.title}" and preserve the thread shape today. Transcript-aware answers and deeper meeting intelligence are still deferred until the audio processing milestone ships.`,
      createdAt: now + 1,
    });

    await ctx.db.patch(meeting._id, { updatedAt: now + 1 });

    return null;
  },
});

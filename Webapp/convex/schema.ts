import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const accentValidator = v.union(v.literal("silver"), v.literal("slate"));
const meetingStatusValidator = v.union(
  v.literal("uploaded"),
  v.literal("processing"),
  v.literal("ready"),
);
const transportValidator = v.union(
  v.literal("usb"),
  v.literal("bluetooth"),
  v.literal("manual"),
);
const messageRoleValidator = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("system"),
);

export default defineSchema({
  folders: defineTable({
    scopeKey: v.string(),
    name: v.string(),
    accent: accentValidator,
    slug: v.string(),
    updatedAt: v.number(),
  })
    .index("by_scopeKey_and_updatedAt", ["scopeKey", "updatedAt"])
    .index("by_scopeKey_and_slug", ["scopeKey", "slug"]),

  meetings: defineTable({
    scopeKey: v.string(),
    folderId: v.id("folders"),
    title: v.string(),
    durationLabel: v.string(),
    status: meetingStatusValidator,
    startedAtLabel: v.string(),
    sourceTransport: transportValidator,
    summary: v.string(),
    transcriptPreview: v.string(),
    syncPercent: v.number(),
    syncTransferredMb: v.number(),
    syncVisuals: v.number(),
    syncAudioHours: v.number(),
    decisions: v.array(v.string()),
    actions: v.array(
      v.object({
        id: v.string(),
        owner: v.string(),
        label: v.string(),
      }),
    ),
    updatedAt: v.number(),
  })
    .index("by_scopeKey_and_updatedAt", ["scopeKey", "updatedAt"])
    .index("by_scopeKey_and_folderId_and_updatedAt", ["scopeKey", "folderId", "updatedAt"]),

  messages: defineTable({
    scopeKey: v.string(),
    meetingId: v.id("meetings"),
    role: messageRoleValidator,
    body: v.string(),
    createdAt: v.number(),
  }).index("by_meetingId_and_createdAt", ["meetingId", "createdAt"]),
});

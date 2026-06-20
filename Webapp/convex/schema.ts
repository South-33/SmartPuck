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
  v.literal("wifi"),
  v.literal("manual"),
);
const messageRoleValidator = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("system"),
);
const messageStatusValidator = v.union(
  v.literal("complete"),
  v.literal("streaming"),
  v.literal("error"),
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
    agentThreadId: v.optional(v.string()),
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
    transcriptText: v.optional(v.string()),
    audioFileId: v.optional(v.id("_storage")),
    audioFileName: v.optional(v.string()),
    transcriptJson: v.optional(v.string()),
    deviceSessionKey: v.optional(v.string()),
    deviceSessionPath: v.optional(v.string()),
    pinnedInsights: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          htmlContent: v.string(),
          icon: v.optional(v.string()),
        }),
      ),
    ),
    updatedAt: v.number(),
  })
    .index("by_scopeKey_and_updatedAt", ["scopeKey", "updatedAt"])
    .index("by_scopeKey_and_folderId_and_updatedAt", ["scopeKey", "folderId", "updatedAt"])
    .index("by_scopeKey_and_deviceSessionKey", ["scopeKey", "deviceSessionKey"])
    .index("by_agentThreadId", ["agentThreadId"]),

  messages: defineTable({
    scopeKey: v.string(),
    meetingId: v.id("meetings"),
    role: messageRoleValidator,
    body: v.string(),
    status: v.optional(messageStatusValidator),
    createdAt: v.number(),
  }).index("by_meetingId_and_createdAt", ["meetingId", "createdAt"]),

  devices: defineTable({
    scopeKey: v.string(),
    name: v.string(),
    baseUrl: v.string(),
    localIp: v.optional(v.string()),
    mac: v.optional(v.string()),
    network: v.optional(v.string()),
    mode: v.optional(v.string()),
    firmwareVersion: v.optional(v.string()),
    storage: v.optional(v.string()),
    storageReady: v.optional(v.boolean()),
    storageMode: v.optional(v.string()),
    storageFreeBytes: v.optional(v.number()),
    storageTotalBytes: v.optional(v.number()),
    batteryPercent: v.optional(v.number()),
    batteryCharging: v.optional(v.boolean()),
    lastStatus: v.string(),
    lastSeenAt: v.number(),
    updatedAt: v.number(),
  }).index("by_scopeKey_and_updatedAt", ["scopeKey", "updatedAt"]),
});

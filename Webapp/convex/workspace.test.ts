// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import agentTest from "@convex-dev/agent/test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function authedTest() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  return t.withIdentity({
    subject: "user_123",
    issuer: "https://first-turtle-32.clerk.accounts.dev",
    tokenIdentifier: "clerk|user_123",
    email: "owner@smartpuck.dev",
    name: "Smart Puck Owner",
  });
}

describe("workspace Convex functions", () => {
  test("rejects unauthenticated dashboard access", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.workspace.getDashboard, { selectedMeetingId: null }),
    ).rejects.toThrow("Not authenticated");
  });

  test("seeds and reads a first authenticated workspace", async () => {
    const t = authedTest();

    const seeded = await t.mutation(api.workspace.seedDemoWorkspace, {});
    const dashboard = await t.query(api.workspace.getDashboard, {
      selectedMeetingId: seeded.firstMeetingId,
    });

    expect(seeded.firstMeetingId).toBeTruthy();
    expect(dashboard.viewer.isAuthenticated).toBe(true);
    expect(dashboard.folders).toHaveLength(2);
    expect(dashboard.activeMeeting?.title).toBe("Hardware MVP Review");
    expect(dashboard.activeMeeting?.messages).toHaveLength(1);
    expect(dashboard.folders.map((folder: { name: string }) => folder.name)).toEqual([
      "Device Prototype",
      "AI Processing",
    ]);
  });

  test("creates folders, saved chats, and device-synced meetings inside one user scope", async () => {
    const t = authedTest();

    await t.mutation(api.workspace.seedDemoWorkspace, {});
    await t.mutation(api.workspace.createFolder, { name: "Test Folder" });

    const afterFolder = await t.query(api.workspace.getDashboard, {
      selectedMeetingId: null,
    });
    const folder = afterFolder.folders.find((entry: { name: string }) => entry.name === "Test Folder");

    expect(folder).toBeTruthy();

    const chatId = await t.mutation(api.workspace.createChatInFolder, {
      folderId: folder!.id,
    });
    const afterChat = await t.query(api.workspace.getDashboard, {
      selectedMeetingId: chatId,
    });

    expect(afterChat.activeMeeting?.title).toBe("New SmartPuck Chat");
    expect(afterChat.activeMeeting?.messages).toHaveLength(0);

    const meetingId = await t.mutation(api.workspace.createMeetingFromDeviceSync, {
      folderId: folder!.id,
      transport: "usb",
    });

    const afterSync = await t.query(api.workspace.getDashboard, {
      selectedMeetingId: meetingId,
    });

    expect(afterSync.activeMeeting?.title).toBe("Desk Sync Capture");
    expect(afterSync.activeMeeting?.messages).toHaveLength(1);
    expect(afterSync.activeMeeting?.messages[0]?.body).toMatch(/device sync completed/i);

    const nextMeetingId = await t.mutation(api.workspace.deleteMeeting, { meetingId });
    const afterDelete = await t.query(api.workspace.getDashboard, {
      selectedMeetingId: nextMeetingId,
    });

    expect(afterDelete.activeMeeting?.id).not.toBe(meetingId);
  });
});

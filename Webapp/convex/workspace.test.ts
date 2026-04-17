// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function authedTest() {
  return convexTest(schema, modules).withIdentity({
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
    expect(dashboard.activeMeeting?.title).toBe("Q3 Strategy Meeting");
    expect(dashboard.activeMeeting?.messages).toHaveLength(3);
  });

  test("creates folders, device-synced meetings, and chat replies inside one user scope", async () => {
    const t = authedTest();

    await t.mutation(api.workspace.seedDemoWorkspace, {});
    await t.mutation(api.workspace.createFolder, { name: "Test Folder" });

    const afterFolder = await t.query(api.workspace.getDashboard, {
      selectedMeetingId: null,
    });
    const folder = afterFolder.folders.find((entry) => entry.name === "Test Folder");

    expect(folder).toBeTruthy();

    const meetingId = await t.mutation(api.workspace.createMeetingFromDeviceSync, {
      folderId: folder!.id,
      transport: "usb",
    });

    await t.mutation(api.workspace.sendMessage, {
      meetingId,
      body: "What still needs to be built?",
    });

    const afterMessage = await t.query(api.workspace.getDashboard, {
      selectedMeetingId: meetingId,
    });

    expect(afterMessage.activeMeeting?.title).toBe("Desk Sync Capture");
    expect(afterMessage.activeMeeting?.messages).toHaveLength(3);
    expect(afterMessage.activeMeeting?.messages.at(-1)?.body).toMatch(/Transcript-aware answers/i);
  });
});

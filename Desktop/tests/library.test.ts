import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(join(tmpdir(), "smartpuck-library-test-"));
vi.mock("electron", () => ({ app: { getPath: () => root } }));

let library: typeof import("../src/main/library");
beforeAll(async () => {
  process.env.SMARTPUCK_HOME = root;
  library = await import("../src/main/library");
});
afterAll(() => {
  delete process.env.SMARTPUCK_HOME;
  rmSync(root, { recursive: true, force: true });
});

describe("filesystem-first meeting library", () => {
  it("keeps stable identity through import, move, rename, and agent edits", () => {
    const audio = join(root, "sample.wav");
    writeFileSync(audio, Buffer.from("RIFF test audio"));

    let state = library.createWorkplace("Acme Research");
    const workplace = state.workplaces[0];
    state = library.createWorkplace("Strategy");
    const linkedWorkplace = state.workplaces.find((item) => item.metadata.name === "Strategy")!;
    state = library.importAudio([audio]);
    const imported = state.inbox[0];
    const stableId = imported.metadata.id;
    expect(readFileSync(join(root, "NEW.md"), "utf8")).toContain("Pending: 1");
    expect(readFileSync(join(root, "NEW.md"), "utf8")).toContain(imported.metadata.title);

    state = library.moveMeeting(stableId, workplace.metadata.id);
    state = library.renameMeeting(stableId, "Monday Product Review");
    const moved = state.workplaces[0].meetings[0];
    expect(moved.metadata.id).toBe(stableId);
    expect(moved.path).toContain("monday-product-review");
    expect(readFileSync(join(moved.path, "transcript.md"), "utf8")).toMatch(/^# Monday Product Review/);
    library.updateMeetingMetadata(stableId, { workspaceIds: [workplace.metadata.id, linkedWorkplace.metadata.id] });
    state = library.snapshot();
    expect(state.workplaces.find((item) => item.metadata.id === linkedWorkplace.metadata.id)?.meetings[0].metadata.id).toBe(stableId);

    const agentEdit = "# Monday Product Review\n\n## Summary\n\nLaunch approved.\n\n## Transcript\n\n[00:00:03] Ship it.\n";
    writeFileSync(join(moved.path, "transcript.md"), agentEdit);
    state = library.snapshot();
    expect(state.workplaces[0].meetings[0].transcript).toBe(agentEdit);
    library.updateMeetingMetadata(stableId, { curationStatus: "curated", summary: "Launch approved." });
    library.snapshot();
    expect(readFileSync(join(root, "NEW.md"), "utf8")).toContain("Pending: 0");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("Start with NEW.md");
    expect(readFileSync(join(root, ".agents", "skills", "smartpuck-meetings", "SKILL.md"), "utf8")).toContain("name: smartpuck-meetings");
  });

  it("renames, reorders, links, unlinks, and retires workplaces without copying meetings", () => {
    const audio = join(root, "playlist-sample.wav");
    writeFileSync(audio, Buffer.from("RIFF playlist audio"));

    let state = library.createWorkplace("Client A");
    state = library.createWorkplace("Planning");
    const client = state.workplaces.find((item) => item.metadata.name === "Client A")!;
    const planning = state.workplaces.find((item) => item.metadata.name === "Planning")!;

    state = library.importAudio([audio]);
    const meetingId = state.inbox[0].metadata.id;
    state = library.addMeetingToWorkplace(meetingId, client.metadata.id);
    expect(state.inbox).toHaveLength(0);
    expect(state.workplaces.find((item) => item.metadata.id === client.metadata.id)?.meetings[0].metadata.id).toBe(meetingId);

    state = library.addMeetingToWorkplace(meetingId, planning.metadata.id);
    expect(state.workplaces.find((item) => item.metadata.id === planning.metadata.id)?.meetings[0].metadata.id).toBe(meetingId);

    state = library.removeMeetingFromWorkplace(meetingId, planning.metadata.id);
    expect(state.workplaces.find((item) => item.metadata.id === planning.metadata.id)?.meetings).toHaveLength(0);

    state = library.renameWorkplace(client.metadata.id, "Client Alpha");
    expect(state.workplaces.find((item) => item.metadata.id === client.metadata.id)?.metadata.name).toBe("Client Alpha");
    expect(state.workplaces.find((item) => item.metadata.id === client.metadata.id)?.path).toContain("client-alpha");

    state = library.reorderWorkplaces([planning.metadata.id, client.metadata.id]);
    expect(state.workplaces.map((item) => item.metadata.id).filter((id) => id === planning.metadata.id || id === client.metadata.id))
      .toEqual([planning.metadata.id, client.metadata.id]);

    state = library.deleteWorkplace(client.metadata.id);
    expect(state.workplaces.find((item) => item.metadata.id === client.metadata.id)).toBeUndefined();
    expect(state.inbox[0].metadata.id).toBe(meetingId);
  });

  it("heals direct agent filesystem edits into the canonical meeting store", () => {
    const audio = join(root, "agent-filesystem.wav");
    writeFileSync(audio, Buffer.from("RIFF agent filesystem audio"));

    let state = library.createWorkplace("Agent Created");
    const workspace = state.workplaces.find((item) => item.metadata.name === "Agent Created")!;
    state = library.importAudio([audio]);
    const meeting = state.inbox.find((item) => item.metadata.sourceFileName === "agent-filesystem.wav")!;
    const originalMeetingPath = meeting.path;

    const metadataPath = join(meeting.path, "meeting.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.workspaceIds = [workspace.metadata.id];
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    state = library.snapshot();
    expect(state.inbox.find((item) => item.metadata.id === meeting.metadata.id)).toBeUndefined();
    expect(state.workplaces.find((item) => item.metadata.id === workspace.metadata.id)?.meetings[0].metadata.id).toBe(meeting.metadata.id);
    expect(readFileSync(join(workspace.path, "meetings.md"), "utf8")).toContain("agent-filesystem");

    const manualWorkspacePath = join(root, "Workspaces", "manually-made");
    mkdirSync(manualWorkspacePath, { recursive: true });
    state = library.snapshot();
    const manualWorkspace = state.workplaces.find((item) => item.metadata.name === "Manually Made");
    expect(manualWorkspace?.metadata.id).toBeTruthy();

    const movedIntoWorkspace = join(workspace.path, "agent-filesystem-moved");
    renameSync(originalMeetingPath, movedIntoWorkspace);
    state = library.snapshot();
    const healed = state.workplaces.find((item) => item.metadata.id === workspace.metadata.id)?.meetings
      .find((item) => item.metadata.id === meeting.metadata.id);
    expect(healed?.path.startsWith(join(root, "Meetings"))).toBe(true);
    expect(existsSync(movedIntoWorkspace)).toBe(false);
  });

  it("upgrades recognizable generated instructions without overwriting user-owned guidance", () => {
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, "# SmartPuck meeting library\n\nThis workspace contains workplaces, meetings, original audio, and editable transcripts.\n");
    library.ensureLibrary();
    expect(readFileSync(agentsPath, "utf8")).toContain("Start with NEW.md");

    writeFileSync(agentsPath, "# My meeting library\n\nKeep this custom guidance.\n");
    library.ensureLibrary();
    expect(readFileSync(agentsPath, "utf8")).toBe("# My meeting library\n\nKeep this custom guidance.\n");
  });
});

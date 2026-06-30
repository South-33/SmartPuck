const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const { join } = require("path");
const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");

const projectDir = join(__dirname, "..");
const audioPaths = (process.env.SMARTPUCK_E2E_AUDIO || "D:/Download/IELTS Speaking Test- Perfect Band 9.mp3")
  .split(";")
  .map((value) => value.trim())
  .filter(Boolean);

(async () => {
  const existingHome = process.env.SMARTPUCK_E2E_HOME;
  const home = existingHome || mkdtempSync(join(tmpdir(), "smartpuck-e2e-"));
  const env = { ...process.env, SMARTPUCK_HOME: home, SMARTPUCK_DISABLE_AUTO_SYNC: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: electronPath,
    args: ["."],
    cwd: projectDir,
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.locator("body").waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => typeof window.smartpuck?.library?.snapshot === "function", null, { timeout: 30_000 });
    if (!existingHome) {
      await page.evaluate(async (audio) => {
        await window.smartpuck.library.importAudio(audio);
      }, audioPaths);
    }
    let state;
    let meetings = [];
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      state = await page.evaluate(() => window.smartpuck.library.snapshot());
      meetings = [...new Map([...state.inbox, ...state.workplaces.flatMap((workplace) => workplace.meetings)].map((meeting) => [meeting.metadata.id, meeting])).values()];
      const statuses = meetings.map((meeting) => meeting.metadata.status);
      if (statuses.length === (existingHome ? meetings.length : audioPaths.length) && statuses.every((status) => status === "ready")) break;
      const failed = meetings.find((meeting) => meeting.metadata.status === "error");
      if (failed) throw new Error(failed.metadata.error || "Transcription failed");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if ((!existingHome && meetings.length !== audioPaths.length) || meetings.some((meeting) => meeting.metadata.status !== "ready")) {
      throw new Error(`Transcription timed out: ${meetings.map((meeting) => meeting.metadata.status).join(", ") || "missing"}`);
    }
    const meeting = meetings[0];
    if (meeting.metadata.workspaceIds?.length) {
      const workspace = state.workplaces.find((item) => item.metadata.id === meeting.metadata.workspaceIds[0]);
      if (!workspace) throw new Error("Meeting workspace link is missing.");
      await page.getByText(workspace.metadata.name, { exact: true }).click();
    }
    await page.getByText(meeting.metadata.title, { exact: true }).first().click();
    await page.getByLabel("Search meetings").waitFor();
    const searchTarget = meetings.find((item) => item.transcript.includes("Eminem"));
    if (searchTarget) {
      await page.getByLabel("Search meetings").fill("Eminem");
      await page.getByText(searchTarget.metadata.title, { exact: true }).first().waitFor();
      await page.getByLabel("Search meetings").fill("");
    }
    const player = page.locator("audio");
    await player.waitFor();
    try {
      await page.waitForFunction(() => {
        const audio = document.querySelector("audio");
        return audio && Number.isFinite(audio.duration) && audio.duration > 0;
      }, null, { timeout: 30_000 });
    } catch (error) {
      const audioState = await page.locator("audio").evaluate((audio) => ({
        currentSrc: audio.currentSrc,
        duration: audio.duration,
        error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
        networkState: audio.networkState,
        readyState: audio.readyState,
      }));
      throw new Error(`Audio did not become playable: ${JSON.stringify(audioState)}; ${error.message}`);
    }
    await page.screenshot({ path: join(projectDir, "smartpuck-e2e.png"), fullPage: true, timeout: 15_000 })
      .catch((error) => console.warn(`Screenshot skipped: ${error.message}`));
    const persisted = JSON.parse(readFileSync(join(meeting.path, "meeting.json"), "utf8"));
    console.log(JSON.stringify({ home, meetingPath: meeting.path, metadata: persisted }, null, 2));
    if (persisted.status !== "ready") throw new Error(persisted.error || "Transcription did not become ready");
    if ((!existingHome && persisted.curationStatus !== "pending") || !persisted.durationSeconds) throw new Error("Curation or duration metadata is incomplete");
    if (persisted.processedAudioFile !== "recording.processed.wav" || !existsSync(join(meeting.path, persisted.processedAudioFile))) {
      throw new Error("Processed review audio was not persisted.");
    }
    const newIndex = readFileSync(join(home, "NEW.md"), "utf8");
    const pendingCount = meetings.filter((item) => item.metadata.curationStatus === "pending").length;
    if (!newIndex.includes(`Pending: ${pendingCount}`)) throw new Error("NEW.md is not synchronized with pending metadata.");
  } finally {
    await app.close();
    if (!existingHome && process.env.SMARTPUCK_KEEP_E2E !== "1") {
      rmSync(home, { recursive: true, force: true });
    } else {
      console.log(`Preserved E2E workspace: ${home}`);
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

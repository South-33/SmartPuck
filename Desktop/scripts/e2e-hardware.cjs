const { existsSync, readFileSync, renameSync } = require("fs");
const { basename, join } = require("path");
const { spawnSync } = require("child_process");
const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");

if (process.env.SMARTPUCK_HARDWARE_E2E !== "1") {
  throw new Error("Set SMARTPUCK_HARDWARE_E2E=1 to acknowledge that this test records, syncs, and marks a real device session uploaded.");
}

const projectDir = join(__dirname, "..");
const retryId = process.env.SMARTPUCK_HARDWARE_RETRY_ID;
const targetSessionPath = process.env.SMARTPUCK_HARDWARE_SESSION_PATH;
const deleteSessionPath = process.env.SMARTPUCK_HARDWARE_DELETE_SESSION;
const liveTest = process.env.SMARTPUCK_HARDWARE_LIVE_TEST === "1";
const uiTest = process.env.SMARTPUCK_HARDWARE_UI_TEST === "1";

function meetings(state) {
  return [...new Map([...state.inbox, ...state.workplaces.flatMap((workplace) => workplace.meetings)]
    .map((meeting) => [meeting.metadata.id, meeting])).values()];
}

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: electronPath, args: ["."], cwd: projectDir, env });
  let imported;
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.smartpuck?.library?.snapshot === "function", null, { timeout: 30_000 });
    const before = await page.evaluate(() => window.smartpuck.library.snapshot());
    const beforeIds = new Set(meetings(before).map((meeting) => meeting.metadata.id));
    if (uiTest) {
      await page.getByRole("button", { name: "Device" }).click();
      await page.getByText("SmartPuck connected", { exact: true }).waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Listen live" }).waitFor();
      await page.getByPlaceholder("Wi-Fi name").waitFor({ timeout: 15_000 });
      await page.getByText("Rith", { exact: true }).waitFor({ timeout: 15_000 });
      const device = await page.evaluate(() => window.smartpuck.device.refresh());
      if (device?.sessions.length) {
        await page.getByRole("button", { name: "Rename" }).first().waitFor();
        await page.getByRole("button", { name: "Delete" }).first().waitFor();
      }
      await page.screenshot({ path: join(projectDir, "smartpuck-hardware.png"), fullPage: true });
      console.log(JSON.stringify({ hardwareUi: "passed" }, null, 2));
      return;
    }
    if (liveTest) {
      await page.getByRole("button", { name: "Device" }).click();
      await page.getByText("SmartPuck connected", { exact: true }).waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Listen live" }).click();
      await page.getByRole("button", { name: "Stop listening" }).waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1_000);
      const streaming = await page.evaluate(() => window.smartpuck.device.refresh());
      if (!streaming?.connected || !streaming.streaming) throw new Error("Firmware did not enter live streaming state.");
      await page.getByRole("button", { name: "Stop listening" }).click();
      await page.getByRole("button", { name: "Listen live" }).waitFor({ timeout: 15_000 });
      console.log(JSON.stringify({ liveListening: "passed", device: streaming }, null, 2));
      return;
    }
    if (deleteSessionPath) {
      await page.getByRole("button", { name: "Device" }).click();
      await page.getByText("SmartPuck connected", { exact: true }).waitFor({ timeout: 30_000 });
      const device = await page.evaluate((path) => window.smartpuck.device.deleteSession(path), deleteSessionPath);
      if (device.sessions.some((session) => session.path === deleteSessionPath)) throw new Error("Deleted session still appears on the device.");
      console.log(JSON.stringify({ deletedSession: deleteSessionPath, device }, null, 2));
      return;
    }
    if (retryId) {
      imported = meetings(before).find((meeting) => meeting.metadata.id === retryId);
      if (!imported) throw new Error(`Retry meeting not found: ${retryId}`);
      void page.evaluate((id) => window.smartpuck.library.transcribe(id), retryId);
    } else if (!targetSessionPath) {
      await page.getByRole("button", { name: "Device" }).click();
      await page.getByText("SmartPuck connected", { exact: true }).waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Start" }).click();
      await page.getByRole("button", { name: "Stop" }).waitFor({ timeout: 15_000 });

      const speech = spawnSync("powershell", [
        "-NoProfile", "-Command",
        "Add-Type -AssemblyName System.Speech; $voice=New-Object System.Speech.Synthesis.SpeechSynthesizer; $voice.Rate=-1; $voice.Speak('SmartPuck physical hardware test. USB recording, automatic sync, and transcription are working.'); $voice.Dispose()",
      ], { windowsHide: true, timeout: 30_000 });
      if (speech.status !== 0) throw new Error(`Windows test speech failed: ${speech.stderr?.toString() || speech.status}`);

      await page.waitForTimeout(1_500);
      await page.getByRole("button", { name: "Stop" }).click();
      await page.getByRole("button", { name: "Start" }).waitFor({ timeout: 15_000 });
    }

    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.smartpuck.library.snapshot());
      imported = retryId
        ? meetings(state).find((meeting) => meeting.metadata.id === retryId)
        : targetSessionPath
          ? meetings(state).find((meeting) => meeting.metadata.sourceDevicePath === targetSessionPath)
          : meetings(state).find((meeting) => !beforeIds.has(meeting.metadata.id));
      if (imported?.metadata.status === "ready") break;
      if (imported?.metadata.status === "error") throw new Error(imported.metadata.error || "Hardware transcription failed.");
      await page.waitForTimeout(500);
    }
    if (!imported || imported.metadata.status !== "ready") throw new Error("The physical recording did not auto-sync and finish transcription.");
    const metadata = JSON.parse(readFileSync(join(imported.path, "meeting.json"), "utf8"));
    if (!metadata.sourceDevicePath) throw new Error("Imported meeting lost its device session identity.");
    if (!metadata.processedAudioFile || !existsSync(join(imported.path, metadata.processedAudioFile))) throw new Error("Processed audio is missing.");
    if (!existsSync(join(imported.path, metadata.audioFile))) throw new Error("Original audio is missing.");
    const device = await page.evaluate(() => window.smartpuck.device.refresh());
    const session = device?.sessions.find((item) => item.path === metadata.sourceDevicePath);
    if (!session?.uploaded) throw new Error("The device did not acknowledge the synced session.");
    console.log(JSON.stringify({ device, meeting: metadata, meetingPath: imported.path }, null, 2));
  } finally {
    await app.close();
  }

  if (imported) {
    const trash = join(imported.path, "..", "..", "Trash", basename(imported.path));
    if (existsSync(trash)) throw new Error(`Refusing cleanup collision: ${trash}`);
    renameSync(imported.path, trash);
    console.log(`Moved hardware test meeting to recoverable Trash: ${trash}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const { mkdtempSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const { join } = require("path");
const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");

const projectDir = join(__dirname, "..");

(async () => {
  const home = mkdtempSync(join(tmpdir(), "smartpuck-ui-smoke-"));
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
    await page.getByText("Workspace", { exact: true }).click();
    await page.getByLabel("Workspace name").fill("Client Alpha");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByText("Client Alpha", { exact: true }).waitFor({ timeout: 10_000 });
    await page.getByText("Client Alpha", { exact: true }).click({ button: "right" });
    await page.getByRole("button", { name: "Rename workspace" }).waitFor({ timeout: 10_000 });
  } finally {
    await app.close();
    rmSync(home, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

import { useState, useEffect, useCallback } from "react";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "./components/ThemeProvider";
import { FontProvider } from "./components/FontProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import Welcome from "./screens/Welcome/Welcome";
import Install from "./screens/Install/Install";
import Setup from "./screens/Setup/Setup";
import Layout from "./screens/Layout/Layout";
import { captureScreenView } from "./utils/analytics";

type Screen = "welcome" | "installing" | "setup" | "main";
const SMARTPUCK_PREVIEW = import.meta.env.VITE_SMARTPUCK_PREVIEW === "1";

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("main");
  const [installError, setInstallError] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<
    "local" | "remote" | "ssh"
  >("local");
  // Soft warning: install files exist but the deep `verifyInstall` probe
  // failed (e.g. slow Python startup, restricted network). We surface this
  // as a dismissible banner instead of bouncing the user back to Welcome,
  // which previously trapped restricted-network users in a reinstall
  // loop on every launch (#130).
  const [verifyWarning, setVerifyWarning] = useState(false);
  const isMac = window.electron?.process?.platform === "darwin";

  const runInstallCheck = useCallback(async () => {
    if (SMARTPUCK_PREVIEW) return;
    let next: Screen = "welcome";
    const error: string | null = null;
    let isRemote = false;

    try {
      const conn = await window.hermesAPI.getConnectionConfig();
      isRemote = conn.mode === "remote" || conn.mode === "ssh";
      setConnectionMode(conn.mode);

      if (conn.mode === "ssh" && conn.ssh) {
        try {
          await window.hermesAPI.startSshTunnel();
        } catch (tunnelErr) {
          console.warn("SSH tunnel failed to start on launch:", tunnelErr);
        }
        next = "main";
      } else if (conn.mode === "remote" && conn.remoteUrl) {
        const ok = await window.hermesAPI.testRemoteConnection(conn.remoteUrl);
        if (ok) {
          next = "main";
        } else {
          console.warn(`Cannot reach remote Hermes at ${conn.remoteUrl}.`);
          next = "main";
        }
      } else {
        const status = await window.hermesAPI.checkInstall();
        if (!status.installed) {
          next = "welcome";
        } else if (!status.hasApiKey) {
          next = "setup";
        } else {
          next = "main";
        }

        // Warm config-health and gateway status in the background while the
        // splash is still visible so the first render is snappy. Cap at 800ms
        // so it never pushes us past the 3s minimum.
        if (next === "main") {
          await Promise.race([
            Promise.all([
              window.hermesAPI
                .getConfigHealth()
                .catch(() => null)
                .then(() => undefined),
              window.hermesAPI
                .gatewayStatus()
                .catch(() => null)
                .then(() => undefined),
            ]),
            new Promise<void>((r) => setTimeout(r, 800)),
          ]);
        }
      }
    } catch {
      next = "welcome";
    }

    if (error) setInstallError(error);

    setScreen(next);

    // Lazy deep-verify in the background after the UI is up. If the
    // install is broken, surface the warning then — don't block startup.
    //
    // Skip for remote-mode connections: verifyInstall() probes the LOCAL
    // Python + script paths (HERMES_PYTHON / HERMES_SCRIPT in installer.ts),
    // which don't exist on machines that only use a remote backend. Without
    // this guard the user is bounced back to Welcome with an "installBroken"
    // error immediately after a successful remote connect. (#47, #41, #30)
    if ((next === "main" || next === "setup") && !isRemote) {
      window.hermesAPI.verifyInstall().then((ok) => {
        // Files exist (checkInstall passed) but the probe failed. Surface
        // a soft warning instead of bouncing to Welcome — see #130.
        if (!ok) setVerifyWarning(true);
      });
    }
  }, []);

  useEffect(() => {
    runInstallCheck();
  }, [runInstallCheck]);

  // Track screen views for analytics
  useEffect(() => {
    captureScreenView(screen);
  }, [screen]);

  function handleInstallComplete(): void {
    setInstallError(null);
    setScreen("setup");
  }

  function handleInstallFailed(error: string): void {
    setInstallError(error);
    setScreen("welcome");
  }

  function handleRetryInstall(): void {
    setInstallError(null);
    setScreen("installing");
  }

  function handleRecheck(): void {
    setInstallError(null);
    runInstallCheck();
  }

  async function handleSwitchToLocal(): Promise<void> {
    await window.hermesAPI.setConnectionConfig("local", "", "");
    setConnectionMode("local");
    handleRecheck();
  }

  function handleVerifyReinstall(): void {
    setVerifyWarning(false);
    setInstallError(null);
    setScreen("installing");
  }

  function handleDismissVerifyWarning(): void {
    setVerifyWarning(false);
  }

  function renderScreen(): React.JSX.Element {
    switch (screen) {
      case "welcome":
        return (
          <Welcome
            error={installError}
            connectionMode={connectionMode}
            onStart={handleRetryInstall}
            onRecheck={handleRecheck}
            onSwitchToLocal={handleSwitchToLocal}
          />
        );
      case "installing":
        return (
          <Install
            onComplete={handleInstallComplete}
            onFailed={handleInstallFailed}
            onCancel={() => setScreen("welcome")}
          />
        );
      case "setup":
        return (
          <Setup
            onComplete={() => setScreen("main")}
            verifyWarning={verifyWarning}
            onReinstall={handleVerifyReinstall}
            onDismissVerifyWarning={handleDismissVerifyWarning}
          />
        );
      case "main":
        return (
          <Layout
            verifyWarning={verifyWarning}
            onReinstall={handleVerifyReinstall}
            onDismissVerifyWarning={handleDismissVerifyWarning}
          />
        );
    }
  }

  return (
    <ThemeProvider>
      <FontProvider>
        <ErrorBoundary>
          <div className={`app${isMac ? " is-mac" : ""}`}>
            {isMac && <div className="drag-region" />}
            <div className="app-content">{renderScreen()}</div>
          </div>
          <Toaster
            position="bottom-right"
            reverseOrder={false}
            toastOptions={{
              style: {
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-bright)",
                fontSize: 13,
              },
            }}
          />
        </ErrorBoundary>
      </FontProvider>
    </ThemeProvider>
  );
}

export default App;

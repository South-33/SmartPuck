import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoWorkspace } from "@/components/workspace/demo-workspace";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { demoWorkspace } from "@/lib/demo-workspace";

describe("Demo workspace UI", () => {
  test("starts with the SmartPuck demo folder and creates a saved chat inside it", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("Device Prototype Review")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start new chat in Demo" }));

    expect(
      await screen.findByPlaceholderText(/Ask SmartPuck about "New SmartPuck Chat"/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/New chat saved/i)).not.toBeInTheDocument();
  });

  test("creates a new folder from the sidebar composer", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    await user.click(screen.getByRole("button", { name: "Create folder" }));
    await user.type(screen.getByPlaceholderText("New folder"), "Customer Research");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("Customer Research")).toBeInTheDocument();
  });

  test("opens the Wi-Fi recording flow and creates an imported recording shell", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    const deviceToggle = screen.getByRole("button", { name: "Demo" });
    expect(deviceToggle).toHaveAttribute("aria-expanded", "true");
    await user.click(deviceToggle);
    expect(deviceToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Delete folder Demo" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New Recording" }));
    expect(await screen.findByText(/SmartPuck auto-detect/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Record$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Stop$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Check$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^USB$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bluetooth$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Upload audio from this computer/i }));

    expect(
      await screen.findByPlaceholderText(/Ask SmartPuck about "Imported Recording"/i, {}, { timeout: 2000 }),
    ).toBeInTheDocument();

    const prompt = screen.getByPlaceholderText(/Ask SmartPuck about "Imported Recording"/i);
    await user.type(prompt, "Summarize the backend contract");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Summarize the backend contract")).toBeInTheDocument();
    expect(
      await screen.findByText(/Folder organization, local transcription, transcript search, and saved chat/i),
    ).toBeInTheDocument();
  });

  test("renders assistant markdown with the shared AI markdown renderer", async () => {
    const user = userEvent.setup();
    const { container } = render(<DemoWorkspace />);

    const prompt = screen.getByPlaceholderText(/Ask SmartPuck about/i);
    await user.type(prompt, "Return markdown");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText(/SmartPuck demo:/i);

    await waitFor(() => {
      expect(container.querySelector('[data-streamdown="strong"]')).not.toBeNull();
    });
  });

  test("attaches draft files in the chat composer", async () => {
    const user = userEvent.setup();
    const { container } = render(<DemoWorkspace />);
    const fileInput = container.querySelector('input[type="file"]');

    expect(fileInput).toBeInstanceOf(HTMLInputElement);

    await user.upload(
      fileInput as HTMLInputElement,
      new File(["Launch checklist"], "notes.txt", { type: "text/plain" }),
    );

    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("1 attached")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove notes.txt" }));

    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  test("shows a visible assistant error when chat generation fails", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceShell
        dashboard={demoWorkspace}
        mode="live"
        isMutating={false}
        fallbackFolderId={demoWorkspace.folders[0]?.id ?? null}
        onCreateFolder={() => undefined}
        onDeleteFolder={() => undefined}
        onCreateChat={() => undefined}
        onConnectDevice={() => undefined}
        onSelectMeeting={() => undefined}
        onDeleteMeeting={() => undefined}
        onSendMessage={async () => {
          throw new Error("Gemini API key missing");
        }}
      />,
    );

    const prompt = screen.getByPlaceholderText(/Ask SmartPuck about/i);
    await user.type(prompt, "can u check my meetings");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("can u check my meetings")).toBeInTheDocument();
    expect(await screen.findByText(/SmartPuck ran into an error: Gemini API key missing/i)).toBeInTheDocument();
  });

  test("shows a sending state while the chat request is in flight", async () => {
    const user = userEvent.setup();
    let resolveSend: () => void = () => undefined;
    const sendPromise = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });

    render(
      <WorkspaceShell
        dashboard={demoWorkspace}
        mode="live"
        isMutating={false}
        fallbackFolderId={demoWorkspace.folders[0]?.id ?? null}
        onCreateFolder={() => undefined}
        onDeleteFolder={() => undefined}
        onCreateChat={() => undefined}
        onConnectDevice={() => undefined}
        onSelectMeeting={() => undefined}
        onDeleteMeeting={() => undefined}
        onSendMessage={() => sendPromise}
      />,
    );

    const prompt = screen.getByPlaceholderText(/Ask SmartPuck about/i);
    await user.type(prompt, "what happened in the meeting");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("button", { name: "Sending" })).toBeDisabled();
    expect(screen.getByText("SmartPuck is thinking")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();

    resolveSend();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    });
  });

  test("renders a simple fallback instead of a blank completed assistant message", () => {
    const activeMeeting = demoWorkspace.activeMeeting!;
    const dashboardWithEmptyAssistant = {
      ...demoWorkspace,
      activeMeeting: {
        ...activeMeeting,
        messages: [
          {
            id: "empty-assistant",
            role: "assistant" as const,
            body: "",
            status: "complete" as const,
            createdAt: "2026-06-20T00:00:00.000Z",
          },
        ],
      },
      folders: demoWorkspace.folders.map((folder) => ({
        ...folder,
        meetings: folder.meetings.map((meeting) =>
          meeting.id === activeMeeting.id
            ? {
                ...meeting,
                messages: [
                  {
                    id: "empty-assistant",
                    role: "assistant" as const,
                    body: "",
                    status: "complete" as const,
                    createdAt: "2026-06-20T00:00:00.000Z",
                  },
                ],
              }
            : meeting,
        ),
      })),
    };

    render(
      <WorkspaceShell
        dashboard={dashboardWithEmptyAssistant}
        mode="live"
        isMutating={false}
        fallbackFolderId={demoWorkspace.folders[0]?.id ?? null}
        onCreateFolder={() => undefined}
        onDeleteFolder={() => undefined}
        onCreateChat={() => undefined}
        onConnectDevice={() => undefined}
        onSelectMeeting={() => undefined}
        onDeleteMeeting={() => undefined}
        onSendMessage={() => undefined}
      />,
    );

    expect(screen.getByText(/I don't have a recorded meeting transcript/i)).toBeInTheDocument();
  });

  test("restores the old secondary pages from the sidebar", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Profile Avatar" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(
      await screen.findByPlaceholderText(/Search knowledge base or ask a question/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archives" }));
    expect(await screen.findByText("Q2 Earnings Prep")).toBeInTheDocument();
  });
});

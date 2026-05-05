import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoWorkspace } from "@/components/workspace/demo-workspace";

describe("Demo workspace UI", () => {
  test("starts with two SmartPuck demo folders and creates a saved chat inside a folder", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    expect(screen.getByText("Device Prototype")).toBeInTheDocument();
    expect(screen.getByText("AI Processing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start new chat in Device Prototype" }));

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

  test("opens the placeholder new recording flow and creates a synced meeting", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    await user.click(screen.getByRole("button", { name: "New Recording" }));
    expect(await screen.findByText(/Place puck on charging base to begin/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Connect over USB/i }));

    expect(
      await screen.findByPlaceholderText(/Ask SmartPuck about "Desk Sync Capture"/i, {}, { timeout: 2000 }),
    ).toBeInTheDocument();

    const prompt = screen.getByPlaceholderText(/Ask SmartPuck about "Desk Sync Capture"/i);
    await user.type(prompt, "Summarize the backend contract");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Summarize the backend contract")).toBeInTheDocument();
    expect(
      await screen.findByText(/Folder organization, meeting shells, and thread persistence are ready/i),
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

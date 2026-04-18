import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoWorkspace } from "@/components/workspace/demo-workspace";

describe("Demo workspace UI", () => {
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
    expect(screen.getByText(/Place puck on charging base to begin/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Connect over USB/i }));

    expect(
      await screen.findByPlaceholderText(/Ask SmartPuck about "Desk Sync Capture"/i),
    ).toBeInTheDocument();

    const prompt = screen.getByPlaceholderText(/Ask SmartPuck about "Desk Sync Capture"/i);
    await user.type(prompt, "Summarize the backend contract");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Summarize the backend contract")).toBeInTheDocument();
    expect(
      await screen.findByText(/Folder organization, meeting shells, and thread persistence are ready/i),
    ).toBeInTheDocument();
  });

  test("restores the old secondary pages from the sidebar", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Profile Avatar" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(
      screen.getByPlaceholderText(/Search knowledge base or ask a question/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archives" }));
    expect(screen.getByText("Q2 Earnings Prep")).toBeInTheDocument();
  });
});

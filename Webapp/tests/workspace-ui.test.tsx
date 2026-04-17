import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoWorkspace } from "@/components/workspace/demo-workspace";

describe("Demo workspace UI", () => {
  test("creates a new folder from the sidebar composer", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    await user.type(screen.getByPlaceholderText("New folder"), "Customer Research");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("Customer Research")).toBeInTheDocument();
  });

  test("creates a synced meeting and continues the chat thread", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    await user.click(screen.getByRole("button", { name: /Connect over USB/i }));

    expect(await screen.findByRole("heading", { name: "Desk Sync Capture" })).toBeInTheDocument();
    expect(
      screen.getByText(/Session metadata uploaded\. Audio processing is intentionally stubbed/i),
    ).toBeInTheDocument();

    const prompt = screen.getByPlaceholderText(/Ask SmartPuck about "Desk Sync Capture"/i);
    await user.type(prompt, "Summarize the backend contract");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Summarize the backend contract")).toBeInTheDocument();
    expect(
      await screen.findByText(/Folder organization, meeting shells, and thread persistence are ready/i),
    ).toBeInTheDocument();
  });

  test("filters the sidebar folders and meetings from search", async () => {
    const user = userEvent.setup();

    render(<DemoWorkspace />);

    const [sidebar] = screen.getAllByRole("complementary");
    await user.type(screen.getByPlaceholderText("Search meetings or folders"), "Google");

    expect(within(sidebar).getByText("Google Meetings")).toBeInTheDocument();
    expect(within(sidebar).queryByText("Q3 Strategy")).not.toBeInTheDocument();
  });
});

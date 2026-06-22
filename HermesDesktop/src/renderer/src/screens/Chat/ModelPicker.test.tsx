import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("lucide-react", () => ({ ChevronDown: () => null }));

import { ModelPicker } from "./ModelPicker";
import type { ModelGroup } from "./types";

const groups: ModelGroup[] = [
  {
    provider: "openai-codex",
    providerLabel: "ChatGPT (Codex Plan)",
    models: [
      {
        provider: "openai-codex",
        model: "gpt-5.4-mini",
        label: "gpt-5.4-mini",
        baseUrl: "",
      },
      {
        provider: "openai-codex",
        model: "gpt-5.4",
        label: "gpt-5.4",
        baseUrl: "",
      },
    ],
  },
];

function renderPicker(modelGroups = groups): ReturnType<typeof render> {
  return render(
    <ModelPicker
      currentModel="gpt-5.4-mini"
      currentProvider="openai-codex"
      modelGroups={modelGroups}
      displayModel="gpt-5.4-mini"
      onOpen={vi.fn()}
      onSelectModel={vi.fn()}
    />,
  );
}

function openPicker(container: HTMLElement): HTMLElement {
  fireEvent.click(container.querySelector(".chat-model-trigger")!);
  return container.querySelector(".chat-model-dropdown")!;
}

describe("ModelPicker", () => {
  it("shows the active model in its trigger", () => {
    const { container } = renderPicker();
    expect(container.querySelector(".chat-model-name")?.textContent).toBe(
      "gpt-5.4-mini",
    );
  });

  it("lists only supplied authenticated models", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    expect(dropdown.querySelectorAll(".chat-model-option")).toHaveLength(2);
    expect(dropdown.querySelector(".chat-model-search-input")).toBeNull();
    expect(dropdown.querySelector(".chat-model-custom-input")).toBeNull();
  });

  it("selects a listed model and closes", () => {
    const onSelectModel = vi.fn();
    const { container } = render(
      <ModelPicker
        currentModel="gpt-5.4-mini"
        currentProvider="openai-codex"
        modelGroups={groups}
        displayModel="gpt-5.4-mini"
        onOpen={vi.fn()}
        onSelectModel={onSelectModel}
      />,
    );
    const dropdown = openPicker(container);
    fireEvent.click(dropdown.querySelectorAll(".chat-model-option")[1]);

    expect(onSelectModel).toHaveBeenCalledWith("openai-codex", "gpt-5.4", "");
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  it("explains when no authenticated models are available", () => {
    const { container } = renderPicker([]);
    openPicker(container);
    expect(
      screen.getByText("No ChatGPT models are available yet."),
    ).toBeTruthy();
  });
});

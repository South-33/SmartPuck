import {
  buildOptimisticChatTurn,
  deriveComposerSendState,
  deriveMeetingStatusPill,
  mergeServerAndOptimisticMessages,
  settleOptimisticChatTurnWithError,
} from "@/lib/smartpuck-chat";
import type { MeetingRecord } from "@/lib/workspace-types";

const baseMeeting: MeetingRecord = {
  id: "meeting-1",
  folderId: "folder-1",
  title: "Prototype Review",
  durationLabel: "12m",
  status: "ready",
  startedAtLabel: "Today",
  sourceTransport: "manual",
  summary: "",
  transcriptPreview: "",
  syncStats: {
    percent: 100,
    transferredMb: 1,
    visuals: 0,
    audioHours: 0.2,
  },
  decisions: [],
  actions: [],
  messages: [],
};

describe("smartpuck chat lifecycle helpers", () => {
  test("derives send button state from prompt, attachments, and in-flight work", () => {
    expect(
      deriveComposerSendState({
        draftMessage: "  ",
        attachmentCount: 0,
        hasActiveMeeting: true,
        isSending: false,
      }),
    ).toMatchObject({ hasSendableContent: false, disabled: true, ariaLabel: "Send" });

    expect(
      deriveComposerSendState({
        draftMessage: "",
        attachmentCount: 1,
        hasActiveMeeting: true,
        isSending: true,
      }),
    ).toMatchObject({
      hasSendableContent: true,
      disabled: true,
      ariaLabel: "Sending",
      footerCopy: "SmartPuck is thinking",
    });
  });

  test("keeps one visible optimistic user message when the server echoes the send", () => {
    const turn = buildOptimisticChatTurn({
      meetingId: "meeting-1",
      body: "What happened?",
      attachments: [],
      nowIso: "2026-06-20T00:00:00.000Z",
      seed: "a",
    });

    const merged = mergeServerAndOptimisticMessages(
      [{ ...turn.messages[0], id: "server-user" }],
      turn.messages,
    );

    expect(merged.map((message) => message.id)).toEqual(["server-user", turn.assistantMessageId]);
  });

  test("settles a failed turn into an assistant error and status pill", () => {
    const turn = buildOptimisticChatTurn({
      meetingId: "meeting-1",
      body: "Summarize this",
      attachments: [],
      nowIso: "2026-06-20T00:00:00.000Z",
      seed: "b",
    });

    const failedMessages = settleOptimisticChatTurnWithError({
      messages: turn.messages,
      turn,
      error: new Error("API key missing"),
    });

    expect(failedMessages).toHaveLength(2);
    expect(failedMessages[1]).toMatchObject({
      role: "assistant",
      status: "error",
      body: "SmartPuck ran into an error: API key missing",
    });
    expect(deriveMeetingStatusPill(baseMeeting, failedMessages)).toMatchObject({
      label: "Error",
      pulse: false,
    });
  });
});

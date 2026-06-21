import type { ChatAttachment, MeetingMessage, MeetingRecord } from "@/lib/workspace-types";

export const ASSISTANT_THINKING_BODY = "Checking the meeting context...";

export type ComposerSendState = {
  trimmedMessage: string;
  hasSendableContent: boolean;
  isSending: boolean;
  disabled: boolean;
  ariaLabel: "Send" | "Sending" | "Select a chat first";
  footerCopy: string;
};

export type OptimisticChatTurn = {
  meetingId: string;
  userMessageId: string;
  assistantMessageId: string;
  messages: [MeetingMessage, MeetingMessage];
};

export type MeetingStatusPill = {
  label: "Working" | "Error" | "Processing";
  tone: "sky" | "red" | "amber";
  pulse: boolean;
};

export function deriveComposerSendState(input: {
  draftMessage: string;
  attachmentCount: number;
  hasActiveMeeting: boolean;
  isSending: boolean;
}): ComposerSendState {
  const trimmedMessage = input.draftMessage.trim();
  const hasSendableContent = trimmedMessage.length > 0 || input.attachmentCount > 0;
  const disabled = !input.hasActiveMeeting || input.isSending || !hasSendableContent;

  return {
    trimmedMessage,
    hasSendableContent,
    isSending: input.isSending,
    disabled,
    ariaLabel: !input.hasActiveMeeting ? "Select a chat first" : input.isSending ? "Sending" : "Send",
    footerCopy: input.isSending
      ? "SmartPuck is thinking"
      : "Enter to send - Shift+Enter for line break",
  };
}

export function buildOptimisticChatTurn(input: {
  meetingId: string;
  body: string;
  attachments: ChatAttachment[];
  nowIso?: string;
  seed?: string | number;
}): OptimisticChatTurn {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const seed = input.seed ?? Date.now();
  const optimisticTurnId = `optimistic-${input.meetingId}-${seed}`;
  const userMessage: MeetingMessage = {
    id: `${optimisticTurnId}-user`,
    role: "user",
    body: input.body,
    status: "complete",
    createdAt: nowIso,
    attachments: input.attachments,
  };
  const assistantMessage: MeetingMessage = {
    id: `${optimisticTurnId}-assistant`,
    role: "assistant",
    body: "",
    status: "streaming",
    createdAt: nowIso,
    reasoning: ASSISTANT_THINKING_BODY,
    activity: [{
      id: `${optimisticTurnId}-activity`,
      title: "Thinking",
      body: ASSISTANT_THINKING_BODY,
      status: "working",
    }],
  };

  return {
    meetingId: input.meetingId,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    messages: [userMessage, assistantMessage],
  };
}

export function removeOptimisticChatTurn(
  messages: MeetingMessage[],
  turn: Pick<OptimisticChatTurn, "userMessageId" | "assistantMessageId">,
) {
  return messages.filter(
    (message) => message.id !== turn.userMessageId && message.id !== turn.assistantMessageId,
  );
}

export function settleOptimisticChatTurnWithError(input: {
  messages: MeetingMessage[];
  turn: OptimisticChatTurn;
  error: unknown;
}) {
  const errorMessage =
    input.error instanceof Error && input.error.message.trim()
      ? input.error.message
      : "The SmartPuck chat API did not return a response.";

  return input.messages
    .filter((message) => message.id !== input.turn.assistantMessageId)
    .concat({
      ...input.turn.messages[1],
      body: `SmartPuck ran into an error: ${errorMessage}`,
      status: "error",
      reasoning: undefined,
    });
}

export function mergeServerAndOptimisticMessages(
  serverMessages: MeetingMessage[],
  optimisticMessages: MeetingMessage[],
) {
  const visibleMessages = [...serverMessages];
  const savedOptimisticTurnPrefixes = new Set<string>();

  for (const optimisticMessage of optimisticMessages) {
    if (optimisticMessage.role !== "user") {
      continue;
    }

    const matchingServerUserIndex = findServerUserIndex(serverMessages, optimisticMessage.body);
    if (matchingServerUserIndex === -1) {
      continue;
    }

    const turnPrefix = getOptimisticTurnPrefix(optimisticMessage.id, "user");
    if (turnPrefix && hasAssistantAfter(serverMessages, matchingServerUserIndex)) {
      savedOptimisticTurnPrefixes.add(turnPrefix);
    }
  }

  for (const optimisticMessage of optimisticMessages) {
    const turnPrefix =
      optimisticMessage.role === "assistant"
        ? getOptimisticTurnPrefix(optimisticMessage.id, "assistant")
        : null;
    const isCoveredByServerAssistant =
      turnPrefix !== null && savedOptimisticTurnPrefixes.has(turnPrefix);
    const isSavedOnServer =
      optimisticMessage.role === "user" &&
      findServerUserIndex(serverMessages, optimisticMessage.body) !== -1;

    if (!isSavedOnServer && !isCoveredByServerAssistant) {
      visibleMessages.push(optimisticMessage);
    }
  }

  return visibleMessages;
}

export function deriveMeetingStatusPill(
  meeting: MeetingRecord,
  optimisticMessages: MeetingMessage[],
): MeetingStatusPill | null {
  if (optimisticMessages.some((message) => message.status === "error")) {
    return { label: "Error", tone: "red", pulse: false };
  }

  if (optimisticMessages.some((message) => message.status === "streaming")) {
    return { label: "Working", tone: "sky", pulse: true };
  }

  if (meeting.status === "processing") {
    return { label: "Processing", tone: "amber", pulse: true };
  }

  if (meeting.messages.some((message) => message.status === "streaming")) {
    return { label: "Working", tone: "sky", pulse: true };
  }

  return null;
}

function normalizeMessageBody(body: string) {
  return body.trim().replace(/\s+/g, " ");
}

function findServerUserIndex(serverMessages: MeetingMessage[], body: string) {
  const normalizedBody = normalizeMessageBody(body);
  return serverMessages.findIndex(
    (message) => message.role === "user" && normalizeMessageBody(message.body) === normalizedBody,
  );
}

function hasAssistantAfter(messages: MeetingMessage[], startIndex: number) {
  return messages.slice(startIndex + 1).some((message) => message.role === "assistant");
}

function getOptimisticTurnPrefix(id: string, role: "user" | "assistant") {
  const suffix = `-${role}`;
  return id.endsWith(suffix) ? id.slice(0, -suffix.length) : null;
}

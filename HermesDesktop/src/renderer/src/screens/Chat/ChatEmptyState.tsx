import { memo } from "react";
import {
  AudioLines,
  CheckSquare,
  Clock3,
  FileText,
  GitCompareArrows,
  ListChecks,
} from "lucide-react";

interface Suggestion {
  label: string;
  prompt: string;
  Icon: typeof AudioLines;
}

const SUGGESTIONS: Suggestion[] = [
  {
    label: "Summarize the meeting",
    prompt: "Summarize this meeting with the main topics and outcomes.",
    Icon: FileText,
  },
  {
    label: "List decisions",
    prompt: "What decisions were made? Include timestamps when available.",
    Icon: CheckSquare,
  },
  {
    label: "Find action items",
    prompt: "List every action item, owner, and deadline mentioned.",
    Icon: ListChecks,
  },
  {
    label: "Build a timeline",
    prompt: "Create a timestamped timeline of the important discussion points.",
    Icon: Clock3,
  },
  {
    label: "Draft follow-up notes",
    prompt: "Draft concise follow-up notes I can send to the attendees.",
    Icon: AudioLines,
  },
  {
    label: "Compare meetings",
    prompt:
      "Compare this meeting with the other relevant meeting folders and highlight changes.",
    Icon: GitCompareArrows,
  },
];

function folderName(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
}

interface ChatEmptyStateProps {
  contextFolder?: string | null;
  onSelectSuggestion: (text: string) => void;
}

export const ChatEmptyState = memo(function ChatEmptyState({
  contextFolder,
  onSelectSuggestion,
}: ChatEmptyStateProps): React.JSX.Element {
  const meetingName = folderName(contextFolder);

  return (
    <div className="chat-empty smartpuck-chat-empty">
      <div className="chat-empty-icon smartpuck-chat-empty-icon">
        <AudioLines size={34} />
      </div>
      <div className="chat-empty-text">
        {meetingName ? `Ask about ${meetingName}` : "Ask about your meetings"}
      </div>
      <div className="chat-empty-hint">
        SmartPuck searches local transcripts and reads only the relevant parts.
      </div>
      <div className="chat-empty-suggestions">
        {SUGGESTIONS.map(({ label, prompt, Icon }) => (
          <button
            key={label}
            className="chat-suggestion"
            onClick={() => onSelectSuggestion(prompt)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
});

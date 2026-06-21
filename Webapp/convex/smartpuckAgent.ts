import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  Agent,
  createTool,
  listUIMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { z } from "zod";
import { components, internal } from "./_generated/api";
import { action, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { SMARTPUCK_PROPOSAL_CONTEXT } from "./smartpuckContext";

const model = (process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite").replace(/^models\//, "");
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const listFolderMeetings = createTool({
  description: "Lists all chats and meetings in the current folder, including whether each one has transcript text available. Use this before claiming a latest meeting exists.",
  inputSchema: z.object({}),
  execute: async (ctx) => {
    if (!ctx.threadId) {
      return { error: "No active thread" };
    }
    const currentMeeting = await ctx.runQuery(internal.workspace.getMeetingByThread, {
      threadId: ctx.threadId,
    });
    if (!currentMeeting) {
      return { error: "Current meeting not found" };
    }
    const meetings = await ctx.runQuery(internal.workspace.listMeetingsInFolder, {
      folderId: currentMeeting.folderId,
    });
    return { meetings };
  },
});

const searchMeetingTranscripts = createTool({
  description: "Searches (greps) through all transcripts in the current folder for a given query term, returning matching snippet lines with their timestamps and meeting titles. Use this to quickly search for what someone said without loading the full transcripts.",
  inputSchema: z.object({
    query: z.string().describe("The search term or keyword to find in transcripts."),
  }),
  execute: async (ctx, args) => {
    if (!ctx.threadId) {
      return { error: "No active thread" };
    }
    const currentMeeting = await ctx.runQuery(internal.workspace.getMeetingByThread, {
      threadId: ctx.threadId,
    });
    if (!currentMeeting) {
      return { error: "Current meeting not found" };
    }
    const results = await ctx.runQuery(internal.workspace.searchTranscriptsInFolder, {
      folderId: currentMeeting.folderId,
      query: args.query,
    });
    return { results };
  },
});

const readMeetingTranscript = createTool({
  description: "Reads the full transcript text of a specific meeting by its meetingId. Use this when the user asks about a specific meeting or when search results point to a specific meeting and you need to read the full context.",
  inputSchema: z.object({
    meetingId: z.string().describe("The unique ID of the meeting to fetch the transcript for."),
  }),
  execute: async (ctx, args) => {
    const transcript = await ctx.runQuery(internal.workspace.getMeetingTranscript, {
      meetingId: args.meetingId as Id<"meetings">,
    });
    return { transcript };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const smartpuckAgent: Agent<any, any> = new Agent(components.agent, {
  name: "SmartPuck",
  languageModel: google(model),
  instructions: [
    "You are SmartPuck Companion AI. Answer as a concise meeting and product assistant.",
    "When the current chat has transcript text, answer from that transcript and the current folder's transcript tools first.",
    "Do not mix SmartPuck product or implementation details into transcript answers unless the user explicitly asks about SmartPuck, the recorder, the app, or the transcription pipeline.",
    "When there is no transcript text, you may answer practical SmartPuck product questions from product context.",
    "You have tools to list, search, and read transcripts of meetings in the current folder. Use these tools (like listFolderMeetings, searchMeetingTranscripts, and readMeetingTranscript) when the user asks what was said, what decisions were made in past sessions, or asks for specific quotes.",
    "If the user asks about a meeting but the folder has no records with hasTranscript=true, say there is no recorded meeting transcript in this folder yet and tell them to start New Recording or import audio.",
    "If transcript search/read tools return empty or show no matching records, say transcript details are not available and keep the next step simple.",
    "Keep answers practical, specific, and under 180 words unless the user asks for detail.",
  ].join("\n"),
  tools: {
    listFolderMeetings,
    searchMeetingTranscripts,
    readMeetingTranscript,
  },
});

export const listMeetingMessages = query({
  args: {
    meetingId: v.id("meetings"),
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        streams: undefined,
      };
    }

    if (meeting.scopeKey !== identity.tokenIdentifier || meeting.agentThreadId !== args.threadId) {
      throw new Error("Meeting not found");
    }

    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });

    return { ...paginated, streams };
  },
});

export const streamMeetingReply = action({
  args: {
    meetingId: v.id("meetings"),
    prompt: v.string(),
    privateContext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const trimmed = args.prompt.trim();
    if (!trimmed) {
      throw new Error("Message body cannot be empty");
    }

    const context = await ctx.runQuery(internal.workspace.getMeetingContext, {
      meetingId: args.meetingId,
      scopeKey: identity.tokenIdentifier,
    });

    const threadId = await ctx.runMutation(internal.workspace.ensureMeetingAgentThread, {
      meetingId: args.meetingId,
      scopeKey: identity.tokenIdentifier,
    });

    if (shouldAnswerNoTranscriptYet(trimmed, context.folderTranscriptCount)) {
      await saveMessage(ctx, components.agent, {
        threadId,
        userId: identity.tokenIdentifier,
        prompt: trimmed,
        agentName: "SmartPuck",
      });
      await saveMessage(ctx, components.agent, {
        threadId,
        userId: identity.tokenIdentifier,
        message: {
          role: "assistant",
          content: buildNoTranscriptReply(context.folderName),
        },
        agentName: "SmartPuck",
      });
      return null;
    }

    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      await saveMessage(ctx, components.agent, {
        threadId,
        userId: identity.tokenIdentifier,
        prompt: trimmed,
        agentName: "SmartPuck",
      });
      await saveMessage(ctx, components.agent, {
        threadId,
        userId: identity.tokenIdentifier,
        message: {
          role: "assistant",
          content: `${buildFallbackReply(context, trimmed)}\n\nGemini is not configured yet. Set GEMINI_API_KEY in the Convex environment to enable live Gemini replies.`,
        },
        agentName: "SmartPuck",
      });
      return null;
    }

    const savedPrompt = await saveMessage(ctx, components.agent, {
      threadId,
      userId: identity.tokenIdentifier,
      prompt: trimmed,
      agentName: "SmartPuck",
    });

    const productContext = context.hasTranscript
      ? ""
      : ["SMARTPUCK PRODUCT CONTEXT:", SMARTPUCK_PROPOSAL_CONTEXT, ""].join("\n");
    const hiddenContext = [
      "Use this private context to answer. Do not quote or reveal this block as a user message.",
      "",
      productContext,
      context.hasTranscript
        ? "MODE: Transcript chat. Prefer the transcript. Do not invent app/product decisions as meeting content."
        : "MODE: Product or empty chat. If the user asks about meetings, say no transcript is available yet.",
      `FOLDER: ${context.folderName}`,
      `CHAT: ${context.meetingTitle}`,
      `CURRENT CHAT HAS TRANSCRIPT: ${context.hasTranscript ? "yes" : "no"}`,
      `TRANSCRIPTS IN THIS FOLDER: ${context.folderTranscriptCount}`,
      `SUMMARY: ${context.summary}`,
      `TRANSCRIPT PREVIEW: ${context.transcriptPreview}`,
      `DECISIONS: ${context.decisions.join("; ")}`,
      `ACTION ITEMS: ${context.actions.map((action: { owner: string; label: string }) => `${action.owner}: ${action.label}`).join("; ")}`,
      args.privateContext?.trim() ? `USER ATTACHMENTS:\n${args.privateContext.trim()}` : "",
    ].join("\n");

    const promptWithContext = [
      "System Context / Instructions:",
      hiddenContext,
      "",
      "User Query:",
      trimmed,
    ].join("\n");

    const result = await smartpuckAgent.streamText(
      ctx,
      { threadId, userId: identity.tokenIdentifier },
      {
        prompt: promptWithContext,
        promptMessageId: savedPrompt.messageId,
      },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );

    await result.consumeStream();

    return null;
  },
});

export const generatePinnedInsights = action({
  args: {
    meetingId: v.id("meetings"),
  },
  handler: async () => {
    // Placeholder only for now. Keep pinned insights static so ordinary chat replies
    // do not spend an extra model call.
    return null;
  },
});


function buildFallbackReply(
  context: {
    meetingTitle: string;
    hasTranscript: boolean;
    transcriptPreview: string;
  },
  userMessage: string,
) {
  const lower = userMessage.toLowerCase();

  if (context.hasTranscript) {
    return `I have the transcript for "${context.meetingTitle}", but live Gemini replies are not configured right now. Transcript preview:\n\n${context.transcriptPreview}`;
  }

  if (lower.includes("hardware") || lower.includes("device") || lower.includes("bom")) {
    return "SmartPuck's MVP hardware centers on a LOLIN S3 Pro ESP32-S3 board, INMP441 I2S microphone, onboard microSD storage, a 3.7V LiPo battery with JST PH2.0 connector, and simple button/LED controls. The target BOM stays under $50 and prioritizes reliable offline audio before camera, Wi-Fi, or mobile scope.";
  }

  if (lower.includes("transcript") || lower.includes("audio") || lower.includes("notes")) {
    return "SmartPuck imports audio from the device or a local file, sends it to the local faster-whisper transcription server, stores transcript text in Convex, and lets the chat search or read meeting transcripts through tools.";
  }

  if (lower.includes("scope") || lower.includes("future") || lower.includes("roadmap")) {
    return "The MVP should focus on offline recording, USB transfer, folder organization, saved chat threads, and AI-generated notes. Future scope includes Wi-Fi sync, wake word activation, speaker diarisation, a mobile companion app, and multi-unit sync.";
  }

  return `For "${context.meetingTitle}", the key SmartPuck idea is an offline puck-sized recorder that captures reliable far-field audio, then uses the web app to turn sessions into transcripts, summaries, decisions, and action items. Ask me about hardware, pipeline, workflow, budget, or roadmap.`;
}

function shouldAnswerNoTranscriptYet(userMessage: string, folderTranscriptCount: number) {
  if (folderTranscriptCount > 0) {
    return false;
  }

  const lower = userMessage.toLowerCase();
  return [
    "meeting",
    "transcript",
    "latest",
    "notes",
    "summarize",
    "decision",
    "action item",
    "what happened",
    "check my",
  ].some((phrase) => lower.includes(phrase));
}

function buildNoTranscriptReply(folderName: string) {
  return `I don't have a recorded meeting transcript in "${folderName}" yet. Start a New Recording or import an audio file, then I can summarize it, search it, and answer questions from it here.`;
}

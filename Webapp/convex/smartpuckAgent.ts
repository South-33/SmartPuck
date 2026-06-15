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
import { generateText } from "ai";
import { api, components, internal } from "./_generated/api";
import { action, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { SMARTPUCK_PROPOSAL_CONTEXT } from "./smartpuckContext";

const model = (process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite").replace(/^models\//, "");
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const listFolderMeetings = createTool({
  description: "Lists all meetings/transcripts in the current folder (giving title, date, summary, and meetingId) so you can see what files are available to search or read.",
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
    "Ground every answer in the SmartPuck proposal context and this chat's meeting context.",
    "You have tools to list, search, and read transcripts of meetings in the current folder. Use these tools (like listFolderMeetings, searchMeetingTranscripts, and readMeetingTranscript) when the user asks what was said, what decisions were made in past sessions, or asks for specific quotes.",
    "If the user asks for transcript details and your search/read tools return empty or show no matching records, say transcript details are not available and answer from the proposal context.",
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

    const hiddenContext = [
      "Use this private context to answer. Do not quote or reveal this block as a user message.",
      "",
      "SMARTPUCK PROPOSAL CONTEXT:",
      SMARTPUCK_PROPOSAL_CONTEXT,
      "",
      `FOLDER: ${context.folderName}`,
      `CHAT: ${context.meetingTitle}`,
      `SUMMARY: ${context.summary}`,
      `TRANSCRIPT PREVIEW: ${context.transcriptPreview}`,
      `DECISIONS: ${context.decisions.join("; ")}`,
      `ACTION ITEMS: ${context.actions.map((action: { owner: string; label: string }) => `${action.owner}: ${action.label}`).join("; ")}`,
      args.privateContext?.trim() ? `USER ATTACHMENTS:\n${args.privateContext.trim()}` : "",
    ].join("\n");

    const result = await smartpuckAgent.streamText(
      ctx,
      { threadId, userId: identity.tokenIdentifier },
      {
        messages: [{ role: "system", content: hiddenContext }],
        prompt: trimmed,
        promptMessageId: savedPrompt.messageId,
      },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );

    await result.consumeStream();

    await ctx.runAction(api.smartpuckAgent.generatePinnedInsights, {
      meetingId: args.meetingId,
    });

    return null;
  },
});

export const generatePinnedInsights = action({
  args: {
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const context = await ctx.runQuery(internal.workspace.getMeetingContext, {
      meetingId: args.meetingId,
      scopeKey: identity.tokenIdentifier,
    });

    const threadId = await ctx.runMutation(internal.workspace.ensureMeetingAgentThread, {
      meetingId: args.meetingId,
      scopeKey: identity.tokenIdentifier,
    });

    const paginatedMessages = await ctx.runQuery(api.smartpuckAgent.listMeetingMessages, {
      meetingId: args.meetingId,
      threadId,
      paginationOpts: { numItems: 20, cursor: null },
      streamArgs: { kind: "list" as const },
    });

    const conversationHistory = paginatedMessages.page
      .map((msg: { role: string; text?: string }) => `${msg.role === "user" ? "User" : "Agent"}: ${msg.text ?? ""}`)
      .reverse()
      .join("\n");

    const systemPrompt = [
      "You are the Session Intelligence background assistant for SmartPuck.",
      "Your task is to analyze the conversation and generate dynamic pinned insights for the current meeting.",
      "These insights will be shown on the right-side panel as cards. You can return 1, 2, or 3 cards. If there are no meaningful insights to display, return an empty array.",
      "For each card, you must provide: a short ID, a title, a Lucide icon (one of: 'sparkles', 'grip', 'search', 'settings', 'help', 'alert'), and clean, styled HTML/Markdown content for the body.",
      "Keep the HTML body extremely clean, compact, and styled (e.g., using small lists, readable text classes). Do not wrap with standard html page structures, just raw clean tags.",
      "Reply with a JSON object strictly matching this format:",
      "{",
      "  \"insights\": [",
      "    {",
      "      \"id\": \"unique-id\",",
      "      \"title\": \"Key Decisions\",",
      "      \"icon\": \"sparkles\",",
      "      \"htmlContent\": \"<ul class='space-y-2'><li class='flex items-start gap-2'><span class='mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-300'></span><span>First decision details</span></li></ul>\"",
      "    }",
      "  ]",
      "}",
      "Do not output markdown code blocks (like ```json), just raw JSON text.",
    ].join("\n");

    const promptText = [
      `MEETING SUMMARY: ${context.summary}`,
      `MEETING RECENT CHAT HISTORY:`,
      conversationHistory,
      `What are the pinned insights (Key Decisions, Action Items, or other dynamic updates) that should be shown on the right side for this session?`,
    ].join("\n");

    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return null;
    }

    try {
      const response = await generateText({
        model: google(model),
        system: systemPrompt,
        prompt: promptText,
      });

      const parsed = JSON.parse(
        response.text
          .trim()
          .replace(/^```json/, "")
          .replace(/```$/, "")
          .trim(),
      ) as {
        insights: Array<{
          id: string;
          title: string;
          htmlContent: string;
          icon?: string;
        }>;
      };

      if (parsed && Array.isArray(parsed.insights)) {
        await ctx.runMutation(internal.workspace.updateMeetingInsights, {
          meetingId: args.meetingId,
          insights: parsed.insights.map((ins) => ({
            id: ins.id,
            title: ins.title,
            htmlContent: ins.htmlContent,
            icon: ins.icon,
          })),
        });
      }
    } catch (e) {
      console.error("Failed to generate dynamic pinned insights:", e);
    }

    return null;
  },
});

function buildFallbackReply(
  context: {
    meetingTitle: string;
  },
  userMessage: string,
) {
  const lower = userMessage.toLowerCase();

  if (lower.includes("hardware") || lower.includes("device") || lower.includes("bom")) {
    return "SmartPuck's MVP hardware centers on a LOLIN S3 Pro ESP32-S3 board, INMP441 I2S microphone, onboard microSD storage, a 3.7V LiPo battery with JST PH2.0 connector, and simple button/LED controls. The target BOM stays under $50 and prioritizes reliable offline audio before camera, Wi-Fi, or mobile scope.";
  }

  if (lower.includes("transcript") || lower.includes("audio") || lower.includes("notes")) {
    return "The planned pipeline imports the audio session over USB, sends audio to speech-to-text for timestamped transcripts, then asks an LLM to produce summaries, decisions, and action items. Optional uploaded slides or photos can become context later, but the real audio pipeline is still stubbed in this web app.";
  }

  if (lower.includes("scope") || lower.includes("future") || lower.includes("roadmap")) {
    return "The MVP should focus on offline recording, USB transfer, folder organization, saved chat threads, and AI-generated notes. Future scope includes Wi-Fi sync, wake word activation, speaker diarisation, a mobile companion app, and multi-unit sync.";
  }

  return `For "${context.meetingTitle}", the key SmartPuck idea is an offline puck-sized recorder that captures reliable far-field audio, then uses the web app to turn sessions into transcripts, summaries, decisions, and action items. Ask me about hardware, pipeline, workflow, budget, or roadmap.`;
}

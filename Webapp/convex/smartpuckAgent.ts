import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  Agent,
  listUIMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, query } from "./_generated/server";
import { SMARTPUCK_PROPOSAL_CONTEXT } from "./smartpuckContext";

const model = (process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite").replace(/^models\//, "");
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

export const smartpuckAgent = new Agent(components.agent, {
  name: "SmartPuck",
  languageModel: google(model),
  instructions: [
    "You are SmartPuck Companion AI. Answer as a concise meeting and product assistant.",
    "Ground every answer in the SmartPuck proposal context and this chat's meeting context.",
    "If the user asks for unavailable transcript details, say live transcript processing is not connected yet and answer from the proposal context.",
    "Keep answers practical, specific, and under 180 words unless the user asks for detail.",
  ].join("\n"),
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
      `ACTION ITEMS: ${context.actions.map((action) => `${action.owner}: ${action.label}`).join("; ")}`,
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

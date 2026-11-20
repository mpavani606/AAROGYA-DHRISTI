import type { RequestHandler } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { AssistantExchange } from "../models/AssistantExchange.js";
import { searchKnowledge, type RetrievedPassage } from "../rag/search.js";
import { openAiJson, requireOpenAiKey } from "../rag/openai.js";
import { buildAssistantInstructions, guardAssistantResponse, passagesForPrompt, redactIdentifiers, safeFallback } from "../services/assistantPolicy.js";

const languageSchema = z.enum(["en", "te", "hi"]);
const modeSchema = z.enum(["education", "registration"]);
const fieldSchema = z.enum(["abha", "aarogyasri", "family", "name", "phone", "address", "date_of_birth", "consent", "summary", "general"]);
const searchSchema = z.object({ query: z.string().trim().min(2).max(1000), lang: languageSchema });
const toolSchema = z.object({
  query: z.string().trim().min(2).max(1000),
  language: languageSchema,
  mode: modeSchema.default("education")
});
const chatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  lang: languageSchema,
  mode: modeSchema.default("education"),
  field: fieldSchema.optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).max(12).default([])
});
const sessionSchema = z.object({ lang: languageSchema, mode: modeSchema.default("education"), field: fieldSchema.optional() });
const fail = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });

async function logExchange(prompt: string, passages: RetrievedPassage[], language: "en" | "te" | "hi", mode: "education" | "registration", modelVersion: string) {
  await AssistantExchange.create({
    prompt: redactIdentifiers(prompt),
    sourceSlugs: [...new Set(passages.map((passage) => passage.sourceSlug))],
    modelVersion,
    language,
    mode
  });
}

export const ragSearch: RequestHandler = async (req, res, next) => {
  try {
    const body = searchSchema.parse(req.body);
    const passages = await searchKnowledge(body.query, body.lang);
    await logExchange(body.query, passages, body.lang, "education", "rag-search");
    res.json({ passages });
  } catch (error) { next(error); }
};

export const searchMedicalKnowledge: RequestHandler = async (req, res, next) => {
  try {
    const body = toolSchema.parse(req.body);
    const passages = await searchKnowledge(body.query, body.language);
    await logExchange(body.query, passages, body.language, body.mode, env.OPENAI_REALTIME_MODEL);
    res.json({
      passages,
      response: passages.length ? undefined : safeFallback(body.query, body.language, passages)
    });
  } catch (error) { next(error); }
};

type ChatCompletionResponse = { choices?: Array<{ message?: { content?: string | null } }> };

export const assistantChat: RequestHandler = async (req, res, next) => {
  try {
    const body = chatSchema.parse(req.body);
    const passages = await searchKnowledge(body.message, body.lang);
    const fallback = safeFallback(body.message, body.lang, passages);
    if (fallback) {
      await logExchange(body.message, passages, body.lang, body.mode, env.OPENAI_CHAT_MODEL);
      return res.json({ answer: fallback, sources: [...new Set(passages.map((passage) => passage.sourceSlug))] });
    }

    requireOpenAiKey();
    const contextInstruction = body.mode === "registration"
      ? `Current registration context: ${body.field ?? "general"}. Explain only the purpose and how to complete the field. Do not collect or repeat personal identifiers.`
      : "Education mode is active.";
    const messages = [
      { role: "system", content: `${buildAssistantInstructions(body.mode, body.field)}\n\nRetrieved reviewed passages (the only allowed factual source for medical answers):\n${passagesForPrompt(passages)}\n\n${contextInstruction}` },
      ...body.history.map((entry) => ({ role: entry.role, content: entry.content })),
      { role: "user", content: body.message }
    ];
    const completion = await openAiJson<ChatCompletionResponse>("chat/completions", {
      model: env.OPENAI_CHAT_MODEL,
      messages,
      max_tokens: 300,
      temperature: 0.2
    });
    const answer = completion.choices?.[0]?.message?.content?.trim();
    if (!answer) throw fail(502, "ASSISTANT_EMPTY_RESPONSE", "The education assistant did not return an answer.");
    await logExchange(body.message, passages, body.lang, body.mode, env.OPENAI_CHAT_MODEL);
    res.json({
      answer: guardAssistantResponse(answer, body.lang),
      sources: [...new Set(passages.map((passage) => passage.sourceSlug))]
    });
  } catch (error) { next(error); }
};

type RealtimeSecretResponse = { value?: string; expires_at?: number; client_secret?: { value?: string; expires_at?: number } };

export function publicRealtimeCredentials(result: RealtimeSecretResponse) {
  const clientSecret = result.value ?? result.client_secret?.value;
  const expiresAt = result.expires_at ?? result.client_secret?.expires_at;
  if (!clientSecret || !expiresAt) throw fail(502, "REALTIME_SESSION_INVALID", "The voice session could not be created.");
  return { clientSecret, expiresAt };
}

export const createRealtimeSession: RequestHandler = async (req, res, next) => {
  try {
    const body = sessionSchema.parse(req.body);
    requireOpenAiKey();
    const tool = {
      type: "function",
      name: "search_medical_knowledge",
      description: "Search reviewed educational passages before answering any medical education question.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The user's medical education question; omit names and personal identifiers." },
          language: { type: "string", enum: ["en", "te", "hi"] }
        },
        required: ["query", "language"],
        additionalProperties: false
      }
    };
    const result = await openAiJson<RealtimeSecretResponse>("realtime/client_secrets", {
      session: {
        type: "realtime",
        model: env.OPENAI_REALTIME_MODEL,
        instructions: buildAssistantInstructions(body.mode, body.field),
        tools: [tool],
        tool_choice: "auto",
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe", language: body.lang },
            turn_detection: { type: "server_vad", create_response: true }
          },
          output: { voice: "marin" }
        }
      }
    });
    res.status(201).json(publicRealtimeCredentials(result));
  } catch (error) { next(error); }
};

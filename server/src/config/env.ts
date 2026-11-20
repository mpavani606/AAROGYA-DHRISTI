import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? "../.env" });

const requiredSecret = z.string().min(32).refine(
  (value) => !/^(replace|development|change-me)/i.test(value),
  "Must be a non-placeholder secret of at least 32 characters"
);
export const clientOrigins = z.string().transform((value, context) => {
  const origins: string[] = [];
  for (const rawOrigin of value.split(",")) {
    const origin = rawOrigin.trim();
    if (!origin) continue;
    try {
      const url = new URL(origin);
      if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Path, search, or hash not allowed in origin.");
      }
      origins.push(url.origin);
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "CLIENT_URL must contain comma-separated origins." });
      return z.NEVER;
    }
  }

  if (!origins.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "CLIENT_URL must contain comma-separated origins." });
    return z.NEVER;
  }

  return [...new Set(origins)].join(",");
});

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: clientOrigins.default("http://localhost:5173"),
  MONGODB_URI: z.string().default("mongodb://localhost:27017/aarogya_drishti"),
  SMS_MODE: z.enum(["mock", "live"]).default("mock"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  DAILY_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  JWT_SECRET: requiredSecret,
  JWT_REFRESH_SECRET: requiredSecret,
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("7d"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4.1-mini"),
  RAG_VECTOR_INDEX: z.string().default("knowledge_chunks_vector"),
  RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.45),
  RAG_TOP_K: z.coerce.number().int().min(1).max(10).default(5),
  APP_ENCRYPTION_KEY: requiredSecret,
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  LOCAL_MEDIA_STORAGE: z.enum(["true", "false"]).default("true"),
  AI_BLUR_MIN: z.coerce.number().positive().default(35),
  AI_DARK_MAX: z.coerce.number().min(0).max(1).default(0.35),
  AI_GLARE_MAX: z.coerce.number().min(0).max(1).default(0.12)
});
export const env = schema.parse(process.env);

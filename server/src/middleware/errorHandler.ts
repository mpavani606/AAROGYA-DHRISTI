import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../services/logger.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const validationError = error instanceof ZodError;
  const status = validationError ? 400 : typeof error?.status === "number" ? error.status : error?.code === "LIMIT_FILE_SIZE" ? 413 : 500;
  const code = validationError ? "VALIDATION_ERROR" : error?.code || "INTERNAL_ERROR";
  const message = validationError ? "The request is invalid." : status === 500 ? "An unexpected error occurred." : error.message;
  const field = typeof error?.field === "string" ? error.field : undefined;
  logger.error({ requestId: res.getHeader("x-request-id"), statusCode: status, code }, "request failed");
  res.status(status).json({ error: { code, message_en: message, message_te: validationError ? "అభ్యర్థన చెల్లదు." : "ఊహించని లోపం సంభవించింది.", message_hi: validationError ? "अनुरोध अमान्य है।" : "एक अनपेक्षित त्रुटि हुई।", ...(field ? { field } : {}) } });
};

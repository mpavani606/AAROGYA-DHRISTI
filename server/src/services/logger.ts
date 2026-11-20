import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body",
      "body",
      "password",
      "passwordHash",
      "phone",
      "email",
      "name",
      "address",
      "abha",
      "aarogyasri",
      "mfaSecret",
      "refreshToken",
      "accessToken",
      "clientSecret",
      "*.patientId",
      "*.patient",
      "*.caseId",
      "*.case",
      "*.diagnosis",
      "*.findings",
      "*.reason"
    ],
    censor: "[REDACTED]"
  },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime
});

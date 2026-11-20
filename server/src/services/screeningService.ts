import { performance } from "node:perf_hooks";
import { z } from "zod";
import { AiInference } from "../models/AiInference.js";
import { AiServiceEvent } from "../models/AiServiceEvent.js";
import { AiModel } from "../models/AiModel.js";
import { CaseImage } from "../models/CaseImage.js";
import { Task } from "../models/Task.js";
import { AuditLog } from "../models/AuditLog.js";
import { demoInfer } from "./aiService.js";
import { logger } from "./logger.js";

const inferenceInputSchema = z.object({
  redFlag: z.boolean(),
  quality: z.object({ pass: z.boolean() }).strict(),
  model: z.custom<InstanceType<typeof AiModel>>((value): value is InstanceType<typeof AiModel> => value instanceof AiModel)
}).strict();
const OBJECT_ID = /^[a-f\d]{24}$/i;
const INFERENCE_TIMEOUT_MS = 10_000;

export const screeningCategory = (state: string) => {
  if (state === "image_insufficient") return "INSUFFICIENT_IMAGE_QUALITY";
  if (state === "suspicious_finding_for_clinical_review") return "SUSPICIOUS_FEATURES_REQUIRE_REVIEW";
  if (state === "no_suspicious_finding_by_demo_model") return "NO_SUSPICIOUS_FEATURES_IDENTIFIED";
  return "AI_PROCESSING_UNAVAILABLE";
};

async function recordServiceEvent(event: {
  status: "completed" | "failed" | "unavailable";
  resultCategory?: string;
  modelVersion: string;
  durationMs: number;
  errorCode?: string;
}) {
  try {
    await AiServiceEvent.create(event);
  } catch (error) {
    logger.error({ error }, "AI operations telemetry could not be persisted");
  }
}

async function runDemoProvider(input: z.infer<typeof inferenceInputSchema>) {
  const parsed = inferenceInputSchema.parse(input);
  return demoInfer(parsed);
}

async function withInferenceTimeout<T>(operation: () => Promise<T>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("AI processing timed out."), { code: "AI_SERVICE_TIMEOUT" })), INFERENCE_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function inferPersistedImage(caseId: string, image: InstanceType<typeof CaseImage>, actorId: string) {
  if (!OBJECT_ID.test(caseId) || !OBJECT_ID.test(image._id.toString()) || !OBJECT_ID.test(actorId)) {
    throw Object.assign(new Error("Invalid screening reference."), { status: 400, code: "INVALID_SCREENING_REFERENCE" });
  }
  const startedAt = performance.now();
  let modelVersion = "unknown";
  let modelRedFlagTaskType: string | undefined;
  let redFlag = false;
  let inference: InstanceType<typeof AiInference>;
  let category: string;
  try {
    const model = await AiModel.findOne({ key: "demo", status: "active" }) ?? await AiModel.create({
      key: "demo",
      name: "Aarogya Drishti Demo Model",
      version: "1.0.0",
      license: "Demo",
      permitted_use: "Demonstration and research only",
      redFlagTaskType: "clinical-review"
    });
    modelVersion = model.version;
    modelRedFlagTaskType = model.redFlagTaskType;
    const previous = await AiInference.findOne({ case: caseId, image: image._id, model: model._id });
    if (previous) {
      category = screeningCategory(previous.state);
      await recordServiceEvent({ status: "completed", resultCategory: category, modelVersion, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) });
      return { inference: previous, category };
    }

    const result = await withInferenceTimeout(() => runDemoProvider({
      redFlag: Number.parseInt((image.sha256 ?? "00").slice(0, 2), 16) % 4 === 0,
      quality: { pass: image.qualityStatus === "usable" },
      model
    }));
    redFlag = result.output.redFlag;
    category = screeningCategory(result.state);
    inference = await AiInference.create({
      case: caseId,
      image: image._id,
      model: model._id,
      state: result.state,
      output: { ...result.output, category },
      metadata: result.metadata
    });
    await recordServiceEvent({ status: "completed", resultCategory: category, modelVersion, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) });
  } catch (error) {
    const timedOut = Boolean(error && typeof error === "object" && "code" in error && error.code === "AI_SERVICE_TIMEOUT");
    await recordServiceEvent({
      status: timedOut ? "unavailable" : "failed",
      modelVersion,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorCode: timedOut ? "AI_SERVICE_TIMEOUT" : "INFERENCE_FAILED"
    });
    throw error;
  }
  if (redFlag && modelRedFlagTaskType) {
    await Task.create({ case: caseId, patient: image.patient, type: modelRedFlagTaskType, source: "ai", details: { inferenceId: inference._id } });
  }
  await AuditLog.create({
    actor: actorId,
    action: "ai_screening_completed",
    resource: "AiInference",
    resourceId: inference._id.toString(),
    metadata: { category, modelVersion }
  });
  return { inference, category };
}

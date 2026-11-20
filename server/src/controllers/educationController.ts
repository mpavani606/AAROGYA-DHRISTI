import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { AuditLog } from "../models/AuditLog.js";
import { EducationPage, type EducationPageFields } from "../models/EducationPage.js";
import { FoodItem, type FoodItemFields } from "../models/FoodItem.js";
import { educationCopyIsAllowed } from "../services/educationSafety.js";
import { canTransitionEducation } from "../services/educationWorkflow.js";

const languageSchema = z.enum(["en", "te", "hi"]);
const querySchema = z.object({ language: languageSchema.optional() }).strict();
const slugSchema = z.string().min(2).max(100).regex(/^[a-z0-9-]+$/);
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const pageSchema = z.object({
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  title_en: z.string().min(2).max(200), title_te: z.string().min(2).max(200), title_hi: z.string().min(2).max(200),
  body_en: z.string().min(10).max(4_000), body_te: z.string().min(10).max(4_000), body_hi: z.string().min(10).max(4_000),
  audioRef_en: z.string().max(500).optional(), audioRef_te: z.string().max(500).optional(), audioRef_hi: z.string().max(500).optional()
});
const fail = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });
const getLanguage = (query: unknown) => querySchema.parse(query).language ?? "en";

export const educationPages: RequestHandler = async (req, res, next) => {
  try {
    const language = getLanguage(req.query);
    const pages = await EducationPage.find({ $or: [{ status: "published" }, { seeded: true }] })
      .select("slug title_en title_te title_hi status reviewedBy reviewedAt")
      .populate("reviewedBy", "name").sort({ slug: 1 }).lean<EducationPageFields[]>();
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json({ pages: pages.map((page) => ({
      _id: page._id,
      slug: page.slug,
      title: language === "en" ? page.title_en : language === "te" ? page.title_te : page.title_hi,
      status: page.status,
      reviewedBy: page.reviewedBy,
      reviewedAt: page.reviewedAt
    })) });
  } catch (error) { next(error); }
};

export const educationPage: RequestHandler = async (req, res, next) => {
  try {
    const language = getLanguage(req.query);
    const slug = slugSchema.parse(req.params.slug);
    const page = await EducationPage.findOne({ slug, $or: [{ status: "published" }, { seeded: true }] })
      .populate("reviewedBy", "name");
    if (!page) throw fail(404, "EDUCATION_PAGE_NOT_FOUND", "This education page is not available.");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json({ page: {
      _id: page._id, slug: page.slug,
      title: language === "en" ? page.title_en : language === "te" ? page.title_te : page.title_hi,
      body: language === "en" ? page.body_en : language === "te" ? page.body_te : page.body_hi,
      audioRef: language === "en" ? page.audioRef_en : language === "te" ? page.audioRef_te : page.audioRef_hi,
      status: page.status, reviewedBy: page.reviewedBy, reviewedAt: page.reviewedAt
    } });
  } catch (error) { next(error); }
};

export const educationAudio: RequestHandler = async (req, res, next) => {
  try {
    const language = getLanguage(req.query);
    const slug = slugSchema.parse(req.params.slug);
    const page = await EducationPage.findOne({ slug, $or: [{ status: "published" }, { seeded: true }] }).select("+audioCache");
    if (!page) throw fail(404, "EDUCATION_PAGE_NOT_FOUND", "This education page is not available.");
    const audioRef = language === "en" ? page.audioRef_en : language === "te" ? page.audioRef_te : page.audioRef_hi;
    if (typeof audioRef === "string" && /^\/education\/audio\/[A-Za-z0-9._/-]+$/.test(audioRef) && !audioRef.includes("..")) return res.redirect(302, audioRef);
    const cached = page.audioCache?.get(language);
    if (cached) {
      res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=2592000", "X-Content-Type-Options": "nosniff" });
      return res.send(cached);
    }
    if (!env.OPENAI_API_KEY) throw fail(503, "TTS_UNAVAILABLE", "Audio is not available. Use the device voice reader.");
    const text = language === "en" ? page.body_en : language === "te" ? page.body_te : page.body_hi;
    if (!text.trim()) throw fail(422, "EDUCATION_AUDIO_EMPTY", "This page has no text to read.");
    if (!educationCopyIsAllowed(text)) throw fail(422, "EDUCATION_COPY_REJECTED", "This page cannot be read aloud until its wording is revised.");
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.OPENAI_TTS_MODEL, voice: "alloy", input: text, response_format: "mp3" }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      const requestId = response.headers.get("x-request-id");
      throw Object.assign(new Error("Speech generation service is unavailable."), { status: 502, code: "TTS_PROVIDER_ERROR", requestId });
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0 || audio.length > 10 * 1024 * 1024) throw fail(502, "TTS_INVALID_AUDIO", "Audio generation returned an invalid file.");
    await EducationPage.updateOne({ _id: page._id, [`audioCache.${language}`]: { $exists: false } }, { $set: { [`audioCache.${language}`]: audio } });
    res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=2592000", "X-Content-Type-Options": "nosniff" });
    res.send(audio);
  } catch (error) { next(error); }
};

export const foodItems: RequestHandler = async (req, res, next) => {
  try {
    const language = getLanguage(req.query);
    const items = await FoodItem.find().select("-__v").sort({ category: 1, key: 1 }).lean<FoodItemFields[]>();
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.json({ items: items.map((item) => ({
      ...item,
      name: language === "en" ? item.name_en : language === "te" ? item.name_te : item.name_hi,
      suitabilityNote: item.suitabilityNote?.[language] ?? item.suitabilityNote?.en
    })) });
  } catch (error) { next(error); }
};

export const managedPages: RequestHandler = async (_req, res, next) => {
  try {
    z.object({}).strict().parse(_req.query);
    const pages = await EducationPage.find().select("-audioCache").populate("reviewedBy", "name").sort({ updatedAt: -1 }).lean();
    res.json({ pages });
  } catch (error) { next(error); }
};

export const createEducationPage: RequestHandler = async (req, res, next) => {
  try {
    const body = pageSchema.parse(req.body);
    if ([body.audioRef_en, body.audioRef_te, body.audioRef_hi].some((value) => value && (!/^\/education\/audio\/[A-Za-z0-9._/-]+$/.test(value) || value.includes("..")))) throw fail(400, "INVALID_AUDIO_REFERENCE", "Audio references must use the local education audio path.");
    if (![body.body_en, body.body_te, body.body_hi].every(educationCopyIsAllowed)) throw fail(400, "EDUCATION_COPY_REJECTED", "Revise patient-facing wording before saving this page.");
    const page = await EducationPage.create({ ...body, status: "draft", seeded: false });
    await AuditLog.create({ actor: req.user!.id, action: "education_created", resource: "EducationPage", resourceId: page.id, ip: req.ip });
    res.status(201).json({ page });
  } catch (error) { next(error); }
};

export const updateEducationPage: RequestHandler = async (req, res, next) => {
  try {
    const id = objectIdSchema.parse(req.params.id);
    const body = pageSchema.omit({ slug: true }).partial().refine((value) => Object.keys(value).length > 0).parse(req.body);
    if (![body.body_en, body.body_te, body.body_hi].filter((value): value is string => value !== undefined).every(educationCopyIsAllowed)) throw fail(400, "EDUCATION_COPY_REJECTED", "Revise patient-facing wording before saving this page.");
    if ([body.audioRef_en, body.audioRef_te, body.audioRef_hi].some((value) => value && !value.startsWith("/education/audio/"))) throw fail(400, "INVALID_AUDIO_REFERENCE", "Audio references must use the local education audio path.");
    const page = await EducationPage.findById(id);
    if (!page) throw fail(404, "EDUCATION_PAGE_NOT_FOUND", "This education page is not available.");
    if (page.status !== "draft") throw fail(409, "EDUCATION_PAGE_LOCKED", "Only draft pages can be edited. Create a new version for changes.");
    Object.assign(page, body);
    await page.save();
    await AuditLog.create({ actor: req.user!.id, action: "education_updated", resource: "EducationPage", resourceId: page.id, ip: req.ip });
    res.json({ page });
  } catch (error) { next(error); }
};

export const reviewEducationPage: RequestHandler = async (req, res, next) => {
  try {
    const id = objectIdSchema.parse(req.params.id);
    z.object({ confirmed: z.literal(true) }).parse(req.body);
    const page = await EducationPage.findById(id);
    if (!page) throw fail(404, "EDUCATION_PAGE_NOT_FOUND", "This education page is not available.");
    if (!canTransitionEducation(page.status, "review")) throw fail(409, "EDUCATION_INVALID_TRANSITION", "Only a draft page can be reviewed.");
    page.status = "reviewed";
    page.reviewedBy = new Types.ObjectId(req.user!.id);
    page.reviewedAt = new Date();
    await page.save();
    await AuditLog.create({ actor: req.user!.id, action: "education_reviewed", resource: "EducationPage", resourceId: page.id, ip: req.ip });
    res.json({ page });
  } catch (error) { next(error); }
};

export const publishEducationPage: RequestHandler = async (req, res, next) => {
  try {
    const id = objectIdSchema.parse(req.params.id);
    z.object({ confirmed: z.literal(true) }).parse(req.body);
    const page = await EducationPage.findById(id);
    if (!page) throw fail(404, "EDUCATION_PAGE_NOT_FOUND", "This education page is not available.");
    if (!canTransitionEducation(page.status, "publish") || !page.reviewedBy || !page.reviewedAt) throw fail(409, "EDUCATION_INVALID_TRANSITION", "A clinician must review the page before publication.");
    page.status = "published";
    await page.save();
    await AuditLog.create({ actor: req.user!.id, action: "education_published", resource: "EducationPage", resourceId: page.id, ip: req.ip });
    res.json({ page });
  } catch (error) { next(error); }
};

import type { RequestHandler } from "express";
import { Consent } from "../models/Consent.js";
import { Case } from "../models/Case.js";
export const isConsentActive = (consent: { granted: boolean; expiresAt?: Date | null } | null) => Boolean(consent?.granted && (!consent.expiresAt || consent.expiresAt > new Date()));
export const requireConsent = (purpose: string): RequestHandler => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required." } });
  const patientId = req.params.patientId || req.body.patientId;
  const consent = await Consent.findOne({ patient: patientId, purpose, granted: true, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] });
  if (!isConsentActive(consent)) return res.status(403).json({ error: { code: "CONSENT_REQUIRED", message_en: `${purpose} consent is required.` } });
  next();
};

export const requirePatientScreeningConsent: RequestHandler = async (req, res, next) => {
  if (req.user?.role !== "patient") return next();
  try {
    let patientId = String(req.params.patientId ?? req.body?.patientId ?? "");
    if (!patientId && (req.params.id || req.params.caseId)) {
      const item = await Case.findById(req.params.id ?? req.params.caseId).select("patient");
      patientId = item?.patient.toString() ?? "";
    }
    if (!patientId) return res.status(400).json({ error: { code: "PATIENT_REQUIRED", message_en: "A patient record is required for screening." } });
    const consent = await Consent.findOne({
      patient: patientId,
      purpose: "screening",
      granted: true,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
    });
    if (!isConsentActive(consent)) return res.status(403).json({ error: { code: "CONSENT_REQUIRED", message_en: "Patient screening consent is required." } });
    next();
  } catch (error) {
    next(error);
  }
};

export const requireActiveScreeningConsent: RequestHandler = async (req, res, next) => {
  try {
    let patientId = String(req.params.patientId ?? req.body?.patientId ?? "");
    const caseId = String(req.body?.caseId ?? req.params.caseId ?? req.params.id ?? "");
    if (!patientId && caseId) {
      const item = await Case.findById(caseId).select("patient");
      patientId = item?.patient.toString() ?? "";
    }
    if (!patientId) return res.status(400).json({ error: { code: "PATIENT_REQUIRED", message_en: "A patient record is required for screening." } });
    const consent = await Consent.findOne({
      patient: patientId,
      purpose: "screening",
      granted: true,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
    });
    if (!isConsentActive(consent)) return res.status(403).json({ error: { code: "CONSENT_REQUIRED", message_en: "Patient screening consent is required." } });
    next();
  } catch (error) {
    next(error);
  }
};

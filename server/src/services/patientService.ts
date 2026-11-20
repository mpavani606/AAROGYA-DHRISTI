import crypto from "node:crypto";
import { Patient } from "../models/Patient.js";
import { encrypt, decrypt } from "./encryption.js";

export const normalizeName = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const teluguMap: Record<string, string> = { "ర": "ra", "ా": "a", "మ": "ma", "ే": "e", "శ": "sha", "్": "", "వ": "va", "ి": "i", "న": "na", "య": "ya", "క": "ka", "ల": "la", "స": "sa", "త": "ta", "ప": "pa", "ు": "u", "ొ": "o", "ో": "o", "ఆ": "a", "అ": "a" };
export const transliterateTelugu = (value: string) => [...value].map((c) => teluguMap[c] || c).join("");
export const similarity = (a: string, b: string) => {
  const x = normalizeName(a), y = normalizeName(b); const d = Array.from({ length: x.length + 1 }, (_, i) => i);
  for (let j = 1; j <= y.length; j++) { let prev = d[0]; d[0] = j; for (let i = 1; i <= x.length; i++) { const t = d[i]; d[i] = Math.min(d[i] + 1, d[i - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1)); prev = t; } }
  return 1 - d[x.length] / Math.max(x.length, y.length, 1);
};
export const ageFromDateOfBirth = (date: string, today = new Date()): number | undefined => {
  const birth = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(birth.getTime()) || birth > today) return undefined;
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (today.getUTCMonth() < birth.getUTCMonth() || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
};
export const findPossibleDuplicates = async (name: string, mandal: string) => {
  const candidates = await Patient.find({ mandal, active: true }).limit(100);
  return candidates.filter((p) => similarity(name, decrypt(p.name)) >= 0.8 || similarity(transliterateTelugu(name), transliterateTelugu(decrypt(p.name))) >= 0.8);
};
export const encryptPatientFields = (input: Record<string, unknown>) => {
  const out: Record<string, unknown> = { ...input };
  if (typeof input.name === "string") out.nameNormalized = normalizeName(input.name);
  if (typeof input.dateOfBirth === "string") {
    const ageYears = ageFromDateOfBirth(input.dateOfBirth);
    if (ageYears !== undefined) out.ageYears = ageYears;
  }
  if (typeof input.phone === "string") out.phoneHash = hashIdentifier(input.phone);
  for (const field of ["name", "phone", "address", "district", "village", "dateOfBirth", "abha", "aarogyasri"]) if (typeof out[field] === "string") out[field] = encrypt(out[field] as string);
  return out;
};
export const presentPatient = (patient: { toObject?: () => Record<string, unknown> } & Record<string, unknown>) => {
  const out = patient.toObject ? patient.toObject() : { ...patient };
  delete out.phoneHash;
  for (const field of ["name", "phone", "address", "district", "village", "dateOfBirth", "abha", "aarogyasri"]) if (out[field]) out[field] = decrypt(String(out[field]));
  return out;
};
export const hashIdentifier = (value: string) => crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
export const normalizePhone = (value: string) => {
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(compact)) return `+91${compact}`;
  if (/^91\d{10}$/.test(compact)) return `+${compact}`;
  if (/^\+\d{7,15}$/.test(compact)) return compact;
  throw Object.assign(new Error("Enter a valid phone number with country code."), { status: 400, code: "INVALID_PHONE" });
};
export const phoneVariants = (value: string) => {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/\D/g, "");
  const variants = new Set([value.trim(), normalized, digits]);
  if (digits.startsWith("91") && digits.length === 12) variants.add(digits.slice(2));
  return [...variants];
};
export const phoneHashVariants = (value: string) => [...new Set(phoneVariants(value).map(hashIdentifier))];

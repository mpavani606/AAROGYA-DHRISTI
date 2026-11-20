import crypto from "node:crypto";
import { env } from "../config/env.js";
const secret = env.JWT_SECRET;
export function signLocationToken(patientId: string) {
  const payload = `${patientId}.${Date.now()}.${crypto.randomUUID()}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}
export function verifyLocationToken(token: string, patientId: string) {
  const decoded = Buffer.from(token, "base64url").toString("utf8").split(".");
  if (decoded.length !== 4 || decoded[0] !== patientId) return false;
  const [id, issuedAt, nonce, signature] = decoded;
  if (Date.now() - Number(issuedAt) > 15 * 60 * 1000) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${id}.${issuedAt}.${nonce}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

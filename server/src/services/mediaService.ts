import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

const localRoot = path.resolve(process.cwd(), "storage", "media");
export const MAX_MEDIA_SIZE = 10 * 1024 * 1024;
export const detectMime = (buffer: Buffer): "application/pdf" | "image/jpeg" | "image/png" | null => {
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  return null;
};
export const processUpload = async (buffer: Buffer, declaredMime: string) => {
  if (buffer.length > MAX_MEDIA_SIZE) throw Object.assign(new Error("File must be 10MB or smaller."), { status: 413, code: "FILE_TOO_LARGE" });
  const detected = detectMime(buffer);
  if (!detected || detected !== declaredMime) throw Object.assign(new Error("File content does not match an allowed PDF or image."), { status: 400, code: "INVALID_FILE_TYPE" });
  if (detected === "application/pdf") return { buffer, mimeType: detected };
  const output = await sharp(buffer).rotate().toFormat("jpeg", { quality: 90 }).toBuffer({ resolveWithObject: true });
  return { buffer: output.data, mimeType: "image/jpeg" as const, width: output.info.width, height: output.info.height };
};
export const saveLocal = async (buffer: Buffer, key: string) => {
  const filePath = path.join(localRoot, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
};
export const localFile = (key: string) => path.join(localRoot, key);
export async function inspectMediaStorage() {
  if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
    return { mode: "cloudinary", status: "configured_unverified" as const };
  }
  try {
    await fs.access(localRoot);
    return { mode: "local", status: "available" as const };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { mode: "local", status: "not_initialized" as const };
    }
    return { mode: "local", status: "unavailable" as const };
  }
}
export const hashBuffer = (buffer: Buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
export const expiry = () => new Date(Date.now() + 5 * 60 * 1000);
export const localSignedUrl = (key: string, expiresAt: Date) => {
  const expires = expiresAt.getTime();
  const signature = crypto.createHmac("sha256", env.JWT_SECRET).update(`${key}:${expires}`).digest("hex");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `/api/v1/media/${encodedKey}?expires=${expires}&signature=${signature}`;
};
export const uploadCloudinary = (buffer: Buffer, key: string, mimeType: string) => {
  cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET });
  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ public_id: key, resource_type: mimeType === "application/pdf" ? "raw" : "image", type: "private" }, (error, result) => {
      if (error || !result) reject(error ?? new Error("Cloudinary upload failed."));
      else resolve(result.public_id);
    });
    stream.end(buffer);
  });
};
export const cloudinarySignedUrl = (key: string, expiresAt: Date, mimeType: string) => {
  cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET });
  return cloudinary.url(key, { resource_type: mimeType === "application/pdf" ? "raw" : "image", type: "private", sign_url: true, secure: true, expires_at: Math.floor(expiresAt.getTime() / 1000) });
};

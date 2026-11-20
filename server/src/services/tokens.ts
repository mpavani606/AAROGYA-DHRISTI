import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";

export type TokenPayload = { sub: string; role: string; ver?: number; type: "access" | "refresh" };
export const signAccessToken = (payload: Omit<TokenPayload, "type">) =>
  jwt.sign({ ...payload, type: "access" }, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL } as SignOptions);
export const signRefreshToken = (payload: Omit<TokenPayload, "type">) =>
  jwt.sign({ ...payload, type: "refresh", jti: crypto.randomUUID() }, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TOKEN_TTL } as SignOptions);
export const verifyAccessToken = (token: string) => jwt.verify(token, env.JWT_SECRET) as TokenPayload;
export const verifyRefreshToken = (token: string) => {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
  if (payload.type !== "refresh") throw Object.assign(new Error("Invalid refresh token."), { status: 401, code: "INVALID_REFRESH_TOKEN" });
  return payload;
};
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

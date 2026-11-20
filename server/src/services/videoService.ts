import { env } from "../config/env.js";

type DailyRoom = { name: string; url: string };
type DailyMeetingToken = { token: string };

const dailyError = (message: string, status: number, code: string) =>
  Object.assign(new Error(message), { status, code });

async function dailyRequest<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const apiKey = process.env.DAILY_API_KEY ?? env.DAILY_API_KEY;
  if (!apiKey) {
    throw dailyError("Video consultations are not configured. Set DAILY_API_KEY on the server.", 503, "VIDEO_PROVIDER_NOT_CONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(`https://api.daily.co/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (cause) {
    throw Object.assign(dailyError("The video provider is temporarily unavailable.", 503, "VIDEO_PROVIDER_UNAVAILABLE"), { cause });
  }
  if (!response.ok) {
    throw dailyError("The video provider could not complete this request.", response.status === 409 ? 409 : 502, response.status === 409 ? "VIDEO_ROOM_EXISTS" : "VIDEO_PROVIDER_ERROR");
  }
  try {
    return await response.json() as T;
  } catch (cause) {
    throw Object.assign(dailyError("The video provider returned an invalid response.", 502, "VIDEO_PROVIDER_INVALID_RESPONSE"), { cause });
  }
}

export async function createDailyRoom(roomName: string, expiresAt: Date) {
  const body = {
    name: roomName,
    privacy: "private",
    properties: {
      exp: Math.floor(expiresAt.getTime() / 1000),
      eject_at_room_exp: true,
      enable_recording: "off",
      enable_chat: true
    }
  };
  try {
    return await dailyRequest<DailyRoom>("rooms", "POST", body);
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "VIDEO_ROOM_EXISTS") throw error;
    return dailyRequest<DailyRoom>(`rooms/${encodeURIComponent(roomName)}`, "GET");
  }
}

export async function createDailyMeetingToken(roomName: string, expiresAt: Date, userId: string, userName: string, isOwner: boolean) {
  const response = await dailyRequest<DailyMeetingToken>("meeting-tokens", "POST", {
    properties: {
      room_name: roomName,
      exp: Math.floor(expiresAt.getTime() / 1000),
      user_id: userId,
      user_name: userName,
      is_owner: isOwner,
      eject_at_token_exp: true
    }
  });
  return response.token;
}

export function isVideoSessionActive(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() > now.getTime();
}

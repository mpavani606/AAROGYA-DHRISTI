import type { RequestHandler } from "express";
import { User } from "../models/User.js";
export const me: RequestHandler = async (req, res, next) => {
  try { const user = await User.findById(req.user!.id).select("_id email name phone role subRole locale language mfaEnabled relationships hospitalId assignments createdAt"); if (!user) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "User not found." } }); res.json({ user }); } catch (e) { next(e); }
};

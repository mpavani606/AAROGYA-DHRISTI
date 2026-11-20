import type { RequestHandler } from "express";
import { Hospital } from "../models/Geo.js";
import { User } from "../models/User.js";
import { verifyAccessToken } from "../services/tokens.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: { id: string; role: string; phone?: string; hospitalId?: string; subRole?: string; assignments?: Array<{ scope?: string; district?: string; mandal?: string; village?: string; habitation?: string; phc?: string; hospital?: string }>; }; } }
}
export const auth: RequestHandler = async (req, res, next) => {
  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required.", message_te: "ప్రామాణీకరణ అవసరం.", message_hi: "प्रमाणीकरण आवश्यक है।" } });
    payload = verifyAccessToken(header.slice(7));
  } catch {
    return res.status(401).json({ error: { code: "INVALID_TOKEN", message_en: "Invalid or expired token." } });
  }
  try {
    const user = await User.findById(payload.sub).select("_id role subRole assignments hospitalId status mfaEnabled phone tokenVersion lockedUntil");
    if (!user || payload.type !== "access") return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required.", message_te: "ప్రామాణీకరణ అవసరం.", message_hi: "प्रमाणीकरण आवश्यक है।", wipeLocalData: true } });
    if (user.role === "employee") return res.status(401).json({ error: { code: "ROLE_DEACTIVATED", message_en: "This legacy account role is no longer active.", wipeLocalData: true } });
    if ((payload.ver ?? 0) !== (user.tokenVersion ?? 0)) return res.status(401).json({ error: { code: "SESSION_REVOKED", message_en: "This session is no longer valid.", wipeLocalData: true } });
    if (user.status !== "active") return res.status(401).json({ error: { code: "ACCOUNT_REVOKED", message_en: "This account is no longer active.", message_te: "ఈ ఖాతా చురుకుగా లేదు.", message_hi: "यह खाता अब सक्रिय नहीं है।", wipeLocalData: true } });
    if (user.lockedUntil && user.lockedUntil > new Date()) return res.status(401).json({ error: { code: "ACCOUNT_LOCKED", message_en: "This account is temporarily locked.", wipeLocalData: true } });
    if (["doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"].includes(user.role) && !user.mfaEnabled) return res.status(403).json({ error: { code: "MFA_SETUP_REQUIRED", message_en: "Multi-factor authentication must be configured before access.", message_te: "ప్రవేశానికి ముందు బహుళ-దశల ధృవీకరణను ఏర్పాటు చేయాలి.", message_hi: "प्रवेश से पहले बहु-कारक प्रमाणीकरण सेट करना आवश्यक है।" } });
    if (user.role === "hospital_manager") {
      if (!user.hospitalId) return res.status(403).json({ error: { code: "HOSPITAL_ASSIGNMENT_REQUIRED", message_en: "An active hospital assignment is required." } });
      if (!await Hospital.exists({ _id: user.hospitalId, active: true })) return res.status(403).json({ error: { code: "HOSPITAL_INACTIVE", message_en: "The assigned hospital is not active." } });
    }
    req.user = { id: user._id.toString(), role: user.role, phone: user.phone, assignments: user.assignments, hospitalId: user.hospitalId?.toString(), subRole: user.subRole };
    next();
  } catch (error) { next(error); }
};

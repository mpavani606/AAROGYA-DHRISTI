import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { generateSecret, generateURI, verify } from "otplib";
import { env } from "../config/env.js";
import { OtpChallenge } from "../models/OtpChallenge.js";
import { Patient } from "../models/Patient.js";
import { Consent } from "../models/Consent.js";
import { User } from "../models/User.js";
import { Hospital } from "../models/Geo.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { AuditLog } from "../models/AuditLog.js";
import { ageFromDateOfBirth, encryptPatientFields, normalizePhone, phoneHashVariants, phoneVariants, presentPatient } from "./patientService.js";
import { assertSmsConfigured, sendOtpSms } from "./smsService.js";
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokens.js";

type AuthUser = { _id: { toString(): string }; email?: string; username?: string; name: string; phone?: string; role: string; locale?: string; language?: string; mfaEnabled: boolean; mfaSecret?: string; refreshTokenHash?: string; hospitalId?: { toString(): string }; tokenVersion?: number; status?: string; passwordSetupTokenHash?: string; passwordSetupExpiresAt?: Date; };
const publicUser = (u: AuthUser) => ({ id: u._id.toString(), email: u.email, username: u.username, name: u.name, phone: u.phone, role: u.role, ...(u.hospitalId ? { hospitalId: u.hospitalId.toString() } : {}), language: u.language ?? u.locale ?? "en", mfaEnabled: u.mfaEnabled });
const tokensFor = async (user: AuthUser) => {
  const claims = { sub: user._id.toString(), role: user.role, ver: user.tokenVersion ?? 0 };
  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken(claims);
  await User.updateOne({ _id: user._id }, { refreshTokenHash: hashToken(refreshToken), lastLoginAt: new Date(), failedLoginAttempts: 0, $unset: { lockedUntil: 1 } });
  return { accessToken, refreshToken };
};
export const register = async (_input: { email?: string; password: string; name: string; phone: string; locale?: string; otp?: string }) => {
  throw Object.assign(new Error("Patient accounts are created from verified patient records. Use mobile OTP sign-in."), {
    status: 410,
    code: "PATIENT_REGISTRATION_UNAVAILABLE"
  });
};

export const registerPatient = async (input: { name: string; phone: string; age: number; dateOfBirth?: string; address?: string; district: string; mandal?: string; village: string; preferredLanguage?: "en" | "te" | "hi"; consent: true }) => {
  const phone = normalizePhone(input.phone);
  const candidates = phoneHashVariants(phone);
  const existing = await Patient.findOne({ phoneHash: { $in: candidates } }).select("_id phoneHash");
  if (existing) {
    throw Object.assign(new Error("This mobile number is already registered. Please sign in instead."), {
      status: 409,
      code: "PATIENT_ALREADY_REGISTERED"
    });
  }

  const ageYears = input.age ?? (input.dateOfBirth ? ageFromDateOfBirth(input.dateOfBirth) : undefined);
  const created = await Patient.create({
    ...encryptPatientFields({
      name: input.name,
      phone,
      address: input.address,
      district: input.district,
      village: input.village,
      dateOfBirth: input.dateOfBirth,
      ageYears,
      mandal: input.mandal ?? "Paderu",
      preferredLanguage: input.preferredLanguage ?? "en"
    }),
    active: false,
    registrationStatus: "pending_verification",
    version: 1
  });
  try {
    await Consent.create({ patient: created._id, purpose: "registration", granted: true, consentVersion: "simulation-registration-v1" });
  } catch (error) {
    await Patient.deleteOne({ _id: created._id });
    throw error;
  }

  return {
    message: "Registration saved. Verify the mobile number to activate the patient account.",
    patient: presentPatient(created)
  };
};

type DoctorRegistrationField = "username" | "email" | "phone" | "registrationNo";

const doctorRegistrationConflict = (field: DoctorRegistrationField) => {
  const messages: Record<DoctorRegistrationField, string> = {
    username: "This username is already associated with an account. Sign in if it is yours, or choose another username.",
    email: "This email is already associated with an account. Sign in if it is yours, or use another email.",
    phone: "This mobile number is already associated with an account. Sign in if it is yours, or use another number.",
    registrationNo: "This professional registration number is already in use. Check the number or contact support if you believe this is an error."
  };
  return Object.assign(new Error(messages[field]), { status: 409, code: "DOCTOR_REGISTRATION_CONFLICT", field });
};

const duplicateDoctorField = (error: unknown): DoctorRegistrationField | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 11000) return undefined;
  const keyPattern = "keyPattern" in error ? error.keyPattern : undefined;
  if (typeof keyPattern !== "object" || keyPattern === null) return undefined;
  for (const field of ["username", "email", "phone", "registrationNo"] as const) {
    if (field in keyPattern) return field;
  }
  return undefined;
};

export const registerDoctor = async (input: { name: string; username: string; email: string; phone: string; password: string; registrationNo: string; registrationAuthority: string; specialty: string; hospitalName: string; qualification: string; experienceYears: number }) => {
    const phone = normalizePhone(input.phone);
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    const registrationNo = input.registrationNo.trim().toUpperCase();
    const [usernameExists, emailExists, phoneExists, registrationNoExists] = await Promise.all([
      User.exists({ username }),
      User.exists({ email }),
      User.exists({ phone }),
      DoctorProfile.exists({ registrationNo })
    ]);
    if (usernameExists) throw doctorRegistrationConflict("username");
    if (emailExists) throw doctorRegistrationConflict("email");
    if (phoneExists) throw doctorRegistrationConflict("phone");
    if (registrationNoExists) throw doctorRegistrationConflict("registrationNo");
    let user: InstanceType<typeof User> | undefined;
    try {
      user = await User.create({
        name: input.name.trim(),
        username,
        email,
        phone,
        passwordHash: await bcrypt.hash(input.password, 12),
        role: "doctor",
        status: "active",
        mfaEnabled: false,
        locale: "en"
      });
      const profile = await DoctorProfile.create({
        user: user._id,
        registrationNo,
        registrationAuthority: input.registrationAuthority.trim(),
        specialty: input.specialty.trim(),
        hospitalName: input.hospitalName.trim(),
        qualification: input.qualification.trim(),
        experienceYears: input.experienceYears,
        verificationStatus: "draft"
      });
      await AuditLog.create({ actor: user._id, action: "doctor.registration.created", resource: "doctor_profile", resourceId: profile._id.toString(), metadata: { outcome: "success" } });
      return { message: "Doctor account created. Sign in with your email, username, or mobile number and password to continue professional verification.", user: publicUser(user.toObject()) };
    } catch (error) {
      if (user) {
        await DoctorProfile.deleteOne({ user: user._id });
        await User.deleteOne({ _id: user._id });
      }
      const field = duplicateDoctorField(error);
      if (field) throw doctorRegistrationConflict(field);
      throw error;
    }
};

const invalidCredentials = () => Object.assign(new Error("Invalid credentials."), { status: 401, code: "INVALID_CREDENTIALS" });
const normalizeLoginIdentifier = (identifier: string) => {
  const value = identifier.trim();
  if (value.includes("@")) return { email: value.toLowerCase() };
  const compact = value.replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(compact)) return { phone: `+91${compact}` };
  if (/^91\d{10}$/.test(compact)) return { phone: `+${compact}` };
  if (/^\+\d{7,15}$/.test(compact)) return { phone: compact };
  return { username: value.toLowerCase() };
};
const activeHospitalAssignment = async (user: { role: string; hospitalId?: unknown }) => {
  if (user.role !== "hospital_manager" || !user.hospitalId) return false;
  return Boolean(await Hospital.exists({ _id: user.hospitalId, active: true }));
};
const invalidMfaChallenge = () => Object.assign(new Error("The MFA challenge is invalid or expired."), { status: 401, code: "INVALID_MFA" });
const verifyMfaChallenge = (mfaToken: string) => {
  let payload: { sub: string; type: string };
  try {
    payload = jwt.verify(mfaToken, env.JWT_SECRET) as { sub: string; type: string };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) throw invalidMfaChallenge();
    throw error;
  }
  if (!["mfa", "mfa_setup"].includes(payload.type)) throw invalidMfaChallenge();
  return payload;
};
const hospitalCodeMatches = async (user: { role: string; hospitalId?: unknown }, hospitalCode?: string) => {
  if (user.role !== "hospital_manager" || !user.hospitalId || !hospitalCode) return false;
  const escapedCode = hospitalCode.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(await Hospital.exists({ _id: user.hospitalId, code: { $regex: `^${escapedCode}$`, $options: "i" }, active: true }));
};

export const login = async (identifier: string, password: string, requestedRole?: string, hospitalCode?: string) => {
  const identifierFilter = normalizeLoginIdentifier(identifier);
  const user = await User.findOne(identifierFilter).select("+passwordHash +refreshTokenHash +mfaSecret +passwordSetupTokenHash");
  if (!user) throw invalidCredentials();
  if (user.role === "employee") throw invalidCredentials();
  if (requestedRole && user.role !== requestedRole) throw invalidCredentials();
  if (user.status !== "active" || (user.role === "hospital_manager" && !await hospitalCodeMatches(user, hospitalCode))) throw invalidCredentials();
  if (user.lockedUntil && user.lockedUntil > new Date()) throw Object.assign(new Error("Account temporarily locked."), { status: 423, code: "ACCOUNT_LOCKED" });
  if (!await bcrypt.compare(password, user.passwordHash)) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= 5) user.lockedUntil = new Date(Date.now() + 15 * 60_000);
    await user.save();
    throw invalidCredentials();
  }
  if (user.passwordSetupTokenHash) throw Object.assign(new Error("Complete the secure password setup before signing in."), { status: 403, code: "PASSWORD_SETUP_REQUIRED" });
  if (["doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"].includes(user.role) && !user.mfaEnabled) {
    return { mfaSetupRequired: true, mfaToken: jwt.sign({ sub: user._id.toString(), type: "mfa_setup" }, env.JWT_SECRET, { expiresIn: "10m" }) };
  }
  if (user.mfaEnabled) return { mfaRequired: true, mfaToken: jwt.sign({ sub: user._id.toString(), type: "mfa" }, env.JWT_SECRET, { expiresIn: "5m" }) };
  return { user: publicUser(user), ...await tokensFor(user) };
};

const otpHash = (challengeId: string, code: string) =>
  crypto.createHmac("sha256", env.JWT_SECRET).update(`${challengeId}:${code}`).digest("hex");
const invalidOtp = () => Object.assign(new Error("The verification code is invalid or expired."), { status: 401, code: "INVALID_OTP" });

export const requestPatientOtp = async (phoneInput: string) => {
  assertSmsConfigured();
  const phone = normalizePhone(phoneInput);
  const candidates = phoneHashVariants(phoneInput);
  const matches = await Patient.find({
    phoneHash: { $in: candidates },
    $or: [{ active: true }, { registrationStatus: "pending_verification" }]
  }).select("_id phoneHash").limit(2);
  const challengeId = crypto.randomBytes(12).toString("hex");
  if (matches.length !== 1) return { accepted: true, challengeId };

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const challenge = await OtpChallenge.create({
    _id: challengeId,
    patient: matches[0]._id,
    phoneHash: matches[0].phoneHash,
    codeHash: otpHash(challengeId, code),
    expiresAt: new Date(Date.now() + 5 * 60_000)
  });
  try {
    if (env.SMS_MODE === "mock" && env.NODE_ENV !== "production") {
      return { accepted: true, challengeId, devOtp: code };
    }
    await sendOtpSms(phone, code);
  } catch (error) {
    await OtpChallenge.deleteOne({ _id: challenge._id });
    throw error;
  }
  return { accepted: true, challengeId };
};

export const verifyPatientOtp = async (challengeId: string, code: string) => {
  const now = new Date();
  const challenge = await OtpChallenge.findOne({
    _id: challengeId,
    expiresAt: { $gt: now },
    attempts: { $lt: 5 },
    consumedAt: { $exists: false }
  });
  if (!challenge) throw invalidOtp();

  const expected = Buffer.from(challenge.codeHash, "hex");
  const received = Buffer.from(otpHash(challengeId, code), "hex");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    const updated = await OtpChallenge.findOneAndUpdate(
      { _id: challengeId, expiresAt: { $gt: now }, attempts: { $lt: 5 }, consumedAt: { $exists: false } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (updated?.attempts === 5) await OtpChallenge.deleteOne({ _id: challengeId });
    throw invalidOtp();
  }

  const consumed = await OtpChallenge.findOneAndUpdate(
    { _id: challengeId, expiresAt: { $gt: now }, attempts: { $lt: 5 }, consumedAt: { $exists: false } },
    { $set: { consumedAt: now } },
    { new: true }
  );
  if (!consumed) throw invalidOtp();

  let patient = await Patient.findOne({
    _id: consumed.patient,
    phoneHash: consumed.phoneHash,
    $or: [{ active: true }, { registrationStatus: "pending_verification" }]
  });
  if (!patient) throw invalidOtp();
  const patientData = presentPatient(patient) as { name: string; phone?: string };
  if (!patientData.phone) throw invalidOtp();

  const storedPhones = phoneVariants(patientData.phone);
  let user = await User.findOne({ phone: { $in: storedPhones } }).select("+refreshTokenHash");
  if (user && user.role !== "patient") {
    throw Object.assign(new Error("This phone number is assigned to a non-patient account."), { status: 403, code: "ROLE_MISMATCH" });
  }
  if (!patient.active) {
    if (!await Consent.exists({ patient: patient._id, purpose: "registration", granted: true })) throw invalidOtp();
    const activated = await Patient.findOneAndUpdate(
      { _id: patient._id, phoneHash: consumed.phoneHash, active: false, registrationStatus: "pending_verification" },
      { $set: { active: true, registrationStatus: "verified", phoneVerifiedAt: now } },
      { new: true }
    );
    if (!activated) throw invalidOtp();
    patient = activated;
  }
  if (!user) {
    const normalizedPhone = normalizePhone(patientData.phone);
    const usernameSuffix = crypto.randomBytes(6).toString("hex");
    user = await User.create({
      name: patientData.name,
      phone: normalizedPhone,
      username: `patient-${usernameSuffix}`,
      passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12),
      role: "patient"
    });
  }

  return { user: publicUser(user), ...await tokensFor(user) };
};
export const setupMfaForChallenge = async (mfaToken: string) => {
  const payload = verifyMfaChallenge(mfaToken);
  if (payload.type !== "mfa_setup") throw invalidMfaChallenge();
  const user = await User.findById(payload.sub);
  if (!user || user.status !== "active" || (user.lockedUntil && user.lockedUntil > new Date()) || user.mfaEnabled || !["doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"].includes(user.role) || (user.role === "hospital_manager" && !await activeHospitalAssignment(user))) throw Object.assign(new Error("MFA enrollment is unavailable."), { status: 403, code: "FORBIDDEN" });
  const secret = generateSecret();
  await User.updateOne({ _id: user._id }, { $set: { mfaSecret: secret, mfaEnabled: false } });
  return { secret, otpauthUrl: generateURI({ issuer: "Aarogya Drishti", label: user.email ?? user.phone ?? user._id.toString(), secret }) };
};
export const verifyMfa = async (mfaToken: string | undefined, code: string) => {
  if (!mfaToken) throw invalidMfaChallenge();
  const payload = verifyMfaChallenge(mfaToken);
  const user = await User.findById(payload.sub).select("+mfaSecret");
  if (!user || user.role === "employee" || user.status !== "active" || (user.lockedUntil && user.lockedUntil > new Date()) || !user.mfaSecret || (user.role === "hospital_manager" && !await activeHospitalAssignment(user)) || !(await verify({ token: code, secret: user.mfaSecret })).valid) throw Object.assign(new Error("Invalid MFA code."), { status: 401, code: "INVALID_MFA" });
  if (payload.type === "mfa_setup") {
    if (user.mfaEnabled || !["doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"].includes(user.role)) throw Object.assign(new Error("MFA enrollment is unavailable."), { status: 403, code: "FORBIDDEN" });
    user.mfaEnabled = true;
    await user.save();
  } else if (["doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"].includes(user.role) && !user.mfaEnabled) {
    throw Object.assign(new Error("MFA must be enrolled before sign-in."), { status: 403, code: "MFA_SETUP_REQUIRED" });
  }
  return { user: publicUser(user), ...await tokensFor(user) };
};
export const refresh = async (token?: string) => {
  if (!token) throw Object.assign(new Error("Refresh token required."), { status: 401, code: "INVALID_REFRESH_TOKEN" });
  const payload = verifyRefreshToken(token);
  const user = await User.findById(payload.sub).select("+refreshTokenHash +mfaSecret");
  const mfaRequired = user && ["doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"].includes(user.role);
  if (!user?.refreshTokenHash || user.role === "employee" || user.status !== "active" || (user.lockedUntil && user.lockedUntil > new Date()) || (payload.ver ?? 0) !== (user.tokenVersion ?? 0) || user.refreshTokenHash !== hashToken(token) || (mfaRequired && (!user.mfaEnabled || !user.mfaSecret)) || (user.role === "hospital_manager" && !await activeHospitalAssignment(user))) throw Object.assign(new Error("Invalid refresh token."), { status: 401, code: "INVALID_REFRESH_TOKEN" });
  return { user: publicUser(user), ...await tokensFor(user) };
};
export const logout = async (id: string) => { await User.updateOne({ _id: id }, { $inc: { tokenVersion: 1 }, $unset: { refreshTokenHash: 1 } }); };

export const setManagerPassword = async (token: string, password: string) => {
  const user = await User.findOne({
    role: "hospital_manager",
    passwordSetupTokenHash: hashToken(token),
    passwordSetupExpiresAt: { $gt: new Date() }
  }).select("+passwordSetupTokenHash");
  if (!user || user.status !== "active" || !await activeHospitalAssignment(user)) {
    throw Object.assign(new Error("The password setup link is invalid or expired."), { status: 400, code: "INVALID_SETUP_TOKEN" });
  }
  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordSetupTokenHash = undefined;
  user.passwordSetupExpiresAt = undefined;
  user.refreshTokenHash = undefined;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  return { message: "Password set. Sign in with your Hospital ID and manager username." };
};

export const setAshaWorkerPassword = async (token: string, password: string) => {
  const user = await User.findOne({
    role: "asha_worker",
    passwordSetupTokenHash: hashToken(token),
    passwordSetupExpiresAt: { $gt: new Date() }
  }).select("+passwordSetupTokenHash");
  if (!user || user.status !== "active") {
    throw Object.assign(new Error("The password setup link is invalid or expired."), { status: 400, code: "INVALID_SETUP_TOKEN" });
  }
  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordSetupTokenHash = undefined;
  user.passwordSetupExpiresAt = undefined;
  user.refreshTokenHash = undefined;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  return { message: "Password set. Sign in as an ASHA worker and enroll multi-factor authentication." };
};

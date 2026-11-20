import { describe, expect, it } from "@jest/globals";
import express from "express";
import request from "supertest";
import { authRoutes } from "../routes/authRoutes.js";
import { clientOrigins } from "../config/env.js";
import { auditLogQuerySchema, hospitalManagerInputSchema, hospitalManagerStatusSchema, publicUserPayload } from "../controllers/adminController.js";
import { patientListQuerySchema, createPatientQuerySchema, patientSchema } from "../controllers/patientController.js";
import { mandalsQuerySchema } from "../controllers/geoController.js";
import { syncCreatePatientPayloadSchema, syncPullQuerySchema } from "../controllers/syncController.js";
import { doctorRegisterSchema, loginSchema, managerPasswordSetupSchema, patientRegisterSchema } from "../middleware/validate.js";
import { hasRequiredRole } from "../middleware/rbac.js";
import { activeUserRoles, User } from "../models/User.js";
import { app } from "../app.js";

const doctorRegistrationRateLimitApp = express();
doctorRegistrationRateLimitApp.set("trust proxy", 1);
doctorRegistrationRateLimitApp.use(express.json());
doctorRegistrationRateLimitApp.use("/api/v1/auth", authRoutes);

describe("security input validation", () => {
  it("accepts valid client origins with trailing slashes and rejects malformed ones", () => {
    expect(clientOrigins.safeParse("https://app.example.com/").success).toBe(true);
    expect(clientOrigins.safeParse("https://app.example.com/,http://localhost:5173/").success).toBe(true);
    expect(clientOrigins.safeParse("https://app.example.com/path").success).toBe(false);
    expect(clientOrigins.safeParse("not-a-url").success).toBe(false);
  });

  it("allows local Vite fallback ports without allowing remote browser origins", async () => {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://localhost:5199"]) {
      const response = await request(app)
        .options("/api/v1/auth/doctor/register")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type");

      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
    }

    const remoteOrigin = await request(app)
      .options("/api/v1/auth/doctor/register")
      .set("Origin", "http://192.0.2.10:5174")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    expect(remoteOrigin.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows ten doctor registration corrections before applying the doctor-specific rate limit", async () => {
    const responses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(await request(doctorRegistrationRateLimitApp)
        .post("/api/v1/auth/doctor/register")
        .set("X-Forwarded-For", "198.51.100.42")
        .send({}));
    }

    expect(responses.slice(0, 10).map((response) => response.status)).toEqual(Array(10).fill(400));
    expect(responses[10].status).toBe(429);
    expect(responses[10].body.error.message_en).toContain("doctor registration attempts");
  });

  it("bounds and rejects unexpected audit-log filters", () => {
    expect(auditLogQuerySchema.safeParse({ limit: "500" }).success).toBe(true);
    expect(auditLogQuerySchema.safeParse({ limit: "501" }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ unexpected: "filter" }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ from: "2025-02-01T00:00:00.000Z", to: "2025-01-01T00:00:00.000Z" }).success).toBe(false);
  });

  it("allows only bounded patient, geography, and sync query inputs", () => {
    expect(patientListQuerySchema.safeParse({ mandal: "Paderu" }).success).toBe(true);
    expect(patientListQuerySchema.safeParse({ mandal: { $ne: "" } }).success).toBe(false);
    expect(createPatientQuerySchema.safeParse({ confirm: "true" }).success).toBe(true);
    expect(createPatientQuerySchema.safeParse({ confirm: "yes" }).success).toBe(false);
    expect(mandalsQuerySchema.safeParse({ district: "507f1f77bcf86cd799439011" }).success).toBe(true);
    expect(mandalsQuerySchema.safeParse({ district: { $ne: null } }).success).toBe(false);
    expect(syncPullQuerySchema.safeParse({ since: "2025-01-01T00:00:00.000Z" }).success).toBe(true);
    expect(syncPullQuerySchema.safeParse({ since: "not-a-date" }).success).toBe(false);
  });

  it("validates the patient details persisted by offline registration sync", () => {
    const payload = { name: "Synthetic Patient", phone: "+919000000000", mandal: "Synthetic Mandal", preferredLanguage: "en" };
    expect(syncCreatePatientPayloadSchema.safeParse({ ...payload, dateOfBirth: "1990-01-01" }).success).toBe(true);
    expect(syncCreatePatientPayloadSchema.safeParse({ ...payload, dateOfBirth: "2030-01-01" }).success).toBe(false);
    expect(syncCreatePatientPayloadSchema.safeParse({ ...payload, unexpected: "field" }).success).toBe(false);
  });

  it("accepts only supported patient language preferences", () => {
    expect(patientSchema.safeParse({ name: "Synthetic Patient", phone: "9000000000", mandal: "Paderu", preferredLanguage: "te" }).success).toBe(true);
    expect(patientSchema.safeParse({ name: "Synthetic Patient", mandal: "Paderu", preferredLanguage: "xx" }).success).toBe(false);
  });

  it("accepts an omitted or blank optional registration address, but validates supplied addresses", () => {
    const registration = {
      name: "Synthetic Patient",
      phone: "+919000000000",
      age: 30,
      district: "Synthetic District",
      mandal: "Synthetic Mandal",
      village: "Synthetic Village",
      consent: true
    };

    expect(patientRegisterSchema.safeParse(registration).success).toBe(true);
    expect(patientRegisterSchema.safeParse({ ...registration, address: "   " }).success).toBe(true);
    expect(patientRegisterSchema.safeParse({ ...registration, address: "A " }).success).toBe(false);
  });

  it("never exposes password or MFA secrets in admin-created user payloads", () => {
    const storedUser = {
      _id: "507f1f77bcf86cd799439011",
      name: "Synthetic User",
      email: "user@example.test",
      role: "doctor",
      passwordHash: "hash",
      mfaSecret: "totp-secret",
      refreshTokenHash: "refresh-hash",
      failedLoginAttempts: 2
    };

    const payload = publicUserPayload(storedUser);
    expect(payload).toMatchObject({ _id: storedUser._id, email: storedUser.email, role: storedUser.role });
    expect(payload).not.toHaveProperty("passwordHash");
    expect(payload).not.toHaveProperty("mfaSecret");
    expect(payload).not.toHaveProperty("refreshTokenHash");
    expect(payload).not.toHaveProperty("failedLoginAttempts");
  });

  it("retains legacy employee documents while excluding employee from active roles", () => {
    const roles = User.schema.path("role").options.enum;
    expect(roles).toEqual(expect.arrayContaining(["patient", "employee", "doctor", "hospital_manager", "district_admin", "system_admin"]));
    expect(activeUserRoles).toEqual(["patient", "doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"]);
    expect(hasRequiredRole("hospital_manager", ["hospital_manager"])).toBe(true);
    expect(hasRequiredRole("hospital_manager", ["district_admin", "system_admin"])).toBe(false);
    expect(hasRequiredRole("district_admin", ["system_admin"])).toBe(false);
    expect(hasRequiredRole("asha_worker", ["asha_worker"])).toBe(true);
    expect(hasRequiredRole("employee", [...activeUserRoles])).toBe(false);
  });

  it("requires a Hospital ID for manager login and a strong one-time setup password", () => {
    const login = { identifier: "manager-01", password: "not-a-real-password", role: "hospital_manager" };
    expect(loginSchema.safeParse(login).success).toBe(false);
    expect(loginSchema.safeParse({ ...login, hospitalCode: "HOSP-01" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "legacy", password: "pass", role: "employee" }).success).toBe(false);
    expect(doctorRegisterSchema.safeParse({
      name: "Synthetic Doctor",
      username: "doctor.test",
      email: "doctor@example.test",
      phone: "+919876543210",
      password: "Synthetic-Doctor-Pass-2026!",
      registrationNo: "REG-001",
      registrationAuthority: "Synthetic Medical Council",
      specialty: "Oral Medicine",
      hospitalName: "Synthetic Hospital",
      qualification: "Dental Degree",
      experienceYears: 8
    }).success).toBe(true);
    expect(doctorRegisterSchema.safeParse({
      name: "Synthetic Doctor",
      username: "doctor.test",
      email: "doctor@example.test",
      phone: "+919876543210",
      password: "Synthetic-Doctor-Pass-2026!",
      registrationNo: "REG-001",
      registrationAuthority: "Synthetic Medical Council",
      specialty: "Oral Medicine",
      qualification: "Dental Degree",
      experienceYears: 8
    }).success).toBe(false);
    expect(doctorRegisterSchema.safeParse({ username: "doctor.test", password: "weak" }).success).toBe(false);
    expect(managerPasswordSetupSchema.safeParse({ token: "a".repeat(64), password: "short-pass" }).success).toBe(false);
    expect(managerPasswordSetupSchema.safeParse({ token: "a".repeat(64), password: "a-strong-password-123" }).success).toBe(true);
  });

  it("validates a single-hospital manager assignment and only active/disabled lifecycle states", () => {
    const manager = { hospitalId: "507f1f77bcf86cd799439011", name: "Synthetic Manager", username: "manager-01", email: "manager@example.test" };
    expect(hospitalManagerInputSchema.safeParse(manager).success).toBe(true);
    expect(hospitalManagerInputSchema.safeParse({ ...manager, role: "system_admin" }).success).toBe(false);
    expect(hospitalManagerStatusSchema.safeParse({ status: "disabled" }).success).toBe(true);
    expect(hospitalManagerStatusSchema.safeParse({ status: "locked" }).success).toBe(false);
  });
});

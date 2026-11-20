import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { generate, generateSecret } from "otplib";
import sharp from "sharp";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { Hospital, District } from "../models/Geo.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { Consent } from "../models/Consent.js";
import { MedicineInventory } from "../models/MedicineInventory.js";
import { Notification } from "../models/Notification.js";
import { Patient } from "../models/Patient.js";
import { SyncBatch } from "../models/SyncBatch.js";
import { SyncItem } from "../models/SyncItem.js";
import { Token } from "../models/Token.js";
import { User } from "../models/User.js";
import { login, refresh as refreshService, setManagerPassword, setupMfaForChallenge, verifyMfa } from "../services/authService.js";
import { hashToken, signAccessToken, signRefreshToken } from "../services/tokens.js";

const enabled = process.env.RUN_MONGO_INTEGRATION_TESTS === "1";
const integration = enabled ? describe : describe.skip;
const managerPassword = "Synthetic-Manager-Pass-2026!";
const nextManagerPassword = "Synthetic-Manager-Next-2026!";
const adminPassword = "Synthetic-Admin-Pass-2026!";
const employeePassword = "Synthetic-Employee-Pass-2026!";
const doctorPassword = "Synthetic-Doctor-Pass-2026!";
const doctorPasswordB = "Synthetic-Doctor-B-Pass-2026!";
const districtAdminPassword = "Synthetic-District-Pass-2026!";
const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

jest.setTimeout(60_000);

integration("MongoDB-backed hospital manager authentication", () => {
  let districtA: InstanceType<typeof District>;
  let districtB: InstanceType<typeof District>;
  let hospitalA: InstanceType<typeof Hospital>;
  let hospitalB: InstanceType<typeof Hospital>;
  let hospitalC: InstanceType<typeof Hospital>;
  let hospitalD: InstanceType<typeof Hospital>;
  let hospitalACode: string;
  let hospitalBCode: string;
  let inactiveHospital: InstanceType<typeof Hospital>;
  let systemAdmin: InstanceType<typeof User>;
  let adminToken = "";
  let managerAId = "";
  let managerASetupToken = "";
  let managerAAccessToken = "";
  let managerARefreshToken = "";
  let managerASecret = "";
  let adminSecret = "";
  let managerBId = "";
  let managerBSetupToken = "";
  let managerBAccessToken = "";
  let disabledManagerId = "";
  let disabledManagerSetupToken = "";
  let expiredManagerSetupToken = "";
  let doctorUser: InstanceType<typeof User>;
  let doctorUserB: InstanceType<typeof User>;
  let districtAdmin: InstanceType<typeof User>;
  let employee: InstanceType<typeof User>;
  let doctorSecret = "";
  let districtAdminSecret = "";

  const createManager = async (input: { username: string; email: string; hospitalId: string; name: string }) =>
    request(app)
      .post("/api/v1/admin/hospital-managers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(input);

  const totp = (secret: string) => generate({ secret });
  const cookieHeaders = (value: string | string[] | undefined) => Array.isArray(value) ? value : value ? [value] : [];
  const refreshCookieHeader = (value: string | string[] | undefined) => cookieHeaders(value).find((cookie) => cookie.startsWith("aarogya_refresh="));
  beforeAll(async () => {
    let databaseName = "";
    try {
      const uri = new URL(env.MONGODB_URI);
      databaseName = decodeURIComponent(uri.pathname.slice(1));
      if (!["localhost", "127.0.0.1", "::1"].includes(uri.hostname.toLowerCase())) {
        throw new Error("MongoDB integration tests require a loopback MongoDB host.");
      }
      if (!/^aarogya_phase03a_[a-z0-9_]+$/i.test(databaseName)) {
        throw new Error("MongoDB integration tests require a uniquely named aarogya_phase03a_* database.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("MongoDB integration tests")) throw error;
      throw new Error("MongoDB integration tests require a valid isolated MongoDB URI.");
    }

    await mongoose.connect(env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([User.init(), Hospital.init(), District.init(), Patient.init(), DoctorProfile.init(), MedicineInventory.init()]);

    districtA = await District.create({ name: "Synthetic District A", code: `TEST-DA-${uniqueSuffix}` });
    districtB = await District.create({ name: "Synthetic District B", code: `TEST-DB-${uniqueSuffix}` });
    hospitalA = await Hospital.create({
      name: "Synthetic Hospital A",
      code: `TEST-HA-${uniqueSuffix}`,
      district: districtA._id,
      active: true,
      synthetic: true
    });
    hospitalACode = hospitalA.code!;
    hospitalB = await Hospital.create({
      name: "Synthetic Hospital B",
      code: `TEST-HB-${uniqueSuffix}`,
      district: districtB._id,
      active: true,
      synthetic: true
    });
    hospitalBCode = hospitalB.code!;
    hospitalC = await Hospital.create({
      name: "Synthetic Hospital C",
      code: `TEST-HC-${uniqueSuffix}`,
      district: districtA._id,
      active: true,
      synthetic: true
    });
    hospitalD = await Hospital.create({
      name: "Synthetic Hospital D",
      code: `TEST-HD-${uniqueSuffix}`,
      district: districtB._id,
      active: true,
      synthetic: true
    });
    inactiveHospital = await Hospital.create({
      name: "Synthetic Inactive Hospital",
      code: `TEST-HI-${uniqueSuffix}`,
      district: districtB._id,
      active: false,
      synthetic: true
    });

    adminSecret = generateSecret();
    doctorSecret = generateSecret();
    districtAdminSecret = generateSecret();
    const [adminHash, employeeHash, doctorHash, doctorHashB, districtAdminHash] = await Promise.all([
      bcrypt.hash(adminPassword, 4),
      bcrypt.hash(employeePassword, 4),
      bcrypt.hash(doctorPassword, 4),
      bcrypt.hash(doctorPasswordB, 4),
      bcrypt.hash(districtAdminPassword, 4)
    ]);

    systemAdmin = await User.create({
      name: "Synthetic System Administrator",
      username: `admin-${uniqueSuffix}`,
      email: `admin-${uniqueSuffix}@example.test`,
      passwordHash: adminHash,
      role: "system_admin",
      status: "active",
      mfaEnabled: true,
      mfaSecret: adminSecret
    });
    const adminLogin = await login(systemAdmin.username!, adminPassword, "system_admin");
    if (!("mfaRequired" in adminLogin) || !adminLogin.mfaToken) throw new Error("System Admin login did not require MFA.");
    adminToken = (await verifyMfa(adminLogin.mfaToken, await totp(adminSecret))).accessToken;
    employee = await User.create({
      name: "Synthetic Employee",
      username: `employee-${uniqueSuffix}`,
      email: `employee-${uniqueSuffix}@example.test`,
      passwordHash: employeeHash,
      role: "employee",
      subRole: "asha",
      status: "active"
    });
    doctorUser = await User.create({
      name: "Synthetic Doctor",
      username: `doctor-${uniqueSuffix}`,
      email: `doctor-${uniqueSuffix}@example.test`,
      phone: `+9199${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
      passwordHash: doctorHash,
      role: "doctor",
      status: "active",
      mfaEnabled: true,
      mfaSecret: doctorSecret
    });
    await DoctorProfile.create({
      user: doctorUser._id,
      registrationNo: `TEST-DR-${uniqueSuffix}`,
      specialty: "Synthetic General Practice",
      hospital: hospitalA._id
    });
    doctorUserB = await User.create({
      name: "Synthetic Hospital B Doctor",
      username: `doctor-b-${uniqueSuffix}`,
      email: `doctor-b-${uniqueSuffix}@example.test`,
      phone: `+9197${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
      passwordHash: doctorHashB,
      role: "doctor",
      status: "active"
    });
    await DoctorProfile.create({
      user: doctorUserB._id,
      registrationNo: `TEST-DR-B-${uniqueSuffix}`,
      specialty: "Synthetic General Practice",
      hospital: hospitalB._id
    });
    districtAdmin = await User.create({
      name: "Synthetic District Administrator",
      username: `district-${uniqueSuffix}`,
      email: `district-${uniqueSuffix}@example.test`,
      passwordHash: districtAdminHash,
      role: "district_admin",
      assignments: [{ district: districtA.code }],
      status: "active",
      mfaEnabled: true,
      mfaSecret: districtAdminSecret
    });
  });

  afterAll(async () => {
    app.set("trust proxy", false);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it("provisions managers only for active hospitals and preserves existing employee roles", async () => {
    const managerA = await createManager({
      name: "Synthetic Manager A",
      username: `manager-a-${uniqueSuffix}`,
      email: `manager-a-${uniqueSuffix}@example.test`,
      hospitalId: hospitalA._id.toString()
    });
    expect(managerA.status).toBe(201);
    expect(managerA.body.manager.role).toBe("hospital_manager");
    managerAId = managerA.body.manager._id;
    managerASetupToken = managerA.body.setupToken;

    const assignedManager = await User.findById(managerAId).select("role hospitalId");
    expect(assignedManager?.role).toBe("hospital_manager");
    expect(assignedManager?.hospitalId?.toString()).toBe(hospitalA._id.toString());

    const managerB = await createManager({
      name: "Synthetic Manager B",
      username: `manager-b-${uniqueSuffix}`,
      email: `manager-b-${uniqueSuffix}@example.test`,
      hospitalId: hospitalB._id.toString()
    });
    expect(managerB.status).toBe(201);
    managerBId = managerB.body.manager._id;
    managerBSetupToken = managerB.body.setupToken;

    const secondManagerForHospital = await createManager({
      name: "Second Manager for Hospital A",
      username: `manager-a-second-${uniqueSuffix}`,
      email: `manager-a-second-${uniqueSuffix}@example.test`,
      hospitalId: hospitalA._id.toString()
    });
    expect(secondManagerForHospital.status).toBe(409);
    expect(secondManagerForHospital.body.error.code).toBe("HOSPITAL_HAS_MANAGER");

    const duplicate = await createManager({
      name: "Duplicate Synthetic Manager",
      username: `manager-a-${uniqueSuffix}`,
      email: `duplicate-${uniqueSuffix}@example.test`,
      hospitalId: hospitalC._id.toString()
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("USER_EXISTS");

    const inactiveHospitalManager = await createManager({
      name: "Synthetic Manager Inactive Hospital",
      username: `manager-inactive-${uniqueSuffix}`,
      email: `manager-inactive-${uniqueSuffix}@example.test`,
      hospitalId: inactiveHospital._id.toString()
    });
    expect(inactiveHospitalManager.status).toBe(400);
    expect(inactiveHospitalManager.body.error.code).toBe("INVALID_HOSPITAL");

    const unchangedEmployee = await User.findById(employee._id).select("role subRole");
    expect(unchangedEmployee?.role).toBe("employee");
    expect(unchangedEmployee?.subRole).toBe("asha");
    const employeeMfaChallenge = jwt.sign({ sub: employee._id.toString(), type: "mfa_setup" }, env.JWT_SECRET, { expiresIn: "5m" });
    await expect(verifyMfa(employeeMfaChallenge, "000000")).rejects.toMatchObject({ code: "INVALID_MFA" });
    const employeeRefreshToken = signRefreshToken({ sub: employee._id.toString(), role: "employee", ver: employee.tokenVersion ?? 0 });
    await User.updateOne({ _id: employee._id }, { $set: { refreshTokenHash: hashToken(employeeRefreshToken) } });
    await expect(refreshService(employeeRefreshToken)).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });
  });

  it("enforces one-time password setup, Hospital ID checks, MFA enrollment, and session revocation", async () => {
    const expiredManager = await createManager({
      name: "Synthetic Manager Expired Setup",
      username: `manager-expired-${uniqueSuffix}`,
      email: `manager-expired-${uniqueSuffix}@example.test`,
      hospitalId: hospitalC._id.toString()
    });
    expect(expiredManager.status).toBe(201);
    expiredManagerSetupToken = expiredManager.body.setupToken;
    await User.updateOne(
      { _id: expiredManager.body.manager._id },
      { $set: { passwordSetupExpiresAt: new Date(Date.now() - 60_000) } }
    );
    const expiredSetup = await request(app)
      .post("/api/v1/auth/hospital-manager/password-setup")
      .send({ token: expiredManagerSetupToken, password: managerPassword });
    expect(expiredSetup.status).toBe(400);
    expect(expiredSetup.body.error.code).toBe("INVALID_SETUP_TOKEN");

    const setup = await request(app)
      .post("/api/v1/auth/hospital-manager/password-setup")
      .send({ token: managerASetupToken, password: managerPassword });
    expect(setup.status).toBe(200);
    const reusedSetup = await request(app)
      .post("/api/v1/auth/hospital-manager/password-setup")
      .send({ token: managerASetupToken, password: managerPassword });
    expect(reusedSetup.status).toBe(400);
    expect(reusedSetup.body.error.code).toBe("INVALID_SETUP_TOKEN");

    await expect(login(`manager-a-${uniqueSuffix}`, managerPassword, "hospital_manager", hospitalBCode))
      .rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    await expect(login(`manager-a-${uniqueSuffix}`, "incorrect-password", "hospital_manager", hospitalACode))
      .rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    await expect(login(`unknown-${uniqueSuffix}`, managerPassword, "hospital_manager", hospitalACode))
      .rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });

    const managerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: `manager-a-${uniqueSuffix}`,
        password: managerPassword,
        role: "hospital_manager",
        hospitalCode: hospitalACode
      });
    expect(managerLogin.status).toBe(200);
    expect(managerLogin.body.mfaSetupRequired).toBe(true);
    expect(managerLogin.body.accessToken).toBeUndefined();

    const lowercaseHospitalCodeLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: `manager-a-${uniqueSuffix}`,
        password: managerPassword,
        role: "hospital_manager",
        hospitalCode: hospitalACode.toLowerCase()
      });
    expect(lowercaseHospitalCodeLogin.status).toBe(200);
    expect(lowercaseHospitalCodeLogin.body.mfaSetupRequired).toBe(true);

    const mfaEnrollment = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .send({ mfaToken: managerLogin.body.mfaToken });
    expect(mfaEnrollment.status).toBe(200);
    managerASecret = mfaEnrollment.body.secret;

    const validMfaCode = await totp(managerASecret);
    await expect(verifyMfa(managerLogin.body.mfaToken, validMfaCode === "000000" ? "000001" : "000000"))
      .rejects.toMatchObject({ status: 401, code: "INVALID_MFA" });
    const expiredMfaToken = jwt.sign(
      { sub: managerAId, type: "mfa" },
      env.JWT_SECRET,
      { expiresIn: -1 }
    );
    const expiredMfa = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: expiredMfaToken, code: "000000" });
    expect(expiredMfa.status).toBe(401);
    const initialMfa = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: managerLogin.body.mfaToken, code: await totp(managerASecret) });
    expect(initialMfa.status).toBe(200);
    expect(initialMfa.body.user.role).toBe("hospital_manager");
    expect(initialMfa.body.user.hospitalId).toBe(hospitalA._id.toString());
    expect(initialMfa.body).not.toHaveProperty("refreshToken");
    managerAAccessToken = initialMfa.body.accessToken;
    const initialRefreshCookie = refreshCookieHeader(initialMfa.headers["set-cookie"]);
    expect(initialRefreshCookie).toContain("HttpOnly");
    managerARefreshToken = initialRefreshCookie?.match(/aarogya_refresh=([^;]+)/)?.[1] ?? "";
    expect(managerARefreshToken).toBeTruthy();

    const requiredMfaLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: `manager-a-${uniqueSuffix}`,
        password: managerPassword,
        role: "hospital_manager",
        hospitalCode: hospitalACode
      });
    expect(requiredMfaLogin.status).toBe(200);
    expect(requiredMfaLogin.body.mfaRequired).toBe(true);
    expect(requiredMfaLogin.body.accessToken).toBeUndefined();

    const reset = await request(app)
      .post(`/api/v1/admin/hospital-managers/${managerAId}/password-reset`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(reset.status).toBe(200);

    const oldAccessAfterReset = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${managerAAccessToken}`);
    expect(oldAccessAfterReset.status).toBe(401);
    await expect(refreshService(managerARefreshToken))
      .rejects.toMatchObject({ status: 401, code: "INVALID_REFRESH_TOKEN" });

    const managerRecord = await User.findById(managerAId).select("+passwordSetupTokenHash mfaEnabled mfaSecret");
    expect(managerRecord?.mfaEnabled).toBe(true);
    expect(managerRecord?.passwordSetupTokenHash).toBeTruthy();
    const resetSetup = await request(app)
      .post("/api/v1/auth/hospital-manager/password-setup")
      .send({ token: reset.body.setupToken, password: nextManagerPassword });
    expect(resetSetup.status).toBe(200);

    await expect(login(`manager-a-${uniqueSuffix}`, managerPassword, "hospital_manager", hospitalACode))
      .rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    const newPasswordLogin = await login(`manager-a-${uniqueSuffix}`, nextManagerPassword, "hospital_manager", hospitalACode);
    expect("mfaRequired" in newPasswordLogin).toBe(true);
    if (!("mfaRequired" in newPasswordLogin) || !newPasswordLogin.mfaToken) throw new Error("Reset manager login did not require MFA.");
    const secondMfa = await verifyMfa(newPasswordLogin.mfaToken, await totp(managerASecret));
    managerAAccessToken = secondMfa.accessToken;
    managerARefreshToken = secondMfa.refreshToken;

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `aarogya_refresh=${managerARefreshToken}`)
      .send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).not.toHaveProperty("refreshToken");
    await expect(refreshService(managerARefreshToken))
      .rejects.toMatchObject({ status: 401, code: "INVALID_REFRESH_TOKEN" });
    const rotatedRefreshCookie = refreshCookieHeader(refreshed.headers["set-cookie"]);
    managerARefreshToken = rotatedRefreshCookie?.match(/aarogya_refresh=([^;]+)/)?.[1] ?? "";
    expect(managerARefreshToken).toBeTruthy();

    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${refreshed.body.accessToken}`);
    expect(logout.status).toBe(204);
    expect(cookieHeaders(logout.headers["set-cookie"]).some((cookie) => cookie.includes("Max-Age=0"))).toBe(true);
    const accessAfterLogout = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${refreshed.body.accessToken}`);
    expect(accessAfterLogout.status).toBe(401);
    await expect(refreshService(managerARefreshToken))
      .rejects.toMatchObject({ status: 401, code: "INVALID_REFRESH_TOKEN" });
    managerAAccessToken = "";
  });

  it("blocks cross-hospital manager access and rejects inactive or disabled managers", async () => {
    const managerALogin = await login(`manager-a-${uniqueSuffix}`, nextManagerPassword, "hospital_manager", hospitalACode);
    expect("mfaRequired" in managerALogin).toBe(true);
    if (!("mfaRequired" in managerALogin) || !managerALogin.mfaToken) throw new Error("Hospital Manager login did not require MFA.");
    const managerAVerified = await verifyMfa(managerALogin.mfaToken, await totp(managerASecret));
    const managerAToken = managerAVerified.accessToken;

    const managerDashboard = await request(app)
      .get("/api/v1/hospital-manager/dashboard")
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(managerDashboard.status).toBe(200);
    expect(managerDashboard.body.hospital.code).toBe(hospitalACode);
    expect(managerDashboard.body.counts.doctors).toBe(1);
    expect(managerDashboard.body.limitations.patientCounts).toBe("unavailable");

    const managerHospital = await request(app)
      .get("/api/v1/hospital-manager/hospital")
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(managerHospital.status).toBe(200);
    expect(managerHospital.body.hospital.code).toBe(hospitalACode);

    const inventoryResponse = await request(app)
      .put("/api/v1/hospital-manager/medicine-inventory")
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ medicineName: "Synthetic tablet", quantity: 24, unit: "tablets" });
    expect(inventoryResponse.status).toBe(201);
    const ownInventory = await request(app)
      .get("/api/v1/hospital-manager/medicine-inventory")
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(ownInventory.status).toBe(200);
    expect(ownInventory.body.inventory).toHaveLength(1);
    expect(ownInventory.body.inventory[0].quantity).toBe(24);
    const updatedInventory = await request(app)
      .put("/api/v1/hospital-manager/medicine-inventory")
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ medicineName: "  SYNTHETIC TABLET ", quantity: 18, unit: "tablets" });
    expect(updatedInventory.status).toBe(200);
    expect((await MedicineInventory.find({ hospital: hospitalA._id })).map((item) => item.quantity)).toEqual([18]);

    const managerDoctors = await request(app)
      .get("/api/v1/hospital-manager/doctors")
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(managerDoctors.status).toBe(200);
    expect(managerDoctors.body.doctors.map((doctor: { id: string }) => doctor.id)).toContain(doctorUser.id);
    expect(managerDoctors.body.doctors.map((doctor: { id: string }) => doctor.id)).not.toContain(doctorUserB.id);

    const changedProfile = await request(app)
      .patch("/api/v1/hospital-manager/hospital")
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ address: "Synthetic updated address", phone: "+919900000001", services: ["Synthetic service"] });
    expect(changedProfile.status).toBe(200);
    expect((await Hospital.findById(hospitalA._id))?.address).toBe("Synthetic updated address");

    const attemptedReassignment = await request(app)
      .patch("/api/v1/hospital-manager/hospital")
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ hospitalId: hospitalB._id.toString() });
    expect(attemptedReassignment.status).toBe(400);
    expect((await User.findById(managerAId))?.hospitalId?.toString()).toBe(hospitalA._id.toString());

    const scheduleStart = new Date(Date.now() + 24 * 60 * 60_000);
    const scheduleEnd = new Date(scheduleStart.getTime() + 60 * 60_000);
    const schedule = await request(app)
      .post(`/api/v1/hospital-manager/doctors/${doctorUser.id}/availability`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ start: scheduleStart.toISOString(), end: scheduleEnd.toISOString() });
    expect(schedule.status).toBe(201);
    const conflictingSchedule = await request(app)
      .post(`/api/v1/hospital-manager/doctors/${doctorUser.id}/availability`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ start: scheduleStart.toISOString(), end: scheduleEnd.toISOString() });
    expect(conflictingSchedule.status).toBe(409);
    const crossHospitalSchedule = await request(app)
      .post(`/api/v1/hospital-manager/doctors/${doctorUserB.id}/availability`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ start: scheduleStart.toISOString(), end: scheduleEnd.toISOString() });
    expect(crossHospitalSchedule.status).toBe(404);
    const removeSchedule = await request(app)
      .delete(`/api/v1/hospital-manager/doctors/${doctorUser.id}/availability/${schedule.body.slot.id}`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(removeSchedule.status).toBe(204);

    for (const [method, path] of [
      ["get", "/api/v1/admin/hospitals"],
      ["get", "/api/v1/admin/hospital-managers"],
      ["post", "/api/v1/admin/hospital-managers"],
      ["patch", `/api/v1/admin/users/${managerAId}/assignment`],
      ["get", "/api/v1/patients"],
      ["get", "/api/v1/patients/me"]
    ] as const) {
      const response = await request(app)[method](path).set("Authorization", `Bearer ${managerAToken}`);
      expect(response.status).toBe(403);
    }
    await expect(login(`manager-a-${uniqueSuffix}`, nextManagerPassword, "hospital_manager", hospitalBCode))
      .rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });

    await setManagerPassword(managerBSetupToken, managerPassword);
    const managerBLogin = await login(`manager-b-${uniqueSuffix}`, managerPassword, "hospital_manager", hospitalBCode);
    expect("mfaSetupRequired" in managerBLogin).toBe(true);
    if (!("mfaSetupRequired" in managerBLogin) || !managerBLogin.mfaToken) throw new Error("Manager B unexpectedly skipped MFA enrollment.");
    const managerBEnrollment = await setupMfaForChallenge(managerBLogin.mfaToken);
    const managerBVerified = await verifyMfa(managerBLogin.mfaToken, await totp(managerBEnrollment.secret));
    managerBAccessToken = managerBVerified.accessToken;
    const otherManagerInventory = await request(app)
      .get("/api/v1/hospital-manager/medicine-inventory")
      .set("Authorization", `Bearer ${managerBAccessToken}`);
    expect(otherManagerInventory.status).toBe(200);
    expect(otherManagerInventory.body.inventory).toHaveLength(0);
    const otherManagerStock = await request(app)
      .put("/api/v1/hospital-manager/medicine-inventory")
      .set("Authorization", `Bearer ${managerBAccessToken}`)
      .send({ medicineName: "Synthetic tablet", quantity: 5, unit: "tablets" });
    expect(otherManagerStock.status).toBe(201);
    const managerAInventoryAfterOtherWrite = await request(app)
      .get("/api/v1/hospital-manager/medicine-inventory")
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(managerAInventoryAfterOtherWrite.body.inventory).toHaveLength(1);
    expect(managerAInventoryAfterOtherWrite.body.inventory[0].quantity).toBe(18);
    const managerBDoctors = await request(app)
      .get("/api/v1/hospital-manager/doctors")
      .set("Authorization", `Bearer ${managerBAccessToken}`);
    expect(managerBDoctors.status).toBe(200);
    expect(managerBDoctors.body.doctors.map((doctor: { id: string }) => doctor.id)).toContain(doctorUserB.id);
    expect(managerBDoctors.body.doctors.map((doctor: { id: string }) => doctor.id)).not.toContain(doctorUser.id);
    const managerANotification = await Notification.create({
      user: managerAId,
      channel: "inapp",
      template: "Synthetic manager notification",
      language: "en",
      status: "queued"
    });
    const managerBNotification = await Notification.create({
      user: managerBId,
      channel: "inapp",
      template: "Synthetic other manager notification",
      language: "en",
      status: "queued"
    });
    const managerInbox = await request(app)
      .get("/api/v1/hospital-manager/notifications")
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(managerInbox.status).toBe(200);
    expect(managerInbox.body.notifications.map((item: { _id: string }) => item._id)).toContain(managerANotification.id);
    expect(managerInbox.body.notifications.map((item: { _id: string }) => item._id)).not.toContain(managerBNotification.id);
    const markOtherNotification = await request(app)
      .patch(`/api/v1/hospital-manager/notifications/${managerBNotification.id}/read`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(markOtherNotification.status).toBe(404);
    const markOwnNotification = await request(app)
      .patch(`/api/v1/hospital-manager/notifications/${managerANotification.id}/read`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(markOwnNotification.status).toBe(200);
    expect(markOwnNotification.body.notification.status).toBe("read");
    await expect(login(`manager-b-${uniqueSuffix}`, managerPassword, "hospital_manager", hospitalACode))
      .rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    const managerBAdminDirectory = await request(app)
      .get("/api/v1/admin/hospitals")
      .set("Authorization", `Bearer ${managerBAccessToken}`);
    expect(managerBAdminDirectory.status).toBe(403);

    const inactiveHospitalUpdate = await request(app)
      .patch(`/api/v1/admin/hospitals/${hospitalB._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });
    expect(inactiveHospitalUpdate.status).toBe(200);
    await expect(login(`manager-b-${uniqueSuffix}`, managerPassword, "hospital_manager", hospitalBCode))
      .rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    const managerBWhileHospitalInactive = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${managerBAccessToken}`);
    expect(managerBWhileHospitalInactive.status).toBe(403);
    expect(managerBWhileHospitalInactive.body.error.code).toBe("HOSPITAL_INACTIVE");

    const restoreHospital = await request(app)
      .patch(`/api/v1/admin/hospitals/${hospitalB._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: true });
    expect(restoreHospital.status).toBe(200);

    const disabledManager = await createManager({
      name: "Synthetic Disabled Manager",
      username: `manager-disabled-${uniqueSuffix}`,
      email: `manager-disabled-${uniqueSuffix}@example.test`,
      hospitalId: hospitalD._id.toString()
    });
    expect(disabledManager.status).toBe(201);
    disabledManagerId = disabledManager.body.manager._id;
    disabledManagerSetupToken = disabledManager.body.setupToken;
    await setManagerPassword(disabledManagerSetupToken, managerPassword);
    const disabledManagerLogin = await login(`manager-disabled-${uniqueSuffix}`, managerPassword, "hospital_manager", hospitalD.code!);
    expect("mfaSetupRequired" in disabledManagerLogin).toBe(true);
    if (!("mfaSetupRequired" in disabledManagerLogin) || !disabledManagerLogin.mfaToken) throw new Error("New manager unexpectedly skipped MFA.");
    const disabledMfaSetup = await setupMfaForChallenge(disabledManagerLogin.mfaToken);
    const disabledMfaVerified = await verifyMfa(disabledManagerLogin.mfaToken, await totp(disabledMfaSetup.secret));
    const disabledAccessToken = disabledMfaVerified.accessToken;

    const disableResponse = await request(app)
      .patch(`/api/v1/admin/hospital-managers/${disabledManagerId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });
    expect(disableResponse.status).toBe(200);
    await expect(login(`manager-disabled-${uniqueSuffix}`, managerPassword, "hospital_manager", hospitalD.code!))
      .rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    const disabledSession = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${disabledAccessToken}`);
    expect(disabledSession.status).toBe(401);
    managerBAccessToken = "";
  });

  it("rejects invalid and expired access tokens", async () => {
    const expired = jwt.sign(
      { sub: systemAdmin._id.toString(), role: "system_admin", ver: 0, type: "access" },
      env.JWT_SECRET,
      { expiresIn: -1 }
    );
    const expiredResponse = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${expired}`);
    expect(expiredResponse.status).toBe(401);

    const invalidResponse = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer invalid.signature.value");
    expect(invalidResponse.status).toBe(401);
  });

  it("persists staff-created patient details and registration consent", async () => {
    const registration = await request(app)
      .post("/api/v1/patients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Synthetic Staff Registration",
        phone: `+9196${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        dateOfBirth: "1990-01-01",
        address: "Synthetic Staff Address",
        mandal: "Synthetic Staff Mandal",
        preferredLanguage: "en"
      });

    expect(registration.status).toBe(201);
    expect(registration.body.user).not.toHaveProperty("password");
    const selfProfile = await DoctorProfile.findOne({ user: registration.body.user.id });
    expect(selfProfile?.hospitalName).toBe("Synthetic Hospital A");
    expect(registration.body.patient).toMatchObject({
      name: "Synthetic Staff Registration",
      dateOfBirth: "1990-01-01",
      address: "Synthetic Staff Address",
      mandal: "Synthetic Staff Mandal"
    });

    const consent = await request(app)
      .post(`/api/v1/patients/${registration.body.patient._id}/consents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ purpose: "registration", granted: true });

    expect(consent.status).toBe(201);
    expect(consent.body.consent).toMatchObject({ purpose: "registration", granted: true });

    await Consent.deleteOne({ patient: registration.body.patient._id, purpose: "registration" });
    await Patient.deleteOne({ _id: registration.body.patient._id });
  });

  it("syncs offline staff registrations with date of birth and consent", async () => {
    const patientClientUuid = crypto.randomUUID();
    const consentClientUuid = crypto.randomUUID();
    const deviceId = `registration-device-${uniqueSuffix}`;
    const idempotencyKey = `registration-batch-${crypto.randomUUID()}`;
    const batch = await request(app)
      .post("/api/v1/sync/batch")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("X-Device-Id", deviceId)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        operations: [
          {
            clientUuid: patientClientUuid,
            opType: "create_patient",
            payload: {
              name: "Synthetic Offline Registration",
              phone: `+9195${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
              address: "Synthetic Offline Address",
              dateOfBirth: "1991-04-03",
              mandal: "Synthetic Offline Mandal",
              preferredLanguage: "en"
            }
          },
          {
            clientUuid: consentClientUuid,
            opType: "create_consent",
            payload: { patientClientUuid, purpose: "data_processing", granted: true }
          }
        ]
      });

    expect(batch.status).toBe(200);
    expect(batch.body.results.map((result: { status: string }) => result.status)).toEqual(["synced", "synced"]);
    const patientId = batch.body.results[0].entityId as string;
    const persistedPatient = await Patient.findById(patientId);
    expect(persistedPatient?.dateOfBirth).toBeTruthy();
    expect(await Consent.exists({ patient: patientId, purpose: "data_processing", granted: true })).toBeTruthy();

    await Promise.all([
      SyncBatch.deleteOne({ deviceId, idempotencyKey, user: systemAdmin._id }),
      SyncItem.deleteMany({ deviceId, user: systemAdmin._id, clientUuid: { $in: [patientClientUuid, consentClientUuid] } }),
      Consent.deleteOne({ patient: patientId, purpose: "data_processing" }),
      Token.deleteOne({ clientUuid: patientClientUuid }),
      Patient.deleteOne({ _id: patientId })
    ]);
  });

  it("preserves supported authentication and denies legacy employee access without changing its record", async () => {
    const registration = await request(app)
      .post("/api/v1/auth/patient/register")
      .send({
        name: "Synthetic Patient",
        phone: `+9198${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        age: 47,
        address: "",
        district: "Synthetic Test District",
        mandal: "Synthetic Test Mandal",
        village: "Synthetic Test Village",
        consent: true
      });
    expect(registration.status).toBe(201);
    const patientPhone = registration.body.patient.phone as string;
    expect(registration.body.patient.active).toBe(false);
    expect(registration.body.patient.registrationStatus).toBe("pending_verification");
    expect(await User.exists({ phone: patientPhone, role: "patient" })).toBeNull();
    expect(await Consent.exists({ patient: registration.body.patient._id, purpose: "registration", granted: true })).toBeTruthy();
    const duplicateRegistration = await request(app)
      .post("/api/v1/auth/patient/register")
      .send({ name: "Synthetic Patient", phone: patientPhone, age: 47, district: "Synthetic Test District", mandal: "Synthetic Test Mandal", village: "Synthetic Test Village", consent: true });
    expect(duplicateRegistration.status).toBe(409);
    const roleEscalation = await request(app)
      .post("/api/v1/auth/patient/register")
      .send({ name: "Synthetic Escalation", phone: "+919999999999", age: 30, district: "Synthetic Test District", mandal: "Synthetic Test Mandal", village: "Synthetic Test Village", consent: true, role: "system_admin" });
    expect(roleEscalation.status).toBe(400);

    const otpRequest = await request(app)
      .post("/api/v1/auth/patient/otp/request")
      .send({ phone: patientPhone });
    expect(otpRequest.status).toBe(202);
    expect(typeof otpRequest.body.devOtp).toBe("string");
    const patientLogin = await request(app)
      .post("/api/v1/auth/patient/otp/verify")
      .send({ challengeId: otpRequest.body.challengeId, code: otpRequest.body.devOtp });
    expect(patientLogin.status).toBe(200);
    expect(patientLogin.body.user.role).toBe("patient");
    const verifiedPatient = await Patient.findById(registration.body.patient._id);
    expect(verifiedPatient?.active).toBe(true);
    expect(verifiedPatient?.registrationStatus).toBe("verified");
    expect(verifiedPatient?.phoneVerifiedAt).toBeInstanceOf(Date);
    const repeatOtpRequest = await request(app)
      .post("/api/v1/auth/patient/otp/request")
      .send({ phone: patientPhone.slice(-10) });
    expect(repeatOtpRequest.status).toBe(202);
    const repeatPatientLogin = await request(app)
      .post("/api/v1/auth/patient/otp/verify")
      .send({ challengeId: repeatOtpRequest.body.challengeId, code: repeatOtpRequest.body.devOtp });
    expect(repeatPatientLogin.status).toBe(200);
    expect(repeatPatientLogin.body.user.id).toBe(patientLogin.body.user.id);
    const ownPatient = await request(app)
      .get("/api/v1/patients/me")
      .set("Authorization", `Bearer ${patientLogin.body.accessToken}`);
    expect(ownPatient.status).toBe(200);
    expect(ownPatient.body.patient.name).toBe("Synthetic Patient");
    const patientToken = `Bearer ${patientLogin.body.accessToken as string}`;
    const noScreeningConsent = await request(app)
      .post("/api/v1/cases")
      .set("Authorization", patientToken)
      .send({ patientId: String(ownPatient.body.patient._id) });
    expect(noScreeningConsent.status).toBe(403);
    expect(noScreeningConsent.body.error.code).toBe("CONSENT_REQUIRED");
    const screeningConsent = await request(app)
      .post(`/api/v1/patients/${String(ownPatient.body.patient._id)}/consents`)
      .set("Authorization", patientToken)
      .send({ purpose: "screening", granted: true, consentVersion: "simulation-screening-v1" });
    expect(screeningConsent.status).toBe(201);
    const caseAfterConsent = await request(app)
      .post("/api/v1/cases")
      .set("Authorization", patientToken)
      .send({ patientId: String(ownPatient.body.patient._id) });
    expect(caseAfterConsent.status).toBe(201);
    await request(app)
      .post(`/api/v1/patients/${String(ownPatient.body.patient._id)}/consents`)
      .set("Authorization", patientToken)
      .send({ purpose: "screening", granted: false });
    const imageWithoutConsent = await request(app)
      .post(`/api/v1/cases/${String(caseAfterConsent.body.case._id)}/images`)
      .set("Authorization", patientToken);
    expect(imageWithoutConsent.status).toBe(403);
    expect(imageWithoutConsent.body.error.code).toBe("CONSENT_REQUIRED");

    await expect(login(employee.username!, employeePassword)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const employeeLogin = { accessToken: signAccessToken({ sub: employee._id.toString(), role: "employee", ver: employee.tokenVersion ?? 0 }) };
    const employeeMe = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${employeeLogin.accessToken}`);
    expect(employeeMe.status).toBe(401);
    expect(employeeMe.body.error.code).toBe("ROLE_DEACTIVATED");
    const employeePatientDirectory = await request(app)
      .get("/api/v1/patients")
      .set("Authorization", `Bearer ${employeeLogin.accessToken}`);
    expect(employeePatientDirectory.status).toBe(401);
    const unchangedEmployee = await User.findById(employee._id).select("role subRole");
    expect(unchangedEmployee?.role).toBe("employee");
    expect(unchangedEmployee?.subRole).toBe("asha");

    const doctorLogin = await login(doctorUser.username!, doctorPassword, "doctor");
    expect("mfaRequired" in doctorLogin).toBe(true);
    if (!("mfaRequired" in doctorLogin) || !doctorLogin.mfaToken) throw new Error("Existing TOTP-enrolled doctor login did not require MFA.");
    const doctorSession = await verifyMfa(doctorLogin.mfaToken, await totp(doctorSecret));
    const doctorMe = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${doctorSession.accessToken}`);
    expect(doctorMe.status).toBe(200);
    expect(doctorMe.body.user.role).toBe("doctor");
    const doctorProfile = await request(app)
      .get("/api/v1/doctor-profile")
      .set("Authorization", `Bearer ${doctorSession.accessToken}`);
    expect(doctorProfile.status).toBe(200);
    expect(doctorProfile.body.profile.registrationNo).toMatch(/^TEST-DR-/);
    const secondDoctorLogin = await login(doctorUserB.email!, doctorPasswordB, "doctor");
    expect("mfaSetupRequired" in secondDoctorLogin).toBe(true);

    const districtLogin = await login(districtAdmin.username!, districtAdminPassword, "district_admin");
    expect("mfaRequired" in districtLogin).toBe(true);
    if (!("mfaRequired" in districtLogin) || !districtLogin.mfaToken) throw new Error("District Admin login did not require MFA.");
    const districtSession = await verifyMfa(districtLogin.mfaToken, await totp(districtAdminSecret));
    const scopedHospitals = await request(app)
      .get("/api/v1/admin/hospitals")
      .set("Authorization", `Bearer ${districtSession.accessToken}`);
    expect(scopedHospitals.status).toBe(200);
    const visibleHospitalCodes = (scopedHospitals.body.hospitals as Array<{ code: string }>).map(({ code }) => code);
    expect(visibleHospitalCodes).toContain(hospitalACode);
    expect(visibleHospitalCodes).not.toContain(hospitalBCode);
    const scopedHospitalDetails = await request(app)
      .get(`/api/v1/admin/hospitals/${hospitalA._id}`)
      .set("Authorization", `Bearer ${districtSession.accessToken}`);
    expect(scopedHospitalDetails.status).toBe(200);
    const outOfDistrictDetails = await request(app)
      .get(`/api/v1/admin/hospitals/${hospitalB._id}`)
      .set("Authorization", `Bearer ${districtSession.accessToken}`);
    expect(outOfDistrictDetails.status).toBe(404);

    const adminLogin = await login(systemAdmin.username!, adminPassword, "system_admin");
    expect("mfaRequired" in adminLogin).toBe(true);
    if (!("mfaRequired" in adminLogin) || !adminLogin.mfaToken) throw new Error("System Admin login did not require MFA.");
    const adminSession = await verifyMfa(adminLogin.mfaToken, await totp(adminSecret));
    const adminMe = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${adminSession.accessToken}`);
    expect(adminMe.status).toBe(200);
    expect(adminMe.body.user.role).toBe("system_admin");
    const adminOverview = await request(app)
      .get("/api/v1/admin/overview")
      .set("Authorization", `Bearer ${adminSession.accessToken}`);
    expect(adminOverview.status).toBe(200);
    expect(adminOverview.body.statistics.totalHospitals).toBe(5);
    const adminHospitalDetails = await request(app)
      .get(`/api/v1/admin/hospitals/${hospitalA._id}`)
      .set("Authorization", `Bearer ${adminSession.accessToken}`);
    expect(adminHospitalDetails.status).toBe(200);
    expect(adminHospitalDetails.body.statistics.assignedDoctors).toBe(1);
    const newDoctor = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminSession.accessToken}`)
      .send({
        name: "Synthetic Unassigned Doctor",
        username: `doctor-unassigned-${uniqueSuffix}`,
        email: `doctor-unassigned-${uniqueSuffix}@example.test`,
        phone: `+9196${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        password: doctorPassword,
        role: "doctor"
      });
    expect(newDoctor.status).toBe(201);
    const districtCannotAssignHospital = await request(app)
      .post(`/api/v1/admin/doctors/${newDoctor.body.user._id}/hospital-profile`)
      .set("Authorization", `Bearer ${districtSession.accessToken}`)
      .send({ hospitalId: hospitalC._id.toString(), registrationNo: `TEST-DR-C-${uniqueSuffix}`, specialty: "Synthetic Specialist" });
    expect(districtCannotAssignHospital.status).toBe(403);
    const doctorHospitalProfile = await request(app)
      .post(`/api/v1/admin/doctors/${newDoctor.body.user._id}/hospital-profile`)
      .set("Authorization", `Bearer ${adminSession.accessToken}`)
      .send({ hospitalId: hospitalC._id.toString(), registrationNo: `TEST-DR-C-${uniqueSuffix}`, specialty: "Synthetic Specialist" });
    expect(doctorHospitalProfile.status).toBe(201);
    const repeatedDoctorHospitalProfile = await request(app)
      .post(`/api/v1/admin/doctors/${newDoctor.body.user._id}/hospital-profile`)
      .set("Authorization", `Bearer ${adminSession.accessToken}`)
      .send({ hospitalId: hospitalC._id.toString(), registrationNo: `TEST-DR-C-${uniqueSuffix}`, specialty: "Synthetic Specialist" });
    expect(repeatedDoctorHospitalProfile.status).toBe(409);
    const newHospitalInput = { name: "Synthetic Created Hospital", code: `TEST-NEW-${uniqueSuffix}`, type: "PHC" };
    const createdHospital = await request(app)
      .post("/api/v1/admin/hospitals")
      .set("Authorization", `Bearer ${adminSession.accessToken}`)
      .send(newHospitalInput);
    expect(createdHospital.status).toBe(201);
    const duplicateHospital = await request(app)
      .post("/api/v1/admin/hospitals")
      .set("Authorization", `Bearer ${adminSession.accessToken}`)
      .send(newHospitalInput);
    expect(duplicateHospital.status).toBe(409);
    const mismatchedCoordinates = await request(app)
      .post("/api/v1/admin/hospitals")
      .set("Authorization", `Bearer ${adminSession.accessToken}`)
      .send({ name: "Invalid Synthetic Hospital", code: `TEST-INVALID-${uniqueSuffix}`, type: "PHC", lat: 10 });
    expect(mismatchedCoordinates.status).toBe(400);
    const deactivateCreatedHospital = await request(app)
      .patch(`/api/v1/admin/hospitals/${createdHospital.body.hospital._id}`)
      .set("Authorization", `Bearer ${adminSession.accessToken}`)
      .send({ active: false });
    expect(deactivateCreatedHospital.status).toBe(200);

    const patients = await Patient.countDocuments({ active: true });
    expect(patients).toBe(1);
  });

  it("supports self-registration, private document review, and verified-only clinical access", async () => {
    const doctorEmail = `doctor-self-${uniqueSuffix}@example.test`;
    const doctorPhone = `+9195${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`;
    const selfDoctorPassword = "Synthetic-Doctor-Self-Pass-2026!";
    const registration = await request(app)
      .post("/api/v1/auth/doctor/register")
      .send({
        name: "Synthetic Self-Registered Doctor",
        username: `doctor-self-${uniqueSuffix}`,
        email: doctorEmail,
        phone: doctorPhone,
        password: selfDoctorPassword,
        registrationNo: `TEST-SELF-DR-${uniqueSuffix}`,
        registrationAuthority: "Synthetic Medical Council",
        specialty: "Synthetic Oral Medicine",
        hospitalName: "Synthetic Hospital A",
        qualification: "Synthetic Dental Degree",
        experienceYears: 8
      });
    expect(registration.status).toBe(201);
      expect(registration.body.user.id).toBeTruthy();
    expect(registration.body).not.toHaveProperty("password");
    expect(registration.body).not.toHaveProperty("passwordHash");
    const selfDoctor = await User.findOne({ username: `doctor-self-${uniqueSuffix}` }).select("+passwordHash");
    if (!selfDoctor) throw new Error("Self-registered doctor was not persisted.");
    expect(selfDoctor?.role).toBe("doctor");
    expect(selfDoctor?.mfaEnabled).toBe(false);
    expect(selfDoctor?.passwordHash).toBeTruthy();
    expect(selfDoctor?.passwordHash).not.toBe(selfDoctorPassword);
    expect(await bcrypt.compare(selfDoctorPassword, selfDoctor?.passwordHash ?? "")).toBe(true);
    const preMfaSession = { accessToken: signAccessToken({ sub: selfDoctor._id.toString(), role: "doctor", ver: selfDoctor.tokenVersion ?? 0 }) };
    const preMfaDashboardRequest = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${preMfaSession.accessToken}`);
    expect(preMfaDashboardRequest.status).toBe(403);
    expect(preMfaDashboardRequest.body.error.code).toBe("MFA_SETUP_REQUIRED");

    const duplicateRegistration = await request(app)
      .post("/api/v1/auth/doctor/register")
      .send({
        name: "Synthetic Duplicate Doctor",
        username: `doctor-self-${uniqueSuffix}`,
        email: `doctor-self-duplicate-${uniqueSuffix}@example.test`,
        phone: `+9194${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        password: "Synthetic-Doctor-Self-Pass-2026!",
        registrationNo: `TEST-SELF-DR-DUP-${uniqueSuffix}`,
        registrationAuthority: "Synthetic Medical Council",
        specialty: "Synthetic Oral Medicine",
        hospitalName: "Synthetic Hospital A",
        qualification: "Synthetic Dental Degree",
        experienceYears: 8
      });
    expect(duplicateRegistration.status).toBe(409);
      expect(duplicateRegistration.body.error.field).toBe("username");

    const duplicateEmailRegistration = await request(app)
      .post("/api/v1/auth/doctor/register")
      .send({
        name: "Synthetic Duplicate Email Doctor",
        username: `doctor-email-duplicate-${uniqueSuffix}`,
        email: doctorEmail,
        phone: `+9193${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        password: selfDoctorPassword,
        registrationNo: `TEST-SELF-DR-EMAIL-DUP-${uniqueSuffix}`,
        registrationAuthority: "Synthetic Medical Council",
        specialty: "Synthetic Oral Medicine",
        hospitalName: "Synthetic Hospital A",
        qualification: "Synthetic Dental Degree",
        experienceYears: 8
      });
    expect(duplicateEmailRegistration.status).toBe(409);
      expect(duplicateEmailRegistration.body.error.field).toBe("email");

      const duplicatePhoneRegistration = await request(app)
        .post("/api/v1/auth/doctor/register")
        .send({
          name: "Synthetic Duplicate Phone Doctor",
          username: `doctor-phone-duplicate-${uniqueSuffix}`,
          email: `doctor-phone-duplicate-${uniqueSuffix}@example.test`,
          phone: doctorPhone.replace("+91", ""),
          password: selfDoctorPassword,
          registrationNo: `TEST-SELF-DR-PHONE-DUP-${uniqueSuffix}`,
          registrationAuthority: "Synthetic Medical Council",
          specialty: "Synthetic Oral Medicine",
          hospitalName: "Synthetic Hospital A",
          qualification: "Synthetic Dental Degree",
          experienceYears: 8
        });
      expect(duplicatePhoneRegistration.status).toBe(409);
      expect(duplicatePhoneRegistration.body.error).toMatchObject({ code: "DOCTOR_REGISTRATION_CONFLICT", field: "phone" });
      expect(duplicatePhoneRegistration.body.error.message_en).toContain("mobile number");

    const duplicateRegistrationNumber = await request(app)
      .post("/api/v1/auth/doctor/register")
      .send({
        name: "Synthetic Duplicate Registration Number",
        username: `doctor-reg-duplicate-${uniqueSuffix}`,
        email: `doctor-reg-duplicate-${uniqueSuffix}@example.test`,
        phone: `+9191${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        password: "Synthetic-Doctor-Duplicate-Pass-2026!",
        registrationNo: `test-self-dr-${uniqueSuffix}`,
        registrationAuthority: "Synthetic Medical Council",
        specialty: "Synthetic Oral Medicine",
        hospitalName: "Synthetic Hospital A",
        qualification: "Synthetic Dental Degree",
        experienceYears: 8
      });
    expect(duplicateRegistrationNumber.status).toBe(409);
    expect(duplicateRegistrationNumber.body.error.field).toBe("registrationNo");

    const secondDoctorEmail = `doctor-self-b-${uniqueSuffix}@example.test`;
    const secondDoctorPhone = `+9192${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`;
    const secondRegistration = await request(app)
      .post("/api/v1/auth/doctor/register")
      .send({
        name: "Synthetic Second Self-Registered Doctor",
        username: `doctor-self-b-${uniqueSuffix}`,
        email: secondDoctorEmail,
        phone: secondDoctorPhone,
        password: "Synthetic-Doctor-Second-Pass-2026!",
        registrationNo: `TEST-SELF-DR-B-${uniqueSuffix}`,
        registrationAuthority: "Synthetic Medical Council",
        specialty: "Synthetic Oral Surgery",
        hospitalName: "Synthetic Hospital B",
        qualification: "Synthetic Dental Degree",
        experienceYears: 5
      });
    expect(secondRegistration.status).toBe(201);
    expect(secondRegistration.body.user.id).not.toBe(registration.body.user.id);

    const concurrentRegistrations = await Promise.all([
      request(app).post("/api/v1/auth/doctor/register").send({
        name: "Synthetic Concurrent Doctor A",
        username: `doctor-concurrent-a-${uniqueSuffix}`,
        email: `doctor-concurrent-a-${uniqueSuffix}@example.test`,
        phone: `+9181${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        password: "Synthetic-Concurrent-A-Pass-2026!",
        registrationNo: `TEST-CONCURRENT-DR-A-${uniqueSuffix}`,
        registrationAuthority: "Synthetic Medical Council",
        specialty: "Synthetic Oral Medicine",
        hospitalName: "Synthetic Hospital A",
        qualification: "Synthetic Dental Degree",
        experienceYears: 4
      }),
      request(app).post("/api/v1/auth/doctor/register").send({
        name: "Synthetic Concurrent Doctor B",
        username: `doctor-concurrent-b-${uniqueSuffix}`,
        email: `doctor-concurrent-b-${uniqueSuffix}@example.test`,
        phone: `+9182${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        password: "Synthetic-Concurrent-B-Pass-2026!",
        registrationNo: `TEST-CONCURRENT-DR-B-${uniqueSuffix}`,
        registrationAuthority: "Synthetic Medical Council",
        specialty: "Synthetic Oral Surgery",
        hospitalName: "Synthetic Hospital B",
        qualification: "Synthetic Dental Degree",
        experienceYears: 6
      })
    ]);
    expect(concurrentRegistrations.map((response) => response.status)).toEqual([201, 201]);
    expect(concurrentRegistrations[0].body.user.id).not.toBe(concurrentRegistrations[1].body.user.id);

    const sharedEmail = `doctor-concurrent-duplicate-${uniqueSuffix}@example.test`;
    const simultaneousDuplicateRegistrations = await Promise.all([
      request(app).post("/api/v1/auth/doctor/register").send({
        name: "Synthetic Simultaneous Duplicate A",
        username: `doctor-simultaneous-a-${uniqueSuffix}`,
        email: sharedEmail,
        phone: `+9171${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        password: "Synthetic-Simultaneous-A-Pass-2026!",
        registrationNo: `TEST-SIMULTANEOUS-DR-A-${uniqueSuffix}`,
        registrationAuthority: "Synthetic Medical Council",
        specialty: "Synthetic Oral Medicine",
        hospitalName: "Synthetic Hospital A",
        qualification: "Synthetic Dental Degree",
        experienceYears: 4
      }),
      request(app).post("/api/v1/auth/doctor/register").send({
        name: "Synthetic Simultaneous Duplicate B",
        username: `doctor-simultaneous-b-${uniqueSuffix}`,
        email: sharedEmail,
        phone: `+9172${uniqueSuffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
        password: "Synthetic-Simultaneous-B-Pass-2026!",
        registrationNo: `TEST-SIMULTANEOUS-DR-B-${uniqueSuffix}`,
        registrationAuthority: "Synthetic Medical Council",
        specialty: "Synthetic Oral Surgery",
        hospitalName: "Synthetic Hospital B",
        qualification: "Synthetic Dental Degree",
        experienceYears: 6
      })
    ]);
    expect(simultaneousDuplicateRegistrations.map((response) => response.status).sort()).toEqual([201, 409]);
    const simultaneousConflict = simultaneousDuplicateRegistrations.find((response) => response.status === 409);
    expect(simultaneousConflict?.body.error).toMatchObject({ code: "DOCTOR_REGISTRATION_CONFLICT", field: "email" });
    const persistedSimultaneousUser = await User.findOne({ email: sharedEmail });
    expect(persistedSimultaneousUser).toBeTruthy();
    expect(await DoctorProfile.countDocuments({ user: persistedSimultaneousUser?._id })).toBe(1);

    const invalidDoctorLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: doctorEmail, password: "Synthetic-Doctor-Wrong-Pass-2026!", role: "doctor" });
    expect(invalidDoctorLogin.status).toBe(401);
    expect(invalidDoctorLogin.body.error.code).toBe("INVALID_CREDENTIALS");

    const unregisteredDoctorLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: `unregistered-doctor-${uniqueSuffix}`, password: selfDoctorPassword, role: "doctor" });
    expect(unregisteredDoctorLogin.status).toBe(401);
    expect(unregisteredDoctorLogin.body.error.code).toBe("INVALID_CREDENTIALS");

    const usernameLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: `doctor-self-${uniqueSuffix}`, password: selfDoctorPassword, role: "doctor" });
    expect(usernameLogin.status).toBe(200);
    expect(usernameLogin.body.mfaSetupRequired).toBe(true);

    const phoneLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: doctorPhone.replace("+91", ""), password: selfDoctorPassword, role: "doctor" });
    expect(phoneLogin.status).toBe(200);
    expect(phoneLogin.body.mfaSetupRequired).toBe(true);

    const doctorLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: doctorEmail, password: selfDoctorPassword, role: "doctor" });
    expect(doctorLogin.status).toBe(200);
    expect(doctorLogin.body.mfaSetupRequired).toBe(true);
    expect(doctorLogin.body.mfaToken).toBeTruthy();
    expect(doctorLogin.body).not.toHaveProperty("accessToken");
    const setupResponse = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .send({ mfaToken: doctorLogin.body.mfaToken });
    expect(setupResponse.status).toBe(200);
    expect(setupResponse.body.secret).toBeTruthy();
    const enrolledDoctor = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: doctorLogin.body.mfaToken, code: await totp(setupResponse.body.secret) });
    expect(enrolledDoctor.status).toBe(200);
    expect(enrolledDoctor.body.user).toMatchObject({ name: "Synthetic Self-Registered Doctor", role: "doctor", email: doctorEmail, mfaEnabled: true });
    expect(enrolledDoctor.body.accessToken).toBeTruthy();
    expect(enrolledDoctor.body).not.toHaveProperty("refreshToken");
    const doctorRefreshCookie = refreshCookieHeader(enrolledDoctor.headers["set-cookie"]);
    expect(doctorRefreshCookie).toContain("HttpOnly");

    const secondDoctorLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: `doctor-self-b-${uniqueSuffix}`, password: "Synthetic-Doctor-Second-Pass-2026!", role: "doctor" });
    expect(secondDoctorLogin.status).toBe(200);
    expect(secondDoctorLogin.body.mfaSetupRequired).toBe(true);
    expect(secondDoctorLogin.body).not.toHaveProperty("accessToken");
    expect(secondDoctorLogin.body).not.toHaveProperty("user");
    const secondSetupResponse = await request(app)
      .post("/api/v1/auth/mfa/setup")
      .send({ mfaToken: secondDoctorLogin.body.mfaToken });
    expect(secondSetupResponse.status).toBe(200);
    const secondEnrolled = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: secondDoctorLogin.body.mfaToken, code: await totp(secondSetupResponse.body.secret) });
    expect(secondEnrolled.status).toBe(200);
    expect(secondEnrolled.body.user).toMatchObject({ name: "Synthetic Second Self-Registered Doctor", role: "doctor", email: secondDoctorEmail });
    expect(secondEnrolled.body.user.id).not.toBe(enrolledDoctor.body.user.id);
    const secondDoctorProfile = await request(app)
      .get("/api/v1/doctor-profile")
      .set("Authorization", `Bearer ${secondEnrolled.body.accessToken}`);
    expect(secondDoctorProfile.status).toBe(200);
    expect(secondDoctorProfile.body.profile).toMatchObject({ specialty: "Synthetic Oral Surgery", hospitalName: "Synthetic Hospital B" });

    const repeatedDoctorLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: doctorEmail, password: selfDoctorPassword, role: "doctor" });
    expect(repeatedDoctorLogin.status).toBe(200);
    expect(repeatedDoctorLogin.body.mfaRequired).toBe(true);
    expect(repeatedDoctorLogin.body).not.toHaveProperty("accessToken");

    const refreshedDoctorSession = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", doctorRefreshCookie?.split(";")[0] ?? "")
      .send({});
    expect(refreshedDoctorSession.status).toBe(200);
    expect(refreshedDoctorSession.body).not.toHaveProperty("refreshToken");
    const session = { accessToken: refreshedDoctorSession.body.accessToken as string };
    const rotatedDoctorCookie = refreshCookieHeader(refreshedDoctorSession.headers["set-cookie"]);
    expect(rotatedDoctorCookie).toBeDefined();
    const authenticatedDoctor = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(authenticatedDoctor.status).toBe(200);
    expect(authenticatedDoctor.body.user).toMatchObject({ name: "Synthetic Self-Registered Doctor", role: "doctor", email: doctorEmail });
    const profileRequest = () => request(app).get("/api/v1/doctor-profile").set("Authorization", `Bearer ${session.accessToken}`);
    const initialProfile = await profileRequest();
    expect(initialProfile.status).toBe(200);
    expect(initialProfile.body.profile.verificationStatus).toBe("draft");
    expect(initialProfile.body.profile.hospitalName).toBe("Synthetic Hospital A");

    const clinicalBeforeApproval = await request(app)
      .get("/api/v1/review/queue")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(clinicalBeforeApproval.status).toBe(403);
    expect(clinicalBeforeApproval.body.error.code).toBe("DOCTOR_VERIFICATION_REQUIRED");

    const saveDraft = await request(app)
      .patch("/api/v1/doctor-profile")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ registrationNo: `TEST-SELF-DR-${uniqueSuffix}`, registrationAuthority: "Synthetic Medical Council", specialty: "Synthetic Oral Medicine", qualification: "Synthetic Dental Degree", experienceYears: 8, professionalSummary: "Synthetic test profile." });
    expect(saveDraft.status).toBe(200);

    const emptyDocumentSubmission = await request(app)
      .post("/api/v1/doctor-profile/submit")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(emptyDocumentSubmission.status).toBe(400);
    expect(emptyDocumentSubmission.body.error.missingDocumentTypes).toEqual(["registration_certificate", "qualification"]);

    const invalidFile = await request(app)
      .post("/api/v1/doctor-profile/documents")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .field("type", "registration_certificate")
      .field("uploadId", crypto.randomUUID())
      .attach("file", Buffer.from("not a PDF"), { filename: "invalid.pdf", contentType: "application/pdf" });
    expect(invalidFile.status).toBe(400);

    const invalidExtension = await request(app)
      .post("/api/v1/doctor-profile/documents")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .field("type", "registration_certificate")
      .field("uploadId", crypto.randomUUID())
      .attach("file", Buffer.from("%PDF-1.7\nSynthetic credential\n"), { filename: "registration.png", contentType: "application/pdf" });
    expect(invalidExtension.status).toBe(400);

    const oversizedUpload = await request(app)
      .post("/api/v1/doctor-profile/documents")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .field("type", "registration_certificate")
      .field("uploadId", crypto.randomUUID())
      .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1), { filename: "oversized.pdf", contentType: "application/pdf" });
    expect(oversizedUpload.status).toBe(413);
    expect(oversizedUpload.body.error.code).toBe("LIMIT_FILE_SIZE");

    const registrationDocument = Buffer.from("%PDF-1.7\nSynthetic registration credential\n");
    const registrationUploadId = crypto.randomUUID();
    const registrationUpload = await request(app)
      .post("/api/v1/doctor-profile/documents")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .field("type", "registration_certificate")
      .field("uploadId", registrationUploadId)
      .attach("file", registrationDocument, { filename: "registration.pdf", contentType: "application/pdf" });
    expect(registrationUpload.status).toBe(201);
    expect(registrationUpload.body.document.reviewStatus).toBe("uploaded");

    const registrationOnlySubmission = await request(app)
      .post("/api/v1/doctor-profile/submit")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(registrationOnlySubmission.status).toBe(400);
    expect(registrationOnlySubmission.body.error.missingDocumentTypes).toEqual(["qualification"]);

    const qualificationDocument = Buffer.from("%PDF-1.7\nSynthetic qualification credential\n");
    const qualificationUploadId = crypto.randomUUID();
    const qualificationUpload = await request(app)
      .post("/api/v1/doctor-profile/documents")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .field("type", "qualification")
      .field("uploadId", qualificationUploadId)
      .attach("file", qualificationDocument, { filename: "qualification.pdf", contentType: "application/pdf" });
    expect(qualificationUpload.status).toBe(201);
    expect(qualificationUpload.body.document.reviewStatus).toBe("uploaded");

    const duplicateQualificationUpload = await request(app)
      .post("/api/v1/doctor-profile/documents")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .field("type", "qualification")
      .field("uploadId", qualificationUploadId)
      .attach("file", qualificationDocument, { filename: "qualification.pdf", contentType: "application/pdf" });
    expect(duplicateQualificationUpload.status).toBe(200);
    expect(duplicateQualificationUpload.body.document.id).toBe(qualificationUpload.body.document.id);

    const [secondQualificationUpload, experienceUpload] = await Promise.all([
      request(app)
        .post("/api/v1/doctor-profile/documents")
        .set("Authorization", `Bearer ${session.accessToken}`)
        .field("type", "qualification")
        .field("uploadId", crypto.randomUUID())
        .attach("file", Buffer.from("%PDF-1.7\nSynthetic second qualification credential\n"), { filename: "qualification-second.pdf", contentType: "application/pdf" }),
      request(app)
        .post("/api/v1/doctor-profile/documents")
        .set("Authorization", `Bearer ${session.accessToken}`)
        .field("type", "experience_certificate")
        .field("uploadId", crypto.randomUUID())
        .attach("file", Buffer.from("%PDF-1.7\nSynthetic experience credential\n"), { filename: "experience.pdf", contentType: "application/pdf" })
    ]);
    expect(secondQualificationUpload.status).toBe(201);
    expect(experienceUpload.status).toBe(201);
    const identityPng = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 100, b: 200 } } }).png().toBuffer();
    const identityUpload = await request(app)
      .post("/api/v1/doctor-profile/documents")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .field("type", "identity")
      .field("uploadId", crypto.randomUUID())
      .attach("file", identityPng, { filename: "identity.png", contentType: "image/png" });
    expect(identityUpload.status).toBe(201);
    expect(identityUpload.body.document).toMatchObject({ type: "identity", originalName: "identity.png", downloadName: "identity.jpg", reviewStatus: "uploaded" });

    const submitted = await request(app)
      .post("/api/v1/doctor-profile/submit")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.profile.verificationStatus).toBe("pending");
    expect(submitted.body.profile.documents).toHaveLength(5);
    expect(submitted.body.profile.documents.every((document: { reviewStatus: string }) => document.reviewStatus === "pending")).toBe(true);
    const ownDocument = await request(app)
      .get(`/api/v1/doctor-profile/documents/${registrationUpload.body.document.id}`)
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(ownDocument.status).toBe(200);
    const existingDoctorLogin = await login(doctorUser.username!, doctorPassword, "doctor");
    if (!("mfaRequired" in existingDoctorLogin) || !existingDoctorLogin.mfaToken) throw new Error("Existing TOTP-enrolled doctor login did not require MFA.");
    const otherDoctorSession = await verifyMfa(existingDoctorLogin.mfaToken, await totp(doctorSecret));
    const otherDoctorDocument = await request(app)
      .get(`/api/v1/doctor-profile/documents/${registrationUpload.body.document.id}`)
      .set("Authorization", `Bearer ${otherDoctorSession.accessToken}`);
    expect(otherDoctorDocument.status).toBe(404);
    const managerLogin = await login(`manager-a-${uniqueSuffix}`, nextManagerPassword, "hospital_manager", hospitalACode);
    if (!("mfaRequired" in managerLogin) || !managerLogin.mfaToken) throw new Error("Hospital Manager login did not require MFA.");
    const managerSession = await verifyMfa(managerLogin.mfaToken, await totp(managerASecret));
    managerAAccessToken = managerSession.accessToken;
    const managerCannotApprove = await request(app)
      .patch(`/api/v1/admin/doctors/${selfDoctor?._id}/verification`)
      .set("Authorization", `Bearer ${managerAAccessToken}`)
      .send({ decision: "verified" });
    expect(managerCannotApprove.status).toBe(403);
    const managerRoster = await request(app)
      .get("/api/v1/hospital-manager/doctors")
      .set("Authorization", `Bearer ${managerAAccessToken}`);
    expect(managerRoster.status).toBe(200);
    const assignedDoctor = (managerRoster.body.doctors as Array<Record<string, unknown>>).find((doctor) => doctor.id === doctorUser._id.toString());
    expect(assignedDoctor?.verificationStatus).toBe("verified");
    expect(assignedDoctor).not.toHaveProperty("documents");

    const adminDetails = await request(app)
      .get(`/api/v1/admin/doctors/${selfDoctor?._id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminDetails.status).toBe(200);
    expect(adminDetails.body.profile.documents).toHaveLength(5);
    expect(adminDetails.body.profile.documents.map((document: { type: string }) => document.type).sort()).toEqual([
      "experience_certificate",
      "identity",
      "qualification",
      "qualification",
      "registration_certificate",
    ]);
    const adminDocument = await request(app)
      .get(`/api/v1/admin/doctors/${selfDoctor?._id}/documents/${registrationUpload.body.document.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminDocument.status).toBe(200);

    app.set("trust proxy", 1);
    const rejected = await request(app)
      .patch(`/api/v1/admin/doctors/${selfDoctor?._id}/verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("X-Forwarded-For", "198.51.100.10")
      .send({ decision: "rejected", note: "Replace the unreadable supporting document." });
    app.set("trust proxy", false);
    expect(rejected.status).toBe(200);
    const rejectedProfile = await request(app)
      .get("/api/v1/doctor-profile")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(rejectedProfile.body.profile.documents.every((document: { reviewStatus: string; adminRemarks?: string }) => document.reviewStatus === "rejected" && document.adminRemarks === "Replace the unreadable supporting document.")).toBe(true);

    const replacementRegistrationUpload = await request(app)
      .post("/api/v1/doctor-profile/documents")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .field("type", "registration_certificate")
      .field("uploadId", crypto.randomUUID())
      .attach("file", Buffer.from("%PDF-1.7\nSynthetic replacement registration credential\n"), { filename: "registration-replacement.pdf", contentType: "application/pdf" });
    expect(replacementRegistrationUpload.status).toBe(201);
    const replacementQualificationUpload = await request(app)
      .post("/api/v1/doctor-profile/documents")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .field("type", "qualification")
      .field("uploadId", crypto.randomUUID())
      .attach("file", Buffer.from("%PDF-1.7\nSynthetic replacement qualification credential\n"), { filename: "qualification-replacement.pdf", contentType: "application/pdf" });
    expect(replacementQualificationUpload.status).toBe(201);

    const resubmitted = await request(app)
      .post("/api/v1/doctor-profile/submit")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.profile.documents.slice(-2).map((document: { reviewStatus: string }) => document.reviewStatus)).toEqual(["pending", "pending"]);

    app.set("trust proxy", 1);
    const approved = await request(app)
      .patch(`/api/v1/admin/doctors/${selfDoctor?._id}/verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("X-Forwarded-For", "198.51.100.11")
      .send({ decision: "verified" });
    app.set("trust proxy", false);
    expect(approved.status).toBe(200);
    expect(approved.body.verificationStatus).toBe("verified");
    const approvedProfile = await request(app)
      .get("/api/v1/doctor-profile")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(approvedProfile.body.profile.documents.slice(-2).map((document: { reviewStatus: string; verifiedAt?: string }) => document.reviewStatus)).toEqual(["approved", "approved"]);
    expect(approvedProfile.body.profile.documents.slice(-2).every((document: { verifiedAt?: string }) => Boolean(document.verifiedAt))).toBe(true);
    const clinicalAfterApproval = await request(app)
      .get("/api/v1/review/queue")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(clinicalAfterApproval.status).toBe(200);

    const doctorLogout = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Cookie", rotatedDoctorCookie?.split(";")[0] ?? "");
    expect(doctorLogout.status).toBe(204);
    expect(cookieHeaders(doctorLogout.headers["set-cookie"]).some((cookie) => cookie.includes("Max-Age=0"))).toBe(true);
    const doctorRefreshAfterLogout = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", rotatedDoctorCookie?.split(";")[0] ?? "")
      .send({});
    expect(doctorRefreshAfterLogout.status).toBe(401);

    const doctorLoginAfterLogout = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: doctorEmail, password: selfDoctorPassword, role: "doctor" });
    expect(doctorLoginAfterLogout.status).toBe(200);
    expect(doctorLoginAfterLogout.body.mfaRequired).toBe(true);
    const reauthenticatedSession = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: doctorLoginAfterLogout.body.mfaToken, code: await totp(setupResponse.body.secret) });
    expect(reauthenticatedSession.status).toBe(200);
    const reauthenticatedDoctor = { accessToken: reauthenticatedSession.body.accessToken as string };
    const authenticatedAgain = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${reauthenticatedDoctor.accessToken}`);
    expect(authenticatedAgain.status).toBe(200);
    expect(authenticatedAgain.body.user.email).toBe(doctorEmail);

    const disabled = await request(app)
      .patch(`/api/v1/admin/doctors/${selfDoctor?._id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });
    expect(disabled.status).toBe(200);
    const revokedDoctorSession = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${reauthenticatedDoctor.accessToken}`);
    expect(revokedDoctorSession.status).toBe(401);
  });
});

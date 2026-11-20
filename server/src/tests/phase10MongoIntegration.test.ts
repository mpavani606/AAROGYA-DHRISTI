import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { env } from "../config/env.js";
import { app } from "../app.js";
import { AuditLog } from "../models/AuditLog.js";
import { Case } from "../models/Case.js";
import { ChunkUpload } from "../models/ChunkUpload.js";
import { CampParticipant, HealthCamp } from "../models/HealthCamp.js";
import { EmergencyRequest } from "../models/EmergencyRequest.js";
import { CommunityVisit } from "../models/CommunityVisit.js";
import { Consent } from "../models/Consent.js";
import { LocationShare } from "../models/LocationShare.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { District, Hospital, Mandal, Phc, Village } from "../models/Geo.js";
import { Patient } from "../models/Patient.js";
import { Habit } from "../models/Habit.js";
import { Symptom } from "../models/Symptom.js";
import { SyncBatch } from "../models/SyncBatch.js";
import { SyncItem } from "../models/SyncItem.js";
import { Notification } from "../models/Notification.js";
import { Referral } from "../models/Referral.js";
import { User } from "../models/User.js";
import { encryptPatientFields, phoneHashVariants } from "../services/patientService.js";
import { decrypt } from "../services/encryption.js";
import { signAccessToken } from "../services/tokens.js";

const enabled = process.env.RUN_PHASE10_MONGO_INTEGRATION_TESTS === "1";
const integration = enabled ? describe : describe.skip;
const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const syntheticPassword = "Synthetic-Phase10-Integration-Pass!";
jest.setTimeout(60_000);

integration("MongoDB-backed Phase 10 community workflows", () => {
  let districtToken = "";
  let otherDistrictToken = "";
  let systemToken = "";
  let doctorToken = "";
  let ashaToken = "";
  let otherAshaToken = "";
  let patientToken = "";
  let mandalAId = "";
  let mandalBId = "";
  let villageAId = "";
  let villageBId = "";
  let phcAId = "";
  let phcBId = "";
  let hospitalAId = "";
  let patientId = "";
  let patientPhone = "";
  let doctorAId = "";
  let ashaAId = "";
  let ashaPatientId = "";

  beforeAll(async () => {
    let databaseName = "";
    try {
      const uri = new URL(env.MONGODB_URI);
      databaseName = decodeURIComponent(uri.pathname.slice(1));
      if (!["localhost", "127.0.0.1", "::1"].includes(uri.hostname.toLowerCase())) {
        throw new Error("Phase 10 integration tests require a loopback MongoDB host.");
      }
      if (!/^aarogya_phase10_[a-z0-9_]+$/i.test(databaseName)) {
        throw new Error("Phase 10 integration tests require a uniquely named aarogya_phase10_* database.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Phase 10 integration tests")) throw error;
      throw new Error("Phase 10 integration tests require a valid isolated MongoDB URI.");
    }

    await mongoose.connect(env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([
      AuditLog.init(), Case.init(), ChunkUpload.init(), CampParticipant.init(), HealthCamp.init(), EmergencyRequest.init(), CommunityVisit.init(),
      Consent.init(), LocationShare.init(), DoctorProfile.init(), District.init(), Hospital.init(), Notification.init(),
      Habit.init(), Symptom.init(), SyncBatch.init(), SyncItem.init(), Mandal.init(), Phc.init(), Village.init(), Patient.init(), Referral.init(), User.init()
    ]);

    const passwordHash = await bcrypt.hash(syntheticPassword, 4);
    const [districtA, districtB] = await Promise.all([
      District.create({ name: "Synthetic Phase 10 District A", code: `P10-DA-${uniqueSuffix}`, synthetic: true }),
      District.create({ name: "Synthetic Phase 10 District B", code: `P10-DB-${uniqueSuffix}`, synthetic: true })
    ]);
    const [mandalA, mandalB] = await Promise.all([
      Mandal.create({ name: "Synthetic Phase 10 Mandal A", code: `P10-MA-${uniqueSuffix}`, district: districtA._id, synthetic: true }),
      Mandal.create({ name: "Synthetic Phase 10 Mandal B", code: `P10-MB-${uniqueSuffix}`, district: districtB._id, synthetic: true })
    ]);
    mandalAId = mandalA._id.toString();
    mandalBId = mandalB._id.toString();
    const [phcA, phcB] = await Promise.all([
      Phc.create({ name: "Synthetic Phase 10 PHC A", code: `P10-PA-${uniqueSuffix}`, district: districtA._id, mandal: mandalA._id, active: true }),
      Phc.create({ name: "Synthetic Phase 10 PHC B", code: `P10-PB-${uniqueSuffix}`, district: districtB._id, mandal: mandalB._id, active: true })
    ]);
    phcAId = phcA._id.toString();
    phcBId = phcB._id.toString();
    const [villageA, villageB] = await Promise.all([
      Village.create({ name: "Synthetic Phase 10 Village A", code: `P10-VA-${uniqueSuffix}`, district: districtA._id, mandal: mandalA._id, phc: phcA._id, synthetic: true }),
      Village.create({ name: "Synthetic Phase 10 Village B", code: `P10-VB-${uniqueSuffix}`, district: districtB._id, mandal: mandalB._id, phc: phcB._id, synthetic: true })
    ]);
    villageAId = villageA._id.toString();
    villageBId = villageB._id.toString();
    const [hospitalA, hospitalB] = await Promise.all([
      Hospital.create({ name: "Synthetic Phase 10 Hospital A", code: `P10-HA-${uniqueSuffix}`, type: "PHC", district: districtA._id, mandal: mandalA._id, mandalId: mandalA._id, active: true, lat: 17.0, lng: 82.0, synthetic: true }),
      Hospital.create({ name: "Synthetic Phase 10 Hospital B", code: `P10-HB-${uniqueSuffix}`, type: "PHC", district: districtB._id, mandal: mandalB._id, mandalId: mandalB._id, active: true, synthetic: true })
    ]);
    hospitalAId = hospitalA._id.toString();

    const [systemAdmin, districtAdmin, otherDistrictAdmin, doctorA, doctorB, ashaA, ashaB] = await Promise.all([
      User.create({ name: "Synthetic Phase 10 System Admin", email: `p10-admin-${uniqueSuffix}@example.invalid`, username: `p10_admin_${uniqueSuffix}`, passwordHash, role: "system_admin", mfaEnabled: true }),
      User.create({ name: "Synthetic Phase 10 District Admin A", email: `p10-district-a-${uniqueSuffix}@example.invalid`, username: `p10_district_a_${uniqueSuffix}`, passwordHash, role: "district_admin", mfaEnabled: true, assignments: [{ scope: "mandal", district: districtA.code, mandal: mandalA._id.toString() }] }),
      User.create({ name: "Synthetic Phase 10 District Admin B", email: `p10-district-b-${uniqueSuffix}@example.invalid`, username: `p10_district_b_${uniqueSuffix}`, passwordHash, role: "district_admin", mfaEnabled: true, assignments: [{ scope: "mandal", district: districtB.code, mandal: mandalB._id.toString() }] }),
      User.create({ name: "Synthetic Phase 10 Verified Doctor A", email: `p10-doctor-a-${uniqueSuffix}@example.invalid`, username: `p10_doctor_a_${uniqueSuffix}`, passwordHash, role: "doctor", mfaEnabled: true, assignments: [{ scope: "mandal", mandal: mandalA._id.toString() }] }),
      User.create({ name: "Synthetic Phase 10 Verified Doctor B", email: `p10-doctor-b-${uniqueSuffix}@example.invalid`, username: `p10_doctor_b_${uniqueSuffix}`, passwordHash, role: "doctor", mfaEnabled: true, assignments: [{ scope: "mandal", mandal: mandalB._id.toString() }] }),
      User.create({ name: "Synthetic Phase 10 ASHA A", email: `p10-asha-a-${uniqueSuffix}@example.invalid`, username: `p10_asha_a_${uniqueSuffix}`, passwordHash, role: "asha_worker", subRole: "asha", mfaEnabled: true, assignments: [{ scope: "village", mandal: mandalA._id.toString(), phc: phcA._id.toString(), village: villageA._id.toString() }] }),
      User.create({ name: "Synthetic Phase 10 ASHA B", email: `p10-asha-b-${uniqueSuffix}@example.invalid`, username: `p10_asha_b_${uniqueSuffix}`, passwordHash, role: "asha_worker", subRole: "asha", mfaEnabled: true, assignments: [{ scope: "village", mandal: mandalB._id.toString(), phc: phcB._id.toString(), village: villageB._id.toString() }] })
    ]);
    doctorAId = doctorA._id.toString();
    ashaAId = ashaA._id.toString();
    await Promise.all([
      DoctorProfile.create({ user: doctorA._id, registrationNo: `P10-REG-A-${uniqueSuffix}`, specialty: "Synthetic specialty", verificationStatus: "verified", hospital: hospitalA._id }),
      DoctorProfile.create({ user: doctorB._id, registrationNo: `P10-REG-B-${uniqueSuffix}`, specialty: "Synthetic specialty", verificationStatus: "verified", hospital: hospitalB._id })
    ]);
    districtToken = signAccessToken({ sub: districtAdmin._id.toString(), role: "district_admin", ver: districtAdmin.tokenVersion });
    otherDistrictToken = signAccessToken({ sub: otherDistrictAdmin._id.toString(), role: "district_admin", ver: otherDistrictAdmin.tokenVersion });
    systemToken = signAccessToken({ sub: systemAdmin._id.toString(), role: "system_admin", ver: systemAdmin.tokenVersion });
    doctorToken = signAccessToken({ sub: doctorA._id.toString(), role: "doctor", ver: doctorA.tokenVersion });
    ashaToken = signAccessToken({ sub: ashaA._id.toString(), role: "asha_worker", ver: ashaA.tokenVersion });
    otherAshaToken = signAccessToken({ sub: ashaB._id.toString(), role: "asha_worker", ver: ashaB.tokenVersion });

    patientPhone = `+1555${String(Date.now()).slice(-7)}`;
    const patientUser = await User.create({ name: "Synthetic Phase 10 Patient", phone: patientPhone, passwordHash, role: "patient", mfaEnabled: false });
    const patient = await Patient.create({
      ...encryptPatientFields({ name: "Synthetic Phase 10 Patient", phone: patientPhone }),
      nameNormalized: `syntheticphase10${uniqueSuffix}`,
      phoneHash: phoneHashVariants(patientPhone)[0],
      mandal: mandalA.name,
      mandalId: mandalA._id,
      villageId: villageA._id,
      phcId: phcA._id,
      patientCode: `P10-P-${uniqueSuffix}`,
      createdBy: systemAdmin._id
    });
    patientId = patient._id.toString();
    await Consent.create({ patient: patient._id, purpose: "screening", granted: true, grantedBy: systemAdmin._id });
    const locationConsent = await Consent.create({ patient: patient._id, purpose: "location", granted: true, grantedBy: patientUser._id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    await LocationShare.create({
      patient: patient._id,
      lat: 17.0,
      lng: 82.0,
      source: "patient_link",
      consent: locationConsent._id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    patientToken = signAccessToken({ sub: patientUser._id.toString(), role: "patient", ver: patientUser.tokenVersion });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it("creates geographically scoped camps and rejects cross-district access", async () => {
    const options = await request(app).get("/api/v1/community/camps/options").set("Authorization", `Bearer ${districtToken}`);
    expect(options.status).toBe(200);
    expect(options.body.mandals.map((mandal: { _id: string }) => mandal._id)).toContain(mandalAId);
    expect(options.body.mandals.map((mandal: { _id: string }) => mandal._id)).not.toContain(mandalBId);
    const systemOptions = await request(app).get("/api/v1/community/camps/options").set("Authorization", `Bearer ${systemToken}`);
    expect(systemOptions.status).toBe(200);
    expect(systemOptions.body.mandals.map((mandal: { _id: string }) => mandal._id)).toContain(mandalBId);

    const body = {
      title: "Synthetic Phase 10 Camp",
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
      mandalId: mandalAId,
      phcId: phcAId,
      villageId: villageAId,
      hospitalId: hospitalAId,
      assignedDoctorIds: [doctorAId]
    };
    const created = await request(app).post("/api/v1/community/camps").set("Authorization", `Bearer ${districtToken}`).send(body);
    expect(created.status).toBe(201);
    const campId = created.body.camp._id as string;
    const outsideScope = await request(app).get(`/api/v1/community/camps/${campId}/report`).set("Authorization", `Bearer ${otherDistrictToken}`);
    expect(outsideScope.status).toBe(403);

    const crossDistrictCreate = await request(app).post("/api/v1/community/camps").set("Authorization", `Bearer ${districtToken}`).send({
      ...body, mandalId: mandalBId, phcId: phcBId, villageId: villageBId, hospitalId: undefined, assignedDoctorIds: []
    });
    expect(crossDistrictCreate.status).toBe(403);
    const patientDenied = await request(app).get("/api/v1/community/camps").set("Authorization", `Bearer ${patientToken}`);
    expect(patientDenied.status).toBe(403);

    const opened = await request(app).patch(`/api/v1/community/camps/${campId}/status`).set("Authorization", `Bearer ${districtToken}`).send({ status: "open" });
    expect(opened.status).toBe(200);
    const patientRecord = await Patient.findById(patientId);
    expect(patientRecord).toBeTruthy();
  });

  it("limits ASHA workflows to the assigned village and records encrypted patient visits", async () => {
    const dashboard = await request(app).get("/api/v1/asha/dashboard").set("Authorization", `Bearer ${ashaToken}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.phcs.map((item: { _id: string }) => item._id)).toEqual([phcAId]);
    expect(dashboard.body.villages.map((item: { _id: string }) => item._id)).toEqual([villageAId]);

    const assigned = await request(app).get("/api/v1/asha/patients").set("Authorization", `Bearer ${ashaToken}`);
    expect(assigned.status).toBe(200);
    expect(assigned.body.patients.map((item: { _id: string }) => item._id)).toContain(patientId);
    expect(assigned.body.patients.some((item: { villageId: string }) => item.villageId === villageBId)).toBe(false);

    const outsideAssignment = await request(app).post("/api/v1/asha/patients").set("Authorization", `Bearer ${ashaToken}`)
      .send({
        name: "Synthetic out-of-scope patient", phone: `+1557${String(Date.now()).slice(-7)}`, ageYears: 20,
        phcId: phcBId, villageId: villageBId, registrationConsent: true, screeningConsent: false
      });

    expect(outsideAssignment.status).toBe(403);

    const created = await request(app).post("/api/v1/asha/patients").set("Authorization", `Bearer ${ashaToken}`)
      .send({
        name: "Synthetic ASHA registered patient",
        phone: `+1556${String(Date.now()).slice(-7)}`,
        ageYears: 46,
        address: "Synthetic village address",
        phcId: phcAId,
        villageId: villageAId,
        preferredLanguage: "te",
        registrationConsent: true,
        screeningConsent: false
      });
    expect(created.status).toBe(201);
    ashaPatientId = created.body.patient._id as string;
    const stored = await Patient.findById(ashaPatientId).select("+name +address");
    expect(stored?.name).not.toContain("Synthetic ASHA registered patient");
    expect(stored?.name ? decrypt(stored.name) : "").toBe("Synthetic ASHA registered patient");
    expect(await Consent.exists({ patient: ashaPatientId, purpose: "registration", granted: true })).toBeTruthy();

    const visit = await request(app).post(`/api/v1/asha/patients/${ashaPatientId}/visits`).set("Authorization", `Bearer ${ashaToken}`)
      .send({ outcome: "follow_up_needed", nextFollowUpAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), notes: "Synthetic confidential visit note." });
    expect(visit.status).toBe(201);
    const storedVisit = await CommunityVisit.findById(visit.body.visit._id);
    expect(storedVisit?.notesEncrypted).not.toContain("Synthetic confidential visit note.");
    const history = await request(app).get(`/api/v1/asha/patients/${ashaPatientId}/history`).set("Authorization", `Bearer ${ashaToken}`);
    expect(history.status).toBe(200);
    expect(history.body.visits[0].notes).toBe("Synthetic confidential visit note.");

    const otherVillagePatient = await Patient.create({
      ...encryptPatientFields({ name: "Synthetic ASHA restricted record" }),
      nameNormalized: `syntheticas2026restricted${uniqueSuffix}`,
      mandal: mandalBId,
      mandalId: mandalBId,
      phcId: phcBId,
      villageId: villageBId,
      createdBy: ashaAId
    });
    const forbiddenHistory = await request(app).get(`/api/v1/asha/patients/${otherVillagePatient._id}/history`).set("Authorization", `Bearer ${ashaToken}`);
    expect(forbiddenHistory.status).toBe(403);
    const otherWorker = await request(app).get("/api/v1/asha/patients").set("Authorization", `Bearer ${otherAshaToken}`);
    expect(otherWorker.body.patients.some((item: { _id: string }) => item._id === ashaPatientId)).toBe(false);
  });

  it("allows patients to sync their own profile and consented screening, rejecting other records", async () => {
    const ownProfile = await request(app).get("/api/v1/patients/me").set("Authorization", `Bearer ${patientToken}`);
    expect(ownProfile.status).toBe(200);
    const careOverview = await request(app).get(`/api/v1/patients/${patientId}/care-overview`)
      .set("Authorization", `Bearer ${patientToken}`);
    expect(careOverview.status).toBe(200);
    const doctorQueue = await request(app).get("/api/v1/review/queue").set("Authorization", `Bearer ${patientToken}`);
    expect(doctorQueue.status).toBe(403);

    const deviceId = `screening-device-${uniqueSuffix}`;
    const batch = await request(app).post("/api/v1/sync/batch")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("X-Device-Id", deviceId)
      .set("Idempotency-Key", `screening-batch-${crypto.randomUUID()}`)
      .send({
        operations: [
          { clientUuid: crypto.randomUUID(), opType: "create_case", payload: { patientId, notes: "Synthetic screening submission." } },
          { clientUuid: crypto.randomUUID(), opType: "create_habit", payload: { patientId, name: "Synthetic tobacco use", frequency: "sometimes" } },
          { clientUuid: crypto.randomUUID(), opType: "create_symptom", payload: { patientId, name: "Synthetic symptom" } }
        ]
      });
    expect(batch.status).toBe(200);
    expect(batch.body.results.map((result: { status: string }) => result.status)).toEqual(["synced", "synced", "synced"]);
    const caseId = batch.body.results[0].entityId as string;
    const upload = await request(app).post("/api/v1/sync/uploads")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("X-Device-Id", deviceId)
      .send({ uploadId: crypto.randomUUID(), caseId, fileName: "screening.png", mimeType: "image/png", totalChunks: 1 });
    expect(upload.status).toBe(200);

    const unrelatedPatient = await Patient.create({
      ...encryptPatientFields({ name: "Synthetic unrelated screening patient", phone: "+919000000099" }),
      nameNormalized: `syntheticunrelatedscreening${uniqueSuffix}`,
      mandal: "Synthetic unrelated mandal",
      patientCode: `P10-U-${uniqueSuffix}`,
      createdBy: new mongoose.Types.ObjectId()
    });
    const outsideScope = await request(app).post("/api/v1/sync/batch")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("X-Device-Id", deviceId)
      .set("Idempotency-Key", `outside-batch-${crypto.randomUUID()}`)
      .send({ operations: [{ clientUuid: crypto.randomUUID(), opType: "create_case", payload: { patientId: unrelatedPatient._id.toString() } }] });
    expect(outsideScope.status).toBe(200);
    expect(outsideScope.body.results[0]).toMatchObject({ status: "failed", code: "OUTSIDE_ASSIGNMENT" });

    const ownProfileUpdate = await request(app).post("/api/v1/sync/batch")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("X-Device-Id", deviceId)
      .set("Idempotency-Key", `own-profile-${crypto.randomUUID()}`)
      .send({ operations: [{ clientUuid: crypto.randomUUID(), opType: "update_patient", payload: { patientId, fields: { name: "Updated Synthetic Patient" } } }] });
    expect(ownProfileUpdate.status).toBe(200);
    expect(ownProfileUpdate.body.results[0]).toMatchObject({ status: "synced", entityId: patientId });
    const updatedPatient = await Patient.findById(patientId).select("name");
    if (!updatedPatient) throw new Error("Synthetic patient profile was not found after sync.");
    expect(decrypt(updatedPatient.name)).toBe("Updated Synthetic Patient");

    const unrelatedProfile = await request(app).post("/api/v1/sync/batch")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("X-Device-Id", deviceId)
      .set("Idempotency-Key", `unrelated-profile-${crypto.randomUUID()}`)
      .send({ operations: [{ clientUuid: crypto.randomUUID(), opType: "update_patient", payload: { patientId: unrelatedPatient._id.toString(), fields: { name: "Not allowed" } } }] });
    expect(unrelatedProfile.status).toBe(200);
    expect(unrelatedProfile.body.results[0]).toMatchObject({ status: "failed", code: "OUTSIDE_ASSIGNMENT" });

    const staffOperation = await request(app).post("/api/v1/sync/batch")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("X-Device-Id", deviceId)
      .set("Idempotency-Key", `staff-op-${crypto.randomUUID()}`)
      .send({ operations: [{ clientUuid: crypto.randomUUID(), opType: "signed_review", payload: {} }] });
    expect(staffOperation.status).toBe(403);
  });

  it("requires screening consent, records camp attendance, and exports aggregate reports only", async () => {
    const camp = await HealthCamp.findOne({ title: "Synthetic Phase 10 Camp" });
    if (!camp) throw new Error("Synthetic camp fixture was not created.");
    const patientWithoutConsent = await Patient.create({
      name: "Synthetic Phase 10 No Consent",
      nameNormalized: `syntheticphase10noconsent${uniqueSuffix}`,
      mandal: "Synthetic Phase 10 Mandal A",
      mandalId: mandalAId,
      villageId: villageAId,
      patientCode: `P10-NC-${uniqueSuffix}`,
      createdBy: camp.createdBy
    });
    const deniedRegistration = await request(app).post(`/api/v1/community/camps/${camp._id}/participants`)
      .set("Authorization", `Bearer ${districtToken}`).send({ patientId: patientWithoutConsent._id.toString() });
    expect(deniedRegistration.status).toBe(403);
    const caseRecord = await Case.create({ patient: patientId, createdBy: camp.createdBy, status: "submitted" });
    await Referral.create({
      case: caseRecord._id,
      fromUser: camp.createdBy,
      toSpecialty: "Synthetic specialty",
      hospital: hospitalAId,
      priority: "routine",
      reason: "Synthetic integration reference."
    });
    const registered = await request(app).post(`/api/v1/community/camps/${camp._id}/participants`)
      .set("Authorization", `Bearer ${districtToken}`).send({ patientId, caseId: caseRecord._id.toString() });
    expect(registered.status).toBe(201);
    const duplicate = await request(app).post(`/api/v1/community/camps/${camp._id}/participants`)
      .set("Authorization", `Bearer ${districtToken}`).send({ patientId, caseId: caseRecord._id.toString() });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.participant.id).toBe(registered.body.participant.id);
    expect(await CampParticipant.countDocuments({ camp: camp._id, patient: patientId })).toBe(1);

    const attendance = await request(app).patch(`/api/v1/community/camps/${camp._id}/participants/${registered.body.participant.id}/attendance`)
      .set("Authorization", `Bearer ${districtToken}`).send({ status: "attended" });
    expect(attendance.status).toBe(200);
    expect(attendance.body.participant.status).toBe("attended");
    const conflictingAttendance = await request(app).patch(`/api/v1/community/camps/${camp._id}/participants/${registered.body.participant.id}/attendance`)
      .set("Authorization", `Bearer ${districtToken}`).send({ status: "no_show" });
    expect(conflictingAttendance.status).toBe(409);

    const ashaWithoutConsent = await request(app).post(`/api/v1/community/camps/${camp._id}/participants`)
      .set("Authorization", `Bearer ${ashaToken}`).send({ patientId: ashaPatientId });
    expect(ashaWithoutConsent.status).toBe(403);
    const consent = await request(app).post(`/api/v1/asha/patients/${ashaPatientId}/screening-consent`)
      .set("Authorization", `Bearer ${ashaToken}`).send({ confirmedByPatient: true });
    expect(consent.status).toBe(201);
    const ashaParticipant = await request(app).post(`/api/v1/community/camps/${camp._id}/participants`)
      .set("Authorization", `Bearer ${ashaToken}`).send({ patientId: ashaPatientId });
    expect(ashaParticipant.status).toBe(201);
    const ashaCampParticipants = await request(app).get(`/api/v1/asha/camps/${camp._id}/participants`).set("Authorization", `Bearer ${ashaToken}`);
    expect(ashaCampParticipants.status).toBe(200);
    expect(ashaCampParticipants.body.participants.some((item: { patientId: string }) => item.patientId === ashaPatientId)).toBe(true);
    const ashaAttendance = await request(app).patch(`/api/v1/community/camps/${camp._id}/participants/${ashaParticipant.body.participant.id}/attendance`)
      .set("Authorization", `Bearer ${ashaToken}`).send({ status: "attended" });
    expect(ashaAttendance.status).toBe(200);

    const report = await request(app).get(`/api/v1/community/camps/${camp._id}/report`).set("Authorization", `Bearer ${districtToken}`);
    expect(report.status).toBe(200);
    expect(report.headers["content-type"]).toContain("text/csv");
    expect(report.text).toContain('"registeredParticipants","<5"');
    expect(report.text).toContain('"linkedReferrals","<5"');
    expect(report.text).not.toContain("Synthetic Phase 10 Patient");
    const pdfReport = await request(app).get(`/api/v1/community/camps/${camp._id}/report?format=pdf`)
      .set("Authorization", `Bearer ${districtToken}`);
    expect(pdfReport.status).toBe(200);
    expect(pdfReport.headers["content-type"]).toContain("application/pdf");
    expect(await AuditLog.exists({ action: "community_camp_report_exported", resourceId: camp._id.toString() })).toBeTruthy();
  });

  it("creates idempotent consent-bound SOS requests and restricts queue assignment by geography", async () => {
    const clientRequestId = crypto.randomUUID();
    const locationShare = await LocationShare.findOne({ patient: patientId });
    if (!locationShare) throw new Error("Synthetic location fixture was not created.");
    const sos = await request(app).post("/api/v1/community/emergency/requests").set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientRequestId,
        category: "urgent_help",
        message: "Synthetic integration request.",
        locationShareId: locationShare._id.toString(),
        emergencyContactName: "Synthetic Emergency Contact",
        emergencyContactPhone: "+15551234567",
        emergencyContactRelationship: "Family",
        emergencyContactConsent: true
      });
    expect(sos.status).toBe(201);
    const storedRequest = await EmergencyRequest.findById(sos.body.request.id).select("+emergencyContactEncrypted");
    expect(storedRequest?.emergencyContactEncrypted).not.toContain("Synthetic Emergency Contact");
    expect(JSON.parse(decrypt(storedRequest?.emergencyContactEncrypted ?? ""))).toMatchObject({
      name: "Synthetic Emergency Contact",
      phone: "+15551234567",
      relationship: "Family"
    });
    expect(await Notification.exists({ template: "emergency_request_received", user: ashaAId })).toBeTruthy();
    const repeated = await request(app).post("/api/v1/community/emergency/requests").set("Authorization", `Bearer ${patientToken}`)
      .send({ clientRequestId, category: "urgent_help", message: "Synthetic integration request." });
    expect(repeated.status).toBe(200);
    expect(repeated.body.request.id).toBe(sos.body.request.id);
    expect(await EmergencyRequest.countDocuments({ patient: patientId })).toBe(1);

    const facilities = await request(app).get("/api/v1/community/emergency/facilities").set("Authorization", `Bearer ${patientToken}`);
    expect(facilities.status).toBe(200);
    expect(facilities.body.locationUsed).toBe(true);
    expect(facilities.body.facilities[0].availability).toBe("unknown");

    const patientRequests = await request(app).get("/api/v1/community/emergency/requests/mine").set("Authorization", `Bearer ${patientToken}`);
    expect(patientRequests.status).toBe(200);
    expect(patientRequests.body.requests[0].location).toMatchObject({ lat: 17, lng: 82 });
    const outsideQueue = await request(app).get("/api/v1/community/emergency/requests").set("Authorization", `Bearer ${otherDistrictToken}`);
    expect(outsideQueue.status).toBe(200);
    expect(outsideQueue.body.requests).toHaveLength(0);
    const ownQueue = await request(app).get("/api/v1/community/emergency/requests").set("Authorization", `Bearer ${districtToken}`);
    expect(ownQueue.status).toBe(200);
    expect(ownQueue.body.requests).toHaveLength(1);
    expect(ownQueue.body.requests[0].location).toMatchObject({ lat: 17, lng: 82 });
    expect(ownQueue.body.requests[0].contactAvailable).toBe(true);
    expect(ownQueue.body.requests[0].emergencyContactPhone).toBeUndefined();
    const contact = await request(app).get(`/api/v1/community/emergency/requests/${sos.body.request.id}/contact-details`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(contact.status).toBe(200);
    expect(contact.body.contact).toMatchObject({ name: "Synthetic Emergency Contact", phone: "+15551234567" });
    const deniedContact = await request(app).get(`/api/v1/community/emergency/requests/${sos.body.request.id}/contact-details`)
      .set("Authorization", `Bearer ${otherDistrictToken}`);
    expect(deniedContact.status).toBe(403);
    const contactAttempt = await request(app).post(`/api/v1/community/emergency/requests/${sos.body.request.id}/contact-attempts`)
      .set("Authorization", `Bearer ${ashaToken}`).send({ channel: "phone", outcome: "no_answer", note: "Synthetic attempt note." });
    expect(contactAttempt.status).toBe(201);
    expect(contactAttempt.body.request.contactAttempts[0].note).toBe("Synthetic attempt note.");
    const rawAttempt = await EmergencyRequest.findById(sos.body.request.id);
    expect(rawAttempt?.contactAttempts[0].noteEncrypted).not.toContain("Synthetic attempt note.");
    const ashaQueue = await request(app).get("/api/v1/community/emergency/requests").set("Authorization", `Bearer ${ashaToken}`);
    expect(ashaQueue.status).toBe(200);
    expect(ashaQueue.body.requests).toHaveLength(1);
    const otherAshaQueue = await request(app).get("/api/v1/community/emergency/requests").set("Authorization", `Bearer ${otherAshaToken}`);
    expect(otherAshaQueue.status).toBe(200);
    expect(otherAshaQueue.body.requests).toHaveLength(0);

    const escalated = await request(app).post(`/api/v1/community/emergency/requests/${sos.body.request.id}/escalate`)
      .set("Authorization", `Bearer ${ashaToken}`).send({ reason: "Synthetic escalation for staff review." });
    expect(escalated.status).toBe(201);
    expect(escalated.body.request.escalations[0].reason).toBe("Synthetic escalation for staff review.");
    const storedEscalation = await EmergencyRequest.findById(sos.body.request.id);
    expect(storedEscalation?.escalations[0].reasonEncrypted).not.toContain("Synthetic escalation for staff review.");

    const outsideDoctor = await User.findOne({ username: new RegExp(`^p10_doctor_b_${uniqueSuffix}$`) }).select("_id");
    const wrongAssignee = await request(app).patch(`/api/v1/community/emergency/requests/${sos.body.request.id}`)
      .set("Authorization", `Bearer ${districtToken}`).send({ status: "assigned", assignedTo: outsideDoctor?._id.toString() });
    expect(wrongAssignee.status).toBe(403);
    const assigned = await request(app).patch(`/api/v1/community/emergency/requests/${sos.body.request.id}`)
      .set("Authorization", `Bearer ${districtToken}`).send({ status: "assigned", assignedTo: doctorAId });
    expect(assigned.status).toBe(200);
    const acknowledged = await request(app).patch(`/api/v1/community/emergency/requests/${sos.body.request.id}`)
      .set("Authorization", `Bearer ${doctorToken}`).send({ status: "acknowledged" });
    expect(acknowledged.status).toBe(200);
    const resolved = await request(app).patch(`/api/v1/community/emergency/requests/${sos.body.request.id}`)
      .set("Authorization", `Bearer ${doctorToken}`).send({ status: "resolved", resolutionNote: "Synthetic workflow closed." });
    expect(resolved.status).toBe(200);
    expect(resolved.body.request.status).toBe("resolved");
    const storedResolution = await EmergencyRequest.findById(sos.body.request.id).select("+resolutionNoteEncrypted");
    expect(storedResolution?.resolutionNoteEncrypted).not.toContain("Synthetic workflow closed.");
    expect(decrypt(storedResolution?.resolutionNoteEncrypted ?? "")).toBe("Synthetic workflow closed.");
  });

  it("does not attach a previously shared location unless the patient selects it", async () => {
    const response = await request(app).post("/api/v1/community/emergency/requests").set("Authorization", `Bearer ${patientToken}`)
      .send({ clientRequestId: crypto.randomUUID(), category: "other", message: "Synthetic request without location." });
    expect(response.status).toBe(201);
    const stored = await EmergencyRequest.findById(response.body.request.id);
    expect(stored?.locationShare).toBeUndefined();
  });

  it("requires location consent before accepting a submitted location reference", async () => {
    const locationConsent = await Consent.findOne({ patient: patientId, purpose: "location" });
    if (!locationConsent) throw new Error("Synthetic consent fixture was not created.");
    await Consent.deleteOne({ _id: locationConsent._id });
    const response = await request(app).post("/api/v1/community/emergency/requests").set("Authorization", `Bearer ${patientToken}`)
      .send({ clientRequestId: crypto.randomUUID(), category: "transport", message: "Synthetic transport request.", locationShareId: new mongoose.Types.ObjectId().toString() });
    expect(response.status).toBe(403);
  });
});

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import request from "supertest";
import { env } from "../config/env.js";
import { app } from "../app.js";
import { Appointment } from "../models/Appointment.js";
import { AiInference } from "../models/AiInference.js";
import { AiModel } from "../models/AiModel.js";
import { AuditLog } from "../models/AuditLog.js";
import { Case } from "../models/Case.js";
import { CaseImage } from "../models/CaseImage.js";
import { Consent } from "../models/Consent.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { Hospital } from "../models/Geo.js";
import { FollowUp } from "../models/FollowUp.js";
import { Habit } from "../models/Habit.js";
import { Notification } from "../models/Notification.js";
import { Patient } from "../models/Patient.js";
import { Referral } from "../models/Referral.js";
import { Review } from "../models/Review.js";
import { Symptom } from "../models/Symptom.js";
import { User } from "../models/User.js";
import { signAccessToken } from "../services/tokens.js";
import { hashIdentifier } from "../services/patientService.js";

const enabled = process.env.RUN_PHASE7_MONGO_INTEGRATION_TESTS === "1";
const integration = enabled ? describe : describe.skip;
const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const syntheticPassword = "Synthetic-Phase07-Integration-Pass!";

jest.setTimeout(60_000);

integration("MongoDB-backed Phase 07 care workflows", () => {
  let doctor: InstanceType<typeof User>;
  let patientUser: InstanceType<typeof User>;
  let unrelatedPatientUser: InstanceType<typeof User>;
  let casePatient: InstanceType<typeof Patient>;
  let reportPatient: InstanceType<typeof Patient>;
  let unrelatedPatient: InstanceType<typeof Patient>;
  let assignedCase: InstanceType<typeof Case>;
  let unrelatedCase: InstanceType<typeof Case>;
  let unrelatedPatientCase: InstanceType<typeof Case>;
  let destinationHospital: InstanceType<typeof Hospital>;
  let accessToken = "";
  let patientAccessToken = "";
  let unrelatedPatientAccessToken = "";
  let imageId = "";
  let referralId = "";
  let followUpId = "";

  const authorized = (url: string) => request(app).get(url).set("Authorization", `Bearer ${accessToken}`);
  const createPatient = (input: { name: string; createdBy: string }) => Patient.create({
    name: input.name,
    nameNormalized: input.name.toLocaleLowerCase(),
    mandal: "Synthetic Mandal",
    createdBy: input.createdBy
  });
  const createCase = (patientId: string, createdBy: string) => Case.create({
    patient: patientId,
    createdBy,
    status: "ai_processed",
    priorityBand: "routine_follow_up"
  });

  beforeAll(async () => {
    let databaseName = "";
    try {
      const uri = new URL(env.MONGODB_URI);
      databaseName = decodeURIComponent(uri.pathname.slice(1));
      if (!["localhost", "127.0.0.1", "::1"].includes(uri.hostname.toLowerCase())) {
        throw new Error("Phase 07 integration tests require a loopback MongoDB host.");
      }
      if (!/^aarogya_phase07_[a-z0-9_]+$/i.test(databaseName)) {
        throw new Error("Phase 07 integration tests require a uniquely named aarogya_phase07_* database.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Phase 07 integration tests")) throw error;
      throw new Error("Phase 07 integration tests require a valid isolated MongoDB URI.");
    }

    await mongoose.connect(env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([
      AiInference.init(), AiModel.init(), Appointment.init(), AuditLog.init(), Case.init(), CaseImage.init(), Consent.init(),
      DoctorProfile.init(), Hospital.init(), FollowUp.init(), Habit.init(), Notification.init(),
      Patient.init(), Referral.init(), Review.init(), Symptom.init(), User.init()
    ]);

    const [passwordHash] = await Promise.all([bcrypt.hash(syntheticPassword, 4)]);
    const owner = await User.create({
      name: "Synthetic record owner",
      email: `phase7-owner-${uniqueSuffix}@example.invalid`,
      username: `phase7_owner_${uniqueSuffix}`,
      passwordHash,
      role: "system_admin",
      mfaEnabled: true
    });
    const sourceHospital = await Hospital.create({
      name: "Synthetic source hospital",
      code: `P7-SOURCE-${uniqueSuffix}`,
      active: true,
      synthetic: true
    });
    destinationHospital = await Hospital.create({
      name: "Synthetic referral hospital",
      code: `P7-DEST-${uniqueSuffix}`,
      active: true,
      synthetic: true
    });
    doctor = await User.create({
      name: "Synthetic verified doctor",
      email: `phase7-doctor-${uniqueSuffix}@example.invalid`,
      username: `phase7_doctor_${uniqueSuffix}`,
      passwordHash,
      role: "doctor",
      mfaEnabled: true
    });
    await DoctorProfile.create({
      user: doctor._id,
      registrationNo: `P7-REG-${uniqueSuffix}`,
      registrationAuthority: "Synthetic council",
      specialty: "Oral health",
      verificationStatus: "verified",
      hospital: sourceHospital._id
    });
    accessToken = signAccessToken({ sub: doctor._id.toString(), role: "doctor", ver: doctor.tokenVersion });

    const patientPhone = "9000000001";
    const unrelatedPatientPhone = "9000000002";
    patientUser = await User.create({
      name: "Synthetic patient",
      phone: `+91${patientPhone}`,
      passwordHash,
      role: "patient"
    });
    unrelatedPatientUser = await User.create({
      name: "Synthetic unrelated patient",
      phone: `+91${unrelatedPatientPhone}`,
      passwordHash,
      role: "patient"
    });
    patientAccessToken = signAccessToken({ sub: patientUser._id.toString(), role: "patient", ver: patientUser.tokenVersion });
    unrelatedPatientAccessToken = signAccessToken({ sub: unrelatedPatientUser._id.toString(), role: "patient", ver: unrelatedPatientUser.tokenVersion });
    casePatient = await Patient.create({
      name: "Synthetic appointment patient",
      nameNormalized: "syntheticappointmentpatient",
      mandal: "Synthetic Mandal",
      phoneHash: hashIdentifier(patientPhone),
      createdBy: owner._id
    });
    reportPatient = await createPatient({ name: "Synthetic report patient", createdBy: doctor._id.toString() });
    unrelatedPatient = await Patient.create({
      name: "Synthetic unrelated patient",
      nameNormalized: "syntheticunrelatedpatient",
      mandal: "Synthetic Mandal",
      phoneHash: hashIdentifier(unrelatedPatientPhone),
      createdBy: owner._id
    });
    assignedCase = await createCase(casePatient._id.toString(), owner._id.toString());
    assignedCase.notes = "Synthetic patient-reported screening note.";
    assignedCase.riskScore = 20;
    assignedCase.riskFactors = [{ rule: "synthetic_rule", points: 20, evidence: "Synthetic reported indicator." }];
    await assignedCase.save();
    unrelatedCase = await createCase(casePatient._id.toString(), owner._id.toString());
    unrelatedPatientCase = await createCase(unrelatedPatient._id.toString(), owner._id.toString());
    await Promise.all([
      Symptom.create({ patient: casePatient._id, name: "Synthetic symptom", severity: "mild", durationDays: 3, createdBy: owner._id }),
      Habit.create({ patient: casePatient._id, name: "Synthetic habit", frequency: "occasional", createdBy: owner._id })
    ]);
    await Appointment.create({
      case: assignedCase._id,
      patient: casePatient._id,
      clinician: doctor._id,
      hospital: sourceHospital._id,
      type: "physical",
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
      status: "confirmed"
    });
    const image = await CaseImage.create({
      case: assignedCase._id,
      patient: casePatient._id,
      originalName: "synthetic-screening.jpg",
      mimeType: "image/jpeg",
      size: 128,
      storageKey: `cases/${assignedCase._id}/${"a".repeat(64)}.jpg`,
      sha256: "a".repeat(64),
      qualityStatus: "usable",
      encryptedAtRest: true
    });
    imageId = image._id.toString();
    const demoModel = await AiModel.create({
      key: `phase7-demo-${uniqueSuffix}`,
      name: "Synthetic Phase 07 Demo Model",
      version: "test",
      license: "Demo",
      permitted_use: "Demonstration only"
    });
    await AiInference.create({
      case: assignedCase._id,
      image: image._id,
      model: demoModel._id,
      state: "suspicious_finding_for_clinical_review",
      output: { label: "SYNTHETIC_DEMO_OBSERVATION" },
      metadata: { mode: "demo", model: { name: demoModel.name, version: demoModel.version } }
    });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it("scopes doctor case summaries and image access to an authorized case and active consent", async () => {
    const caseOverview = await authorized(`/api/v1/cases/${assignedCase._id}/care-overview`);
    expect(caseOverview.status).toBe(200);
    expect(caseOverview.body.cases).toHaveLength(1);
    expect(caseOverview.body.cases[0].id).toBe(assignedCase._id.toString());
    expect(caseOverview.body.cases[0].aiResult).toMatchObject({
      category: null,
      processingStatus: "demo_not_validated",
      clinicallyValidated: false
    });

    const unrelatedOverview = await authorized(`/api/v1/cases/${unrelatedCase._id}/care-overview`);
    expect(unrelatedOverview.status).toBe(403);
    const unrelatedImages = await authorized(`/api/v1/cases/${unrelatedPatientCase._id}/images`);
    expect(unrelatedImages.status).toBe(403);

    const missingConsent = await authorized(`/api/v1/cases/${assignedCase._id}/images`);
    expect(missingConsent.status).toBe(403);
    const missingSummaryConsent = await authorized(`/api/v1/cases/${assignedCase._id}/clinical-summary`);
    expect(missingSummaryConsent.status).toBe(403);
    const unrelatedSummary = await authorized(`/api/v1/cases/${unrelatedCase._id}/clinical-summary`);
    expect(unrelatedSummary.status).toBe(403);
    const patientSummary = await request(app)
      .get(`/api/v1/cases/${assignedCase._id}/clinical-summary`)
      .set("Authorization", `******`);
    expect([401, 403]).toContain(patientSummary.status);

    await Consent.create({ patient: casePatient._id, purpose: "screening", granted: true, grantedBy: doctor._id });
    const imageList = await authorized(`/api/v1/cases/${assignedCase._id}/images`);
    expect(imageList.status).toBe(200);
    expect(imageList.body.images).toEqual([expect.objectContaining({
      id: imageId,
      qualityStatus: "usable",
      aiResult: expect.objectContaining({ status: "demo_not_validated", clinicallyValidated: false })
    })]);
    expect(imageList.body.images[0].aiResult).not.toHaveProperty("category");
    expect(imageList.body.images[0].aiResult).not.toHaveProperty("output");

    const inferenceResponse = await request(app)
      .post("/api/v1/ai/infer")
      .auth(accessToken, { type: "bearer" })
      .send({ caseId: assignedCase._id.toString(), imageId, modelKey: "demo" });
    expect(inferenceResponse.status).toBe(201);
    expect(inferenceResponse.body).toMatchObject({
      processingStatus: "demo_not_validated",
      inference: { clinicallyValidated: false, status: "demo_not_validated" },
      category: null
    });
    expect(inferenceResponse.body.inference).not.toHaveProperty("output");

    const aiHistory = await authorized(`/api/v1/cases/${assignedCase._id}/ai-history`);
    expect(aiHistory.status).toBe(200);
    expect(aiHistory.body.inferences).toHaveLength(2);
    expect(aiHistory.body.inferences[0]).toMatchObject({ status: "demo_not_validated", clinicallyValidated: false });
    expect(aiHistory.body.inferences[0]).not.toHaveProperty("output");
    expect(aiHistory.body.inferences[0]).not.toHaveProperty("state");

    const summaryResponse = await authorized(`/api/v1/cases/${assignedCase._id}/clinical-summary`);
    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.headers["cache-control"]).toBe("no-store");
    expect(summaryResponse.body.summary).toMatchObject({
      generationMethod: "structured_record_summary",
      aiGenerated: false,
      patientHistory: {
        association: "patient_profile; reporter not recorded; not linked to this specific case",
        symptoms: [expect.objectContaining({ name: "Synthetic symptom", severity: "mild" })],
        habits: [expect.objectContaining({ name: "Synthetic habit", frequency: "occasional" })]
      },
      recordedRiskIndicators: { score: 20, factors: [{ rule: "synthetic_rule", evidence: "Synthetic reported indicator." }] },
      aiSummary: { status: "unavailable", reason: "NO_VALIDATED_CLINICAL_MODEL", aiGenerated: false }
    });
    expect(summaryResponse.body.summary.disclaimer).toMatch(/not a diagnosis/i);
    expect(await AuditLog.exists({ action: "clinical_summary_viewed", resourceId: assignedCase._id.toString() })).toBeTruthy();
  });

  it("records and signs an independent review, then manages referral and follow-up transitions", async () => {
    const reviewResponse = await request(app)
      .post(`/api/v1/cases/${assignedCase._id}/review`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ decision: "disagree", reason: "Synthetic independent review.", findings: "Synthetic observation.", aiAgreement: "disagree" });
    expect(reviewResponse.status).toBe(201);
    const reviewId = reviewResponse.body.review._id;
    const signResponse = await request(app)
      .post(`/api/v1/cases/${assignedCase._id}/sign`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ reviewId });
    expect(signResponse.status).toBe(200);
    expect(signResponse.body.review.signedAt).toBeTruthy();

    const referralResponse = await request(app)
      .post(`/api/v1/cases/${assignedCase._id}/referrals`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ hospital: destinationHospital._id.toString(), toSpecialty: "Oral health", priority: "routine", reason: "Synthetic specialist review." });
    expect(referralResponse.status).toBe(201);
    referralId = referralResponse.body.referral._id;
    expect(referralResponse.body.referral.status).toBe("requested");

    const accepted = await request(app)
      .patch(`/api/v1/referrals/${referralId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "accepted" });
    expect(accepted.status).toBe(200);
    const scheduled = await request(app)
      .patch(`/api/v1/referrals/${referralId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "scheduled", appointmentDetails: "Synthetic date and destination." });
    expect(scheduled.status).toBe(200);

    const followUpResponse = await request(app)
      .post(`/api/v1/cases/${assignedCase._id}/follow-ups`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), referralId });
    expect(followUpResponse.status).toBe(201);
    followUpId = followUpResponse.body.followUp.id;
    expect(followUpResponse.body.followUp.status).toBe("scheduled");

    const completed = await request(app)
      .patch(`/api/v1/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "completed" });
    expect(completed.status).toBe(200);
    const invalidTransition = await request(app)
      .patch(`/api/v1/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "scheduled", scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() });
    expect(invalidTransition.status).toBe(409);

    const notifications = await Notification.countDocuments({ patient: casePatient._id, channel: "inapp" });
    expect(notifications).toBeGreaterThan(0);
    expect(await Referral.exists({ _id: referralId, case: assignedCase._id, status: "scheduled" })).toBeTruthy();
    expect(await FollowUp.exists({ _id: followUpId, case: assignedCase._id, status: "completed" })).toBeTruthy();
  });

  it("generates an audited synthetic report only for a patient in the doctor's care", async () => {
    const report = await authorized(`/api/v1/patients/${reportPatient._id}/medical-report`);
    expect(report.status).toBe(200);
    expect(report.headers["content-type"]).toContain("application/pdf");
    expect(report.headers["cache-control"]).toBe("no-store");
    expect(await AuditLog.exists({ action: "report_generated", resourceId: reportPatient._id.toString() })).toBeTruthy();

    const denied = await authorized(`/api/v1/patients/${unrelatedPatient._id}/medical-report`);
    expect(denied.status).toBe(403);
  });

  it("limits patient notifications and read actions to the uniquely linked patient record", async () => {
    const notification = await Notification.create({
      patient: casePatient._id,
      channel: "inapp",
      template: "synthetic_phase7_notice",
      language: "en",
      status: "sent"
    });
    const ownList = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${patientAccessToken}`);
    expect(ownList.status).toBe(200);
    expect(ownList.body.notifications.some((item: { _id: string }) => item._id === notification._id.toString())).toBe(true);

    const unrelatedList = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${unrelatedPatientAccessToken}`);
    expect(unrelatedList.status).toBe(200);
    expect(unrelatedList.body.notifications.some((item: { _id: string }) => item._id === notification._id.toString())).toBe(false);
    const deniedRead = await request(app)
      .patch(`/api/v1/notifications/${notification._id}/read`)
      .set("Authorization", `Bearer ${unrelatedPatientAccessToken}`);
    expect(deniedRead.status).toBe(404);
    const ownRead = await request(app)
      .patch(`/api/v1/notifications/${notification._id}/read`)
      .set("Authorization", `Bearer ${patientAccessToken}`);
    expect(ownRead.status).toBe(200);
    expect(ownRead.body.notification.status).toBe("read");
  });
});

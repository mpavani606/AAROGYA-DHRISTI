import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import request from "supertest";
import { env } from "../config/env.js";
import { app } from "../app.js";
import { AiServiceEvent } from "../models/AiServiceEvent.js";
import { Appointment } from "../models/Appointment.js";
import { AuditLog } from "../models/AuditLog.js";
import { Case } from "../models/Case.js";
import { CaseImage } from "../models/CaseImage.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { District, Hospital, Mandal } from "../models/Geo.js";
import { MedicalRecord } from "../models/MedicalRecord.js";
import { Patient } from "../models/Patient.js";
import { User } from "../models/User.js";
import { signAccessToken } from "../services/tokens.js";
import { inferPersistedImage } from "../services/screeningService.js";

const enabled = process.env.RUN_PHASE8_MONGO_INTEGRATION_TESTS === "1";
const integration = enabled ? describe : describe.skip;
const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const syntheticPassword = "Synthetic-Phase08-Integration-Pass!";

jest.setTimeout(60_000);

integration("MongoDB-backed Phase 08 analytics and operations", () => {
  let systemToken = "";
  let systemAdminId = "";
  let districtToken = "";
  let managerToken = "";
  let doctorToken = "";
  let caseAId = "";
  let patientAId = "";
  let doctorAId = "";
  let districtWithoutMandalsId = "";
  let mandalAId = "";
  let mandalBId = "";
  let hospitalBId = "";

  const authorizedGet = (url: string, token: string) =>
    request(app).get(url).set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    let databaseName = "";
    try {
      const uri = new URL(env.MONGODB_URI);
      databaseName = decodeURIComponent(uri.pathname.slice(1));
      if (!["localhost", "127.0.0.1", "::1"].includes(uri.hostname.toLowerCase())) {
        throw new Error("Phase 08 integration tests require a loopback MongoDB host.");
      }
      if (!/^aarogya_phase08_[a-z0-9_]+$/i.test(databaseName)) {
        throw new Error("Phase 08 integration tests require a uniquely named aarogya_phase08_* database.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Phase 08 integration tests")) throw error;
      throw new Error("Phase 08 integration tests require a valid isolated MongoDB URI.");
    }

    await mongoose.connect(env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([
      AiServiceEvent.init(), Appointment.init(), AuditLog.init(), Case.init(), CaseImage.init(), District.init(),
      DoctorProfile.init(), Hospital.init(), Mandal.init(), MedicalRecord.init(), Patient.init(), User.init()
    ]);

    const passwordHash = await bcrypt.hash(syntheticPassword, 4);
    const district = await District.create({ name: "Synthetic Phase 08 District", code: `P8-D-${uniqueSuffix}`, synthetic: true });
    const districtWithoutMandals = await District.create({
      name: "Synthetic Phase 08 Empty District",
      code: `P8-DE-${uniqueSuffix}`,
      synthetic: true
    });
    districtWithoutMandalsId = districtWithoutMandals._id.toString();
    const mandalA = await Mandal.create({ name: "Synthetic Phase 08 Mandal A", code: `P8-MA-${uniqueSuffix}`, district: district._id, synthetic: true });
    const mandalB = await Mandal.create({ name: "Synthetic Phase 08 Mandal B", code: `P8-MB-${uniqueSuffix}`, district: district._id, synthetic: true });
    mandalAId = mandalA._id.toString();
    mandalBId = mandalB._id.toString();

    const hospitalA = await Hospital.create({
      name: "Synthetic Phase 08 Hospital A", code: `P8-HA-${uniqueSuffix}`, active: true, ownershipType: "government",
      mandal: mandalA._id, mandalId: mandalA._id, synthetic: true
    });
    const hospitalB = await Hospital.create({
      name: "Synthetic Phase 08 Hospital B", code: `P8-HB-${uniqueSuffix}`, active: true, ownershipType: "private",
      mandal: mandalB._id, mandalId: mandalB._id, synthetic: true
    });
    hospitalBId = hospitalB._id.toString();

    const systemAdmin = await User.create({
      name: "Synthetic Phase 08 System Admin",
      email: `phase8-admin-${uniqueSuffix}@example.invalid`,
      username: `phase8_admin_${uniqueSuffix}`,
      passwordHash,
      role: "system_admin",
      mfaEnabled: true
    });
    systemAdminId = systemAdmin._id.toString();
    const districtAdmin = await User.create({
      name: "Synthetic Phase 08 District Admin",
      email: `phase8-district-${uniqueSuffix}@example.invalid`,
      username: `phase8_district_${uniqueSuffix}`,
      passwordHash,
      role: "district_admin",
      mfaEnabled: true,
      assignments: [{ scope: "mandal", district: district.code, mandal: mandalAId }]
    });
    const manager = await User.create({
      name: "Synthetic Phase 08 Hospital Manager",
      email: `phase8-manager-${uniqueSuffix}@example.invalid`,
      username: `phase8_manager_${uniqueSuffix}`,
      passwordHash,
      role: "hospital_manager",
      hospitalId: hospitalA._id,
      mfaEnabled: true
    });
    const doctor = await User.create({
      name: "Synthetic Phase 08 Verified Doctor",
      email: `phase8-doctor-${uniqueSuffix}@example.invalid`,
      username: `phase8_doctor_${uniqueSuffix}`,
      passwordHash,
      role: "doctor",
      mfaEnabled: true,
      assignments: [{ scope: "mandal", mandal: mandalAId }]
    });
    doctorAId = doctor._id.toString();
    const unrelatedDoctor = await User.create({
      name: "Synthetic Phase 08 Unrelated Doctor",
      email: `phase8-unrelated-doctor-${uniqueSuffix}@example.invalid`,
      username: `phase8_unrelated_doctor_${uniqueSuffix}`,
      passwordHash,
      role: "doctor",
      mfaEnabled: true,
      assignments: [{ scope: "mandal", mandal: mandalBId }]
    });
    await DoctorProfile.create({
      user: doctor._id,
      registrationNo: `P8-REG-${uniqueSuffix}`,
      specialty: "Synthetic specialty",
      verificationStatus: "verified",
      hospital: hospitalA._id,
      availability: [{
        start: new Date(Date.now() + 48 * 60 * 60 * 1000),
        end: new Date(Date.now() + 48 * 60 * 60 * 1000 + 60 * 60 * 1000),
        booked: false
      }]
    });
    await DoctorProfile.create({
      user: unrelatedDoctor._id,
      registrationNo: `P8-REG-B-${uniqueSuffix}`,
      specialty: "Synthetic specialty",
      verificationStatus: "verified",
      hospital: hospitalB._id
    });
    systemToken = signAccessToken({ sub: systemAdmin._id.toString(), role: "system_admin", ver: systemAdmin.tokenVersion });
    districtToken = signAccessToken({ sub: districtAdmin._id.toString(), role: "district_admin", ver: districtAdmin.tokenVersion });
    managerToken = signAccessToken({ sub: manager._id.toString(), role: "hospital_manager", ver: manager.tokenVersion });
    doctorToken = signAccessToken({ sub: doctor._id.toString(), role: "doctor", ver: doctor.tokenVersion });

    const patientA = await Patient.create({
      name: "Synthetic Phase 08 Patient A",
      nameNormalized: `syntheticphase08a${uniqueSuffix}`,
      mandal: mandalA.name,
      mandalId: mandalA._id,
      createdBy: systemAdmin._id
    });
    patientAId = patientA._id.toString();
    const patientB = await Patient.create({
      name: "Synthetic Phase 08 Patient B",
      nameNormalized: `syntheticphase08b${uniqueSuffix}`,
      mandal: mandalB.name,
      mandalId: mandalB._id,
      createdBy: systemAdmin._id
    });
    const screeningDateA = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 12));
    const screeningDateB = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1, 12));
    const [caseA, caseB] = await Promise.all([
      Case.create({ patient: patientA._id, createdBy: systemAdmin._id, status: "clinician_reviewed", createdAt: screeningDateA }),
      Case.create({ patient: patientB._id, createdBy: systemAdmin._id, status: "in_review", createdAt: screeningDateB })
    ]);
    caseAId = caseA._id.toString();
    await Promise.all([
      Appointment.create({
        case: caseA._id, patient: patientA._id, clinician: doctor._id, hospital: hospitalA._id,
        type: "physical", startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 25 * 60 * 60 * 1000), status: "confirmed"
      }),
      Appointment.create({
        case: caseB._id, patient: patientB._id, clinician: unrelatedDoctor._id, hospital: hospitalB._id,
        type: "physical", startAt: new Date(Date.now() + 26 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 27 * 60 * 60 * 1000), status: "confirmed"
      }),
      AiServiceEvent.create({
        status: "completed", resultCategory: "NO_SUSPICIOUS_FEATURES_IDENTIFIED",
        modelVersion: "1.0.0", durationMs: 21
      }),
      AiServiceEvent.create({
        status: "unavailable", modelVersion: "1.0.0", durationMs: 10_000,
        errorCode: "AI_SERVICE_TIMEOUT"
      })
    ]);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it("isolates district, hospital-manager, and verified-doctor aggregate scopes", async () => {
    const districtOverview = await authorizedGet("/api/v1/analytics/overview", districtToken);
    expect(districtOverview.status).toBe(200);
    expect(districtOverview.body.totals.screenings.total).toBe(1);
    expect(districtOverview.body.totals.screenings.byStatus).toEqual({ clinician_reviewed: 1 });

    const districtEscape = await authorizedGet(`/api/v1/analytics/overview?mandalId=${mandalBId}`, districtToken);
    expect(districtEscape.status).toBe(403);

    const managerOverview = await authorizedGet("/api/v1/analytics/overview", managerToken);
    expect(managerOverview.status).toBe(200);
    expect(managerOverview.body.totals.screenings.total).toBe(1);
    const managerEscape = await authorizedGet(`/api/v1/analytics/overview?hospitalId=${hospitalBId}`, managerToken);
    expect(managerEscape.status).toBe(403);

    const doctorOverview = await authorizedGet("/api/v1/analytics/overview", doctorToken);
    expect(doctorOverview.status).toBe(200);
    expect(doctorOverview.body.totals.screenings.total).toBe(1);
    expect(doctorOverview.body.totals.registeredPatients).toBeNull();
    const doctorGeoFilter = await authorizedGet(`/api/v1/analytics/overview?mandalId=${mandalAId}`, doctorToken);
    expect(doctorGeoFilter.status).toBe(400);

    const scopedMandal = await authorizedGet(`/api/v1/analytics/overview?mandalId=${mandalAId}`, systemToken);
    expect(scopedMandal.status).toBe(200);
    expect(scopedMandal.body.totals.screenings.total).toBe(1);

    const emptyDistrict = await authorizedGet(`/api/v1/analytics/overview?districtId=${districtWithoutMandalsId}`, systemToken);
    expect(emptyDistrict.status).toBe(200);
    expect(emptyDistrict.body.totals.screenings.total).toBe(0);
    expect(emptyDistrict.body.totals.appointments.total).toBe(0);
    expect(emptyDistrict.body.totals.activeHospitals).toBe(0);
    expect(emptyDistrict.body.totals.doctors.total).toBe(0);
  });

  it("validates date and status filters and paginates aggregate trend results", async () => {
    const invalidRange = await authorizedGet(
      `/api/v1/analytics/overview?from=2026-03-01&to=2026-02-01`,
      systemToken
    );
    expect(invalidRange.status).toBe(400);
    const statusFilter = await authorizedGet(
      `/api/v1/analytics/overview?screeningStatus=in_review&page=1&pageSize=1`,
      systemToken
    );
    expect(statusFilter.status).toBe(200);
    expect(statusFilter.body.totals.screenings.byStatus).toEqual({ in_review: 1 });
    expect(statusFilter.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
  });

  it("books only a scheduled doctor time and exposes prior treatment metadata to the assigned doctor", async () => {
    if (!doctorAId) throw new Error("Synthetic verified doctor account was not created.");
    const schedule = await authorizedGet(`/api/v1/doctors/${doctorAId}/slots`, doctorToken);
    expect(schedule.status).toBe(200);
    expect(schedule.body.slots).toHaveLength(2);
    expect(schedule.body.slots[0]).toMatchObject({ id: expect.any(String), availabilityId: expect.any(String), start: expect.any(String), end: expect.any(String) });

    const slot = schedule.body.slots[0] as { availabilityId: string; start: string; end: string };
    const nextSlot = schedule.body.slots[1] as { availabilityId: string; start: string; end: string };
    const booking = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        patientId: patientAId,
        clinicianId: doctorAId,
        type: "physical",
        availabilityId: slot.availabilityId,
        startAt: slot.start,
        endAt: slot.end
      });
    expect(booking.status).toBe(201);
    const duplicateBooking = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        patientId: patientAId,
        clinicianId: doctorAId,
        type: "physical",
        availabilityId: slot.availabilityId,
        startAt: slot.start,
        endAt: slot.end
      });
    expect(duplicateBooking.status).toBe(409);

    const missingRescheduleAvailability = await request(app)
      .patch(`/api/v1/appointments/${booking.body.appointment._id}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ startAt: nextSlot.start, endAt: nextSlot.end });
    expect(missingRescheduleAvailability.status).toBe(400);

    const rescheduled = await request(app)
      .patch(`/api/v1/appointments/${booking.body.appointment._id}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ availabilityId: nextSlot.availabilityId, startAt: nextSlot.start, endAt: nextSlot.end, status: "rescheduled" });
    expect(rescheduled.status).toBe(200);
    expect(rescheduled.body.appointment).toMatchObject({ startAt: nextSlot.start, endAt: nextSlot.end, status: "rescheduled" });
    const afterReschedule = await authorizedGet(`/api/v1/doctors/${doctorAId}/slots`, doctorToken);
    expect(afterReschedule.body.slots.map((availableSlot: { start: string }) => availableSlot.start))
      .toContain(slot.start);
    expect(afterReschedule.body.slots.map((availableSlot: { start: string }) => availableSlot.start))
      .not.toContain(nextSlot.start);

    const cancelled = await request(app)
      .patch(`/api/v1/appointments/${booking.body.appointment._id}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ status: "cancelled" });
    expect(cancelled.status).toBe(200);
    const afterCancellation = await authorizedGet(`/api/v1/doctors/${doctorAId}/slots`, doctorToken);
    expect(afterCancellation.body.slots).toHaveLength(2);

    await MedicalRecord.create({
      patient: patientAId,
      author: systemAdminId,
      recordType: "Prescription",
      title: "Synthetic previous treatment",
      sourceHospital: "Synthetic prior hospital",
      sourceHospitalType: "private",
      sourceDoctor: "Synthetic prior doctor",
      notes: "Synthetic treatment details"
    });
    const timeline = await authorizedGet(`/api/v1/patients/${patientAId}/timeline`, doctorToken);
    expect(timeline.status).toBe(200);
    const record = (timeline.body.events as Array<{ record?: Record<string, unknown> }>).find((event) => event.record)?.record;
    expect(record).toMatchObject({
      sourceHospital: "Synthetic prior hospital",
      sourceHospitalType: "private",
      sourceDoctor: "Synthetic prior doctor"
    });

    const hospitals = await authorizedGet("/api/v1/admin/hospitals", systemToken);
    expect(hospitals.status).toBe(200);
    expect(hospitals.body.hospitals.find((hospital: { code: string }) => hospital.code === `P8-HA-${uniqueSuffix}`))
      .toMatchObject({ ownershipType: "government", doctorCount: 1, activeDoctorCount: 1 });
    expect(hospitals.body.hospitals.find((hospital: { code: string }) => hospital.code === `P8-HB-${uniqueSuffix}`))
      .toMatchObject({ ownershipType: "private", doctorCount: 1 });
  });

  it("protects AI and health monitoring and reports only aggregate operational data", async () => {
    const deniedMonitoring = await authorizedGet("/api/v1/ai-monitoring", districtToken);
    expect(deniedMonitoring.status).toBe(403);
    const deniedHealth = await authorizedGet("/api/v1/system-health", managerToken);
    expect(deniedHealth.status).toBe(403);

    const monitoring = await authorizedGet("/api/v1/ai-monitoring", systemToken);
    expect(monitoring.status).toBe(200);
    expect(monitoring.body).toMatchObject({
      mode: "local_deterministic_demo",
      clinicalValidated: false,
      totals: { completed: 1, unavailable: 1 }
    });
    expect(monitoring.body.totals.averageDurationMs).toBeGreaterThan(0);
    expect(JSON.stringify(monitoring.body)).not.toContain("Synthetic Phase 08 Patient");
    const health = await authorizedGet("/api/v1/system-health", systemToken);
    expect(health.status).toBe(200);
    expect(health.body.database.status).toBe("healthy");
    expect(JSON.stringify(health.body)).not.toContain(env.MONGODB_URI);
  });

  it("persists non-identifying AI request telemetry alongside unchanged demonstration results", async () => {
    const caseRecord = await Case.findById(caseAId);
    if (!caseRecord) throw new Error("Synthetic Phase 08 case fixture was not created.");
    const image = await CaseImage.create({
      case: caseRecord._id,
      patient: caseRecord.patient,
      originalName: "synthetic-phase8-screening.jpg",
      mimeType: "image/jpeg",
      size: 128,
      storageKey: `cases/${caseRecord._id}/${uniqueSuffix}.jpg`,
      sha256: "aa".repeat(32),
      qualityStatus: "usable",
      encryptedAtRest: true
    });
    const previousCount = await AiServiceEvent.countDocuments({ status: "completed" });
    const result = await inferPersistedImage(caseRecord._id.toString(), image, systemAdminId);
    expect(result.category).toBe("NO_SUSPICIOUS_FEATURES_IDENTIFIED");
    expect(result.inference.output.category).toBe("NO_SUSPICIOUS_FEATURES_IDENTIFIED");
    expect(await AiServiceEvent.countDocuments({ status: "completed" })).toBe(previousCount + 1);
    const event = await AiServiceEvent.findOne({ resultCategory: result.category }).sort({ createdAt: -1 }).lean();
    expect(event).toMatchObject({ status: "completed", modelVersion: "1.0.0" });
    expect(event).not.toHaveProperty("patient");
    expect(event).not.toHaveProperty("case");
    expect(event).not.toHaveProperty("image");
  });

  it("exports authorized CSV and PDF reports and audits successful exports", async () => {
    const csv = await authorizedGet("/api/v1/operational-reports?format=csv", districtToken);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("screenings.total");
    expect(csv.text).not.toContain("Synthetic Phase 08 Patient");

    const pdf = await authorizedGet("/api/v1/operational-reports?format=pdf", managerToken);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");

    const deniedAiReport = await authorizedGet("/api/v1/operational-reports?report=ai&format=csv", districtToken);
    expect(deniedAiReport.status).toBe(403);
    expect(await AuditLog.countDocuments({ action: "aggregate_operational_report_exported" })).toBe(2);
  });
});

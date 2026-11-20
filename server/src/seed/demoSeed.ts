import crypto from "node:crypto";
import sharp from "sharp";
import { User } from "../models/User.js";
import { District, Mandal, Phc, Village, Habitation, Hospital } from "../models/Geo.js";
import { Patient } from "../models/Patient.js";
import { Consent } from "../models/Consent.js";
import { Token } from "../models/Token.js";
import { Habit } from "../models/Habit.js";
import { Symptom } from "../models/Symptom.js";
import { Case } from "../models/Case.js";
import { CaseImage } from "../models/CaseImage.js";
import { AiModel } from "../models/AiModel.js";
import { AiInference } from "../models/AiInference.js";
import { Review } from "../models/Review.js";
import { Referral } from "../models/Referral.js";
import { Appointment } from "../models/Appointment.js";
import { Investigation } from "../models/Investigation.js";
import { Report } from "../models/Report.js";
import { Diagnosis } from "../models/Diagnosis.js";
import { NavigatorTask } from "../models/NavigatorTask.js";
import { encryptPatientFields } from "../services/patientService.js";
import { hashBuffer, saveLocal } from "../services/mediaService.js";

const now = new Date();
const addDays = (days: number) => new Date(now.getTime() + days * 86_400_000);
const makeSyntheticImage = (color: { r: number; g: number; b: number }) =>
  sharp({ create: { width: 256, height: 256, channels: 3, background: color } }).jpeg().toBuffer();

export async function seedDemoPatients() {
  const district = await District.findOne({ code: "ASR-SYN" });
  const mandals = await Mandal.find({ district: district?._id }).sort({ code: 1 });
  if (!district || mandals.length !== 11) throw new Error("Seed the synthetic district and all 11 mandals before demo patients.");
  const asha = await User.findOne({ email: "asha.demo@demo.local" });
  const doctor = await User.findOne({ email: "mo.demo@demo.local" });
  const specialist = await User.findOne({ email: "specialist.demo@demo.local" });
  const hospital = await Hospital.findOne({ code: "ASR-HOSP-SYN" });
  if (!asha || !doctor || !specialist || !hospital) throw new Error("Demo users and hospital must be seeded before demo patients.");

  const places = await Promise.all(mandals.map(async (mandal) => ({
    mandal,
    phc: await Phc.findOne({ mandal: mandal._id }),
    village: await Village.findOne({ mandal: mandal._id }),
    habitation: await Habitation.findOne({ mandal: mandal._id })
  })));
  if (places.some((place) => !place.phc || !place.village || !place.habitation)) throw new Error("Synthetic village, PHC and habitation records are required.");
  const heroIndex = places.findIndex((place) => place.mandal.name === "G.Madugula");
  if (heroIndex < 0) throw new Error("The synthetic G.Madugula mandal is required for the hero case.");

  await Promise.all([
    User.updateOne({ _id: asha._id }, { $set: { assignments: mandals.map((mandal) => ({ scope: "mandal", mandal: mandal._id.toString() })) } }),
    User.updateOne({ _id: doctor._id }, { $set: { assignments: mandals.map((mandal) => ({ scope: "mandal", mandal: mandal._id.toString() })) } }),
    User.updateOne({ _id: specialist._id }, { $set: { assignments: mandals.map((mandal) => ({ scope: "mandal", mandal: mandal._id.toString() })) } })
  ]);

  const patients = [];
  for (let index = 0; index < 40; index += 1) {
    const place = places[index % places.length]!;
    const age = index === heroIndex ? 46 : 19 + ((index * 7) % 58);
    const record = await Patient.findOneAndUpdate(
      { clientUuid: `phase13-demo-patient-${String(index + 1).padStart(2, "0")}` },
      {
        $set: {
          ...encryptPatientFields({
            name: `Synthetic Patient ${String(index + 1).padStart(2, "0")}`,
            phone: `900000${String(index + 1).padStart(4, "0")}`,
            address: `${place.habitation!.name}, ${place.mandal.name}`,
            dateOfBirth: `${now.getUTCFullYear() - age}-06-15`,
            preferredLanguage: (["en", "te", "hi"] as const)[index % 3],
            mandal: place.mandal.name,
            mandalId: place.mandal._id,
            phcId: place.phc!._id,
            villageId: place.village!._id,
            habitationId: place.habitation!._id
          }),
          active: true,
          createdBy: asha._id
        },
        $setOnInsert: { clientUuid: `phase13-demo-patient-${String(index + 1).padStart(2, "0")}` }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    patients.push(record);
    if (index % 4 !== 0) {
      const habitName = index % 3 === 0 ? "Synthetic tobacco chewing history" : index % 3 === 1 ? "Synthetic areca nut history" : "Synthetic alcohol history";
      await Habit.findOneAndUpdate(
        { patient: record._id, name: habitName },
        { $set: { frequency: index % 2 === 0 ? "occasional" : "daily", quantity: 1, unit: "synthetic entry", startedAt: addDays(-(2 + index % 15) * 365), createdBy: asha._id } },
        { upsert: true, new: true }
      );
    }
  }

  const hero = patients[heroIndex]!;
  await Consent.findOneAndUpdate(
    { patient: hero._id, purpose: "screening" },
    { $set: { granted: true, grantedBy: asha._id }, $setOnInsert: { clientUuid: "phase13-demo-hero-screening-consent" } },
    { upsert: true, new: true }
  );
  const token = await Token.findOneAndUpdate(
    { clientUuid: "phase13-demo-hero-token" },
    { $set: { patient: hero._id, mandal: "GMG", year: now.getUTCFullYear(), sequence: 1, token: "AD-GMG-DEMO-000001" }, $setOnInsert: { clientUuid: "phase13-demo-hero-token" } },
    { upsert: true, new: true }
  );
  await Habit.findOneAndUpdate(
    { patient: hero._id, name: "Synthetic tobacco chewing history" },
    { $set: { frequency: "daily", quantity: 1, unit: "synthetic entry", startedAt: addDays(-11 * 365), createdBy: asha._id } },
    { upsert: true, new: true }
  );
  await Symptom.findOneAndUpdate(
    { patient: hero._id, name: "Persistent white cheek patch (synthetic)" },
    { $set: { severity: "moderate", durationDays: 21, createdBy: asha._id } },
    { upsert: true, new: true }
  );

  const demoCase = await Case.findOneAndUpdate(
    { patient: hero._id, notes: "PHASE13_SYNTHETIC_HERO_CASE" },
    { $set: { status: "clinician_reviewed", priorityBand: "specialist_review", riskScore: 60, riskFactors: [{ rule: "synthetic_demo", points: 60, evidence: "Synthetic workflow demonstration only." }], createdBy: asha._id } },
    { upsert: true, new: true }
  );
  const demoImages = [
    { name: "poor-blur-synthetic.jpg", color: { r: 128, g: 128, b: 128 } },
    { name: "poor-dark-synthetic.jpg", color: { r: 10, g: 10, b: 10 } },
    { name: "poor-glare-synthetic.jpg", color: { r: 255, g: 255, b: 255 } }
  ];
  for (const [index, sample] of demoImages.entries()) {
    const buffer = await makeSyntheticImage(sample.color);
    const sha256 = hashBuffer(buffer);
    const storageKey = `demo/phase13/${sample.name}`;
    await saveLocal(buffer, storageKey);
    await CaseImage.findOneAndUpdate(
      { case: demoCase._id, originalName: sample.name },
      { $set: { patient: hero._id, mimeType: "image/jpeg", size: buffer.length, storageKey, width: 256, height: 256, sha256, qualityStatus: "insufficient" } },
      { upsert: true, new: true }
    );
    if (index === 0) {
      const aiModel = await AiModel.findOneAndUpdate(
        { key: "demo" },
        { $set: { name: "Aarogya Drishti Demo Model", version: "1.0.0", license: "Synthetic demonstration", permitted_use: "Demonstration only; not for clinical use.", status: "active", redFlagTaskType: "clinical-review" } },
        { upsert: true, new: true }
      );
      const caseImage = await CaseImage.findOne({ case: demoCase._id, originalName: sample.name });
      if (!(await AiInference.exists({ case: demoCase._id, image: caseImage!._id }))) {
        await AiInference.create({
          case: demoCase._id,
          image: caseImage!._id,
          model: aiModel._id,
          state: "image_insufficient",
          output: { confidence_note: "Synthetic poor-quality example.", localization: null },
          metadata: { label: "NOT FOR CLINICAL USE", model: aiModel.toObject(), created_at: now.toISOString() }
        });
      }
    }
  }

  const investigation = await Investigation.findOneAndUpdate(
    { case: demoCase._id, type: "biopsy" },
    { $set: { status: "reviewed", advisedAt: addDays(-12), scheduledAt: addDays(-9), collectedAt: addDays(-8), reportReceivedAt: addDays(-4), reviewedAt: addDays(-3) } },
    { upsert: true, new: true }
  );
  const report = await Report.findOneAndUpdate(
    { investigation: investigation._id },
    { $set: { summary: "Synthetic report received for workflow demonstration only; not a real pathology result.", uploadedBy: doctor._id, reviewedBy: doctor._id, reviewedAt: addDays(-3) } },
    { upsert: true, new: true }
  );
  await Review.findOneAndUpdate(
    { case: demoCase._id, version: 1 },
    { $set: { reviewer: doctor._id, decision: "defer", reason: "Synthetic training workflow review; requires real-world clinician assessment.", findings: "Demonstration-only record.", aiAgreement: "not_applicable", signedAt: addDays(-5) } },
    { upsert: true, new: true }
  );
  await Diagnosis.findOneAndUpdate(
    { case: demoCase._id, version: 1 },
    { $set: { category: "clinical_suspicion", enteredBy: doctor._id, evidenceReport: report._id } },
    { upsert: true, new: true }
  );
  await Referral.findOneAndUpdate(
    { case: demoCase._id },
    { $set: { fromUser: doctor._id, toSpecialty: "specialist", hospital: hospital._id, priority: "urgent", reason: "Synthetic workflow demonstration.", status: "accepted" } },
    { upsert: true, new: true }
  );
  await Appointment.findOneAndUpdate(
    { case: demoCase._id, type: "video" },
    { $set: { patient: hero._id, clinician: specialist._id, hospital: hospital._id, startAt: addDays(-6), endAt: new Date(addDays(-6).getTime() + 30 * 60_000), status: "attended", tokenNo: token.token } },
    { upsert: true, new: true }
  );
  await Appointment.findOneAndUpdate(
    { case: demoCase._id, type: "physical" },
    { $set: { patient: hero._id, clinician: doctor._id, hospital: hospital._id, startAt: addDays(-3), endAt: new Date(addDays(-3).getTime() + 30 * 60_000), status: "confirmed", tokenNo: "AD-GMG-DEMO-000002" } },
    { upsert: true, new: true }
  );
  await NavigatorTask.findOneAndUpdate(
    { case: demoCase._id, type: "missed_visit" },
    { $set: { patient: hero._id, dueAt: addDays(1), status: "open", riskPoints: 3, riskBand: "Medium", details: { synthetic: true, note: "Demo follow-up task." } } },
    { upsert: true, new: true }
  );
  return { patientCount: patients.length, heroPatientId: hero._id.toString(), caseId: demoCase._id.toString() };
}

export async function resetDemoPatients() {
  const patients = await Patient.find({ clientUuid: /^phase13-demo-patient-/ }).select("_id");
  const patientIds = patients.map(({ _id }) => _id);
  const cases = await Case.find({ patient: { $in: patientIds }, notes: "PHASE13_SYNTHETIC_HERO_CASE" }).select("_id");
  const caseIds = cases.map(({ _id }) => _id);
  const investigations = await Investigation.find({ case: { $in: caseIds } }).select("_id");
  const investigationIds = investigations.map(({ _id }) => _id);
  await Promise.all([
    Consent.deleteMany({ patient: { $in: patientIds } }),
    Token.deleteMany({ patient: { $in: patientIds } }),
    Habit.deleteMany({ patient: { $in: patientIds } }),
    Symptom.deleteMany({ patient: { $in: patientIds } }),
    CaseImage.deleteMany({ case: { $in: caseIds } }),
    AiInference.deleteMany({ case: { $in: caseIds } }),
    Review.deleteMany({ case: { $in: caseIds } }),
    Referral.deleteMany({ case: { $in: caseIds } }),
    Appointment.deleteMany({ $or: [{ patient: { $in: patientIds } }, { case: { $in: caseIds } }] }),
    Report.deleteMany({ investigation: { $in: investigationIds } }),
    Investigation.deleteMany({ _id: { $in: investigationIds } }),
    Diagnosis.deleteMany({ case: { $in: caseIds } }),
    NavigatorTask.deleteMany({ patient: { $in: patientIds } }),
    Case.deleteMany({ _id: { $in: caseIds } }),
    Patient.deleteMany({ _id: { $in: patientIds } })
  ]);
  return patients.length;
}

export const demoResetConfirmation = crypto.createHash("sha256").update("RESET_SYNTHETIC_DEMO_ONLY").digest("hex").slice(0, 12);

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "./config/env.js";
import { User } from "./models/User.js";
import { DoctorProfile } from "./models/DoctorProfile.js";
import { MedicineInventory } from "./models/MedicineInventory.js";
import { District, Mandal, Phc, GramPanchayat, Village, Habitation, Hospital } from "./models/Geo.js";
import { seedEducation } from "./seed/educationSeed.js";
import { seedDemoPatients } from "./seed/demoSeed.js";
import { seedDemoPrescriptions } from "./seed/prescriptionsSeed.js";
import { seedAsrFacilityDirectory } from "./seed/asrDirectorySeed.js";
import { logger } from "./services/logger.js";

await mongoose.connect(env.MONGODB_URI);
const users = [
  ["asha.demo", "asha_worker", "asha"],
  ["mo.demo", "doctor", "medical_officer"], ["specialist.demo", "doctor", "specialist"],
  ["district.demo", "district_admin", undefined],
  ["admin.demo", "system_admin", undefined], ["patient.demo", "patient", undefined]
] as const;
const demoPasswordHash = await bcrypt.hash("Demo12345!", 12);
for (const [username, role, subRole] of users) {
  await User.updateOne(
    { email: `${username}@demo.local` },
    {
      $set: { name: username, email: `${username}@demo.local`, role, subRole, locale: "en", passwordHash: demoPasswordHash },
      $unset: { phone: "" }
    },
    { upsert: true }
  );
}
logger.info("Synthetic demo users seeded.");
const district = await District.findOneAndUpdate({ code: "ASR-SYN" }, { name: "Alluri Sitharama Raju", teluguName: "అల్లూరి సీతారామ రాజు", code: "ASR-SYN", synthetic: true }, { upsert: true, new: true });
const mandalNames = [["Ananthagiri", "అనంతగిరి"], ["Araku Valley", "అరకు లోయ"], ["Chintapalle", "చింతపల్లి"], ["Dumbriguda", "దుంబ్రిగూడ"], ["G.Madugula", "జి. మాడుగుల"], ["G.K.Veedhi", "జి.కె. వీధి"], ["Hukumpeta", "హుకుంపేట"], ["Koyyuru", "కొయ్యూరు"], ["Munchingiputtu", "ముంచింగిపుట్టు"], ["Paderu", "పాడేరు"], ["Pedabayalu", "పెదబయలు"]] as const;
for (const [i, [name, teluguName]] of mandalNames.entries()) {
  const mandal = await Mandal.findOneAndUpdate({ code: `ASR-M-${i + 1}` }, { name, teluguName, code: `ASR-M-${i + 1}`, district: district._id, districtCode: district.code }, { upsert: true, new: true });
  const phc = await Phc.findOneAndUpdate({ code: `ASR-PHC-${i + 1}` }, { name: `${name} Synthetic PHC`, teluguName: `${teluguName} కృత్రిమ పీహెచ్‌సీ`, code: `ASR-PHC-${i + 1}`, district: district._id, mandal: mandal._id }, { upsert: true, new: true });
  const panchayat = await GramPanchayat.findOneAndUpdate({ code: `ASR-GP-${i + 1}` }, { name: `${name} Sample Panchayat`, teluguName: `${teluguName} నమూనా పంచాయతీ`, code: `ASR-GP-${i + 1}`, district: district._id, mandal: mandal._id }, { upsert: true, new: true });
  const village = await Village.findOneAndUpdate({ code: `ASR-V-${i + 1}` }, { name: `${name} Sample Village`, teluguName: `${teluguName} నమూనా గ్రామం`, code: `ASR-V-${i + 1}`, district: district._id, mandal: mandal._id, gramPanchayat: panchayat._id, phc: phc._id, population: 42, households: 12 }, { upsert: true, new: true });
  await Habitation.findOneAndUpdate({ code: `ASR-H-${i + 1}` }, { name: `${name} Sample Habitation`, teluguName: `${teluguName} నమూనా ఆవాసం`, code: `ASR-H-${i + 1}`, district: district._id, mandal: mandal._id, village: village._id, population: 18, households: 5, coverage: 72 }, { upsert: true, new: true });
}
await Hospital.findOneAndUpdate({ code: "ASR-HOSP-SYN" }, { name: "ASR Synthetic Referral Hospital", teluguName: "ఏఎస్ఆర్ కృత్రిమ రిఫరల్ ఆసుపత్రి", code: "ASR-HOSP-SYN", district: district._id, type: "referral", synthetic: true }, { upsert: true });
logger.info("Synthetic ASR geography seeded (11 mandals).");
const seededMandals = await Mandal.find({ district: district._id }).sort({ code: 1 });
for (const [index, mandal] of seededMandals.entries()) {
  const sequence = String(index + 1).padStart(2, "0");
  const hospitalCode = `ASR-DEMO-HOSP-${sequence}`;
  const hospital = await Hospital.findOneAndUpdate(
    { code: hospitalCode },
    {
      $set: {
        name: `${mandal.name} Demo Booking Facility`,
        code: hospitalCode,
        district: district._id,
        mandal: mandal._id,
        mandalId: mandal._id,
        type: "PHC",
        ownershipType: "government",
        address: "Synthetic demo record only; this is not a real healthcare facility.",
        active: true,
        synthetic: true
      }
    },
    { upsert: true, new: true }
  );
  const username = index === 0 ? "mo.demo" : index === 1 ? "specialist.demo" : `doctor.asr.${sequence}.demo`;
  const email = `${username}@demo.local`;
  const clinician = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        name: `Demo Clinician ${sequence} - ${mandal.name}`,
        email,
        role: "doctor",
        subRole: index === 1 ? "specialist" : "medical_officer",
        locale: "en",
        status: "active",
        passwordHash: demoPasswordHash
      },
      $unset: { phone: "" }
    },
    { upsert: true, new: true }
  );
  const profile = await DoctorProfile.findOneAndUpdate(
    { user: clinician!._id },
    {
      $set: {
        registrationNo: `DEMO-ASR-DR-${sequence}`,
        registrationAuthority: "Synthetic demo data; not a real medical registration.",
        specialty: "Demo General Medicine",
        hospital: hospital!._id,
        synthetic: true,
        verificationStatus: "verified"
      },
      $setOnInsert: { availability: [] }
    },
    { upsert: true, new: true }
  );
  const scheduledDays = new Set(profile!.availability.map((slot: { start?: Date }) => slot.start?.toDateString()));
  let addedSchedule = false;
  for (let daysAhead = 1; daysAhead <= 14; daysAhead += 1) {
    const start = new Date();
    start.setDate(start.getDate() + daysAhead);
    if (start.getDay() === 0 || start.getDay() === 6 || scheduledDays.has(start.toDateString())) continue;
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(11, 0, 0, 0);
    profile!.availability.push({ start, end, booked: false });
    addedSchedule = true;
  }
  if (addedSchedule) await profile!.save();
}
logger.info("Synthetic ASR demo facilities, clinicians, and future appointment schedules seeded.");
if (await MedicineInventory.countDocuments() === 0) {
  const inventoryAdmin = await User.findOne({ email: "admin.demo@demo.local" }).select("_id");
  const demoHospitals = await Hospital.find({ code: { $in: ["ASR-DEMO-HOSP-01", "ASR-DEMO-HOSP-02"] } }).sort({ code: 1 }).select("_id");
  if (!inventoryAdmin || demoHospitals.length < 2) throw new Error("Demo hospital and administrator records are required to seed sample inventory.");
  await MedicineInventory.insertMany([
    { hospital: demoHospitals[0]!._id, medicineName: "Paracetamol 500 mg", medicineKey: "paracetamol 500 mg", quantity: 25, unit: "tablets", updatedBy: inventoryAdmin._id, synthetic: true },
    { hospital: demoHospitals[1]!._id, medicineName: "Paracetamol 500 mg", medicineKey: "paracetamol 500 mg", quantity: 0, unit: "tablets", updatedBy: inventoryAdmin._id, synthetic: true },
    { hospital: demoHospitals[0]!._id, medicineName: "Oral rehydration salts", medicineKey: "oral rehydration salts", quantity: 12, unit: "sachets", updatedBy: inventoryAdmin._id, synthetic: true }
  ]);
  logger.info("Synthetic sample medicine inventory seeded because the inventory collection was empty.");
}
await seedEducation();
const demo = await seedDemoPatients();
logger.info({ syntheticPatientCount: demo.patientCount }, "Phase 13 synthetic demo pathway seeded.");
const demoPrescriptions = await seedDemoPrescriptions();
logger.info(demoPrescriptions, "Synthetic demo medicines and prescriptions seeded.");
const asrDirectory = await seedAsrFacilityDirectory();
logger.info(asrDirectory, "ASR facility and medical officer directory imported.");
logger.info("Patient education pages and food guide seeded; pages await clinician review.");
await mongoose.disconnect();

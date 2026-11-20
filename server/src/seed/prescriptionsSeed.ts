import { Medicine } from "../models/Medicine.js";
import { Patient } from "../models/Patient.js";
import { Prescription } from "../models/Prescription.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { User } from "../models/User.js";

const demoMedicineRecords = Array.from({ length: 10 }, (_, index) => {
  const sequence = String(index + 1).padStart(2, "0");
  return {
    code: `DEMO-MED-${sequence}`,
    name: `Demo Medicine ${sequence}`,
    category: `Demo category ${((index % 4) + 1)}`,
    strength: "Synthetic sample",
    form: "Demo entry"
  };
});

export async function seedDemoPrescriptions() {
  const patients = await Patient.find({ clientUuid: /^phase13-demo-patient-/ }).sort({ clientUuid: 1 }).select("_id");
  const demoUsers = await User.find({ email: { $in: ["mo.demo@demo.local", "specialist.demo@demo.local"] }, role: "doctor" }).sort({ email: 1 }).select("_id name");
  const verifiedProfiles = await DoctorProfile.find({
    user: { $in: demoUsers.map((doctor) => doctor._id) },
    verificationStatus: "verified"
  }).select("user");
  const verifiedDoctorIds = new Set(verifiedProfiles.map((profile) => profile.user.toString()));
  const doctors = demoUsers.filter((doctor) => verifiedDoctorIds.has(doctor._id.toString()));

  if (patients.length === 0) throw new Error("Synthetic demo patients must be seeded before demo prescriptions.");
  if (doctors.length === 0) throw new Error("Verified synthetic demo doctors must be seeded before demo prescriptions.");

  const medicines = await Promise.all(demoMedicineRecords.map((medicine) => Medicine.findOneAndUpdate(
    { code: medicine.code },
    { $set: { ...medicine, synthetic: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )));
  const dateBase = new Date();
  const statuses = ["active", "completed", "pending"] as const;

  for (let index = 0; index < 100; index += 1) {
    const sequence = index + 1;
    const medicine = medicines[index % medicines.length]!;
    const patient = patients[index % patients.length]!;
    const doctor = doctors[index % doctors.length]!;
    const prescriptionDate = new Date(dateBase);
    prescriptionDate.setUTCDate(prescriptionDate.getUTCDate() - (index % 100));
    const date = prescriptionDate.toISOString().slice(0, 10);
    const prescriptionId = `DEMO-RX-${String(sequence).padStart(4, "0")}`;
    const status = statuses[(index + Math.floor(index / 10)) % statuses.length]!;
    const medicineItem = {
      medicine: medicine._id,
      medicineName: medicine.name,
      category: medicine.category,
      strength: medicine.strength,
      dosage: "Demo-only sample; not an instruction",
      frequency: "Demo-only sample",
      durationDays: ((index % 14) + 1),
      quantity: "Synthetic sample",
      instructions: "DEMO DATA — not for medical use."
    };

    await Prescription.updateOne(
      { demoRecordKey: `aarogya-demo-prescription-${sequence}` },
      {
        $set: {
          patient: patient._id,
          medicineName: medicine.name,
          dosage: medicineItem.dosage,
          doctor: doctor.name,
          doctorUser: doctor._id,
          prescriptionDate: date,
          notes: "DEMO DATA — fictional record only; not a valid medical prescription.",
          source: "demo",
          medicines: [medicineItem],
          status,
          prescriptionId,
          isDemoData: true,
          demoRecordKey: `aarogya-demo-prescription-${sequence}`,
          createdBy: doctor._id
        }
      },
      { upsert: true, runValidators: true }
    );
  }

  const seededCount = await Prescription.countDocuments({ isDemoData: true, demoRecordKey: /^aarogya-demo-prescription-/ });
  if (seededCount !== 100) throw new Error(`Expected 100 demo prescriptions after seeding; found ${seededCount}.`);
  return { prescriptionCount: seededCount, medicineCount: medicines.length };
}

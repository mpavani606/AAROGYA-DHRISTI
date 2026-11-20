import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DirectoryDoctor, FacilityDirectory } from "../models/FacilityDirectory.js";

const phcSchema = z.object({
  sourceSerial: z.number().int().min(1).max(62),
  facilityName: z.string().trim().min(1).max(180),
  facilityType: z.literal("PHC"),
  district: z.string().trim().min(1).max(100),
  mandal: z.string().trim().min(1).max(100),
  medicalOfficerName: z.string().trim().min(1).max(160),
  mobile: z.string().trim().min(7).max(40),
  email: z.string().email().nullable()
}).strict();

const majorFacilitySchema = z.object({
  facilityName: z.string().trim().min(1).max(180),
  facilityType: z.enum(["District Hospital", "Area Hospital", "CHC"]),
  district: z.string().trim().min(1).max(100),
  mandal: z.string().trim().min(1).max(100),
  beds: z.number().int().positive(),
  sourceName: z.string().trim().min(1).max(200),
  sourceUrl: z.string().url(),
  sourceSnapshotDate: z.string().nullable(),
  sourceVerifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
}).strict();

const dataSchema = z.object({
  sourceDocument: z.string().min(1).max(255),
  sourceName: z.string().min(1).max(200),
  sourceSnapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phcs: z.array(phcSchema).length(62),
  majorFacilities: z.array(majorFacilitySchema).length(4)
}).strict();

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const excludedMandalNames = [
  "Addateegala",
  "Chintapalli",
  "Chintapalle",
  "Chintur",
  "Devipatnam",
  "Gangavaram",
  "Kunavaram",
  "Maredumilli",
  "Nellipaka",
  "Rajavommangi",
  "Rampachodavaram",
  "Vararamchandrapuram",
  "Vararamachandrapuram",
  "Y. Ramavaram"
].map(normalize);
const isExcludedMandal = (mandal: string) => excludedMandalNames.includes(normalize(mandal));
const sourceFile = fileURLToPath(new URL("./data/asrDistrictDirectory.json", import.meta.url));

export async function seedAsrFacilityDirectory() {
  const rawData: unknown = JSON.parse(await readFile(sourceFile, "utf8"));
  const data = dataSchema.parse(rawData);
  const phcs = data.phcs.filter((phc) => !isExcludedMandal(phc.mandal));
  const majorFacilities = data.majorFacilities.filter((facility) => !isExcludedMandal(facility.mandal));
  const removedPhcs = data.phcs.filter((phc) => isExcludedMandal(phc.mandal));
  const removedMajorFacilities = data.majorFacilities.filter((facility) => isExcludedMandal(facility.mandal));
  const importedAt = new Date();
  const phcSource = {
    name: data.sourceName,
    document: data.sourceDocument,
    snapshotDate: data.sourceSnapshotDate,
    importedAt
  };
  const facilitySourceKeysToRemove = [
    ...removedPhcs.map((phc) => `asr-apmsidc-phc-${phc.sourceSerial}`),
    ...removedMajorFacilities.map((facility) => `asr-district-health-${normalize(facility.facilityName).replace(/\s+/g, "-")}`)
  ];
  const removedFacilities = await FacilityDirectory.find({ sourceKey: { $in: facilitySourceKeysToRemove } }).select("_id").lean();
  await DirectoryDoctor.deleteMany({
    sourceKey: { $in: removedPhcs.map((phc) => `asr-apmsidc-mo-${phc.sourceSerial}`) }
  });
  if (removedFacilities.length) {
    await DirectoryDoctor.deleteMany({
      hospitalId: { $in: removedFacilities.map((facility) => facility._id) },
      sourceKey: /^asr-apmsidc-mo-/
    });
    await FacilityDirectory.deleteMany({ _id: { $in: removedFacilities.map((facility) => facility._id) } });
  }

  for (const phc of phcs) {
    const normalizedKey = `${normalize(phc.facilityType)}|${normalize(phc.facilityName)}|${normalize(phc.mandal)}`;
    const facility = await FacilityDirectory.findOneAndUpdate(
      { normalizedKey },
      {
        $set: {
          sourceKey: `asr-apmsidc-phc-${phc.sourceSerial}`,
          normalizedKey,
          name: phc.facilityName,
          facilityType: phc.facilityType,
          hospitalCode: null,
          district: phc.district,
          mandal: phc.mandal,
          address: null,
          contactNumber: null,
          email: null,
          beds: null,
          sourceSerial: phc.sourceSerial,
          source: phcSource
        }
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    if (!facility) throw new Error(`Failed to import PHC source row ${phc.sourceSerial}.`);

    await DirectoryDoctor.findOneAndUpdate(
      { sourceKey: `asr-apmsidc-mo-${phc.sourceSerial}` },
      {
        $set: {
          hospitalId: facility._id,
          name: phc.medicalOfficerName,
          role: "Medical Officer / Contact Person",
          specialization: null,
          registrationNumber: null,
          hprId: null,
          mobile: phc.mobile,
          email: phc.email,
          district: phc.district,
          mandal: phc.mandal,
          source: phcSource
        },
        $setOnInsert: { sourceKey: `asr-apmsidc-mo-${phc.sourceSerial}` }
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  }

  for (const facilityRecord of majorFacilities) {
    const normalizedKey = `${normalize(facilityRecord.facilityType)}|${normalize(facilityRecord.facilityName)}|${normalize(facilityRecord.mandal)}`;
    const sourceKey = `asr-district-health-${normalize(facilityRecord.facilityName).replace(/\s+/g, "-")}`;
    await FacilityDirectory.findOneAndUpdate(
      { normalizedKey },
      {
        $set: {
          sourceKey,
          normalizedKey,
          name: facilityRecord.facilityName,
          facilityType: facilityRecord.facilityType,
          hospitalCode: null,
          district: facilityRecord.district,
          mandal: facilityRecord.mandal,
          address: null,
          contactNumber: null,
          email: null,
          beds: facilityRecord.beds,
          sourceSerial: null,
          source: {
            name: facilityRecord.sourceName,
            url: facilityRecord.sourceUrl,
            ...(facilityRecord.sourceSnapshotDate ? { snapshotDate: facilityRecord.sourceSnapshotDate } : {}),
            verifiedOn: facilityRecord.sourceVerifiedOn,
            importedAt
          }
        }
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  }

  const [facilityCount, majorFacilityCount, doctorCount] = await Promise.all([
    FacilityDirectory.countDocuments({ sourceKey: /^asr-apmsidc-phc-/ }),
    FacilityDirectory.countDocuments({ sourceKey: /^asr-district-health-/ }),
    DirectoryDoctor.countDocuments({ sourceKey: /^asr-apmsidc-mo-/ })
  ]);
  if (facilityCount !== phcs.length || majorFacilityCount !== majorFacilities.length || doctorCount !== phcs.length) {
    throw new Error(`ASR directory seed validation failed: ${facilityCount} PHCs, ${majorFacilityCount} major facilities, ${doctorCount} doctors.`);
  }
  return {
    phcs: facilityCount,
    majorFacilities: majorFacilityCount,
    doctors: doctorCount,
    excludedMandals: [...new Set(removedPhcs.map((phc) => phc.mandal).concat(removedMajorFacilities.map((facility) => facility.mandal)))].sort()
  };
}

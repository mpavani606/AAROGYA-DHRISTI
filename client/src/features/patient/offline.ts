import Dexie, { type Table } from "dexie";
import type { PatientDraft } from "./patientApi";
import { uploadPatientRecord } from "./patientApi";
import { decryptLocalValue, encryptLocalValue, enqueueOperation, offlineDb, registerOfflineDataMigration, type EncryptedLocalValue } from "../../offline/db";

export type PatientOutboxItem = {
  id?: number;
  clientUuid?: string;
  ownerId: string;
  createdAt: string;
  provisionalToken: string;
  draft?: PatientDraft;
  encryptedDraft?: EncryptedLocalValue;
  status: "pending" | "sent";
};

export type OfflineRecord = {
  id?: number;
  ownerId: string;
  patientId: string;
  createdAt: string;
  file: Blob;
  fileName: string;
  title: string;
  type: string;
  recordDate: string;
  sourceHospital?: string;
  sourceHospitalType?: "government" | "private";
  sourceDoctor?: string;
  notes: string;
  status: "saved-offline" | "pending" | "syncing" | "synced" | "failed";
  progress: number;
  error?: string;
};

type StoredOfflineRecord = {
  id?: number;
  ownerId: string;
  createdAt: string;
  status: OfflineRecord["status"];
  progress: number;
  error?: string;
  encryptedData?: EncryptedLocalValue;
};

class PatientOutbox extends Dexie {
  registrations!: Table<PatientOutboxItem, number>;
  records!: Table<StoredOfflineRecord, number>;
  constructor() {
    super("aarogya-drishti-outbox");
    this.version(1).stores({ registrations: "++id, status, createdAt" });
    this.version(2).stores({ registrations: "++id, status, createdAt", records: "++id, patientId, status, createdAt" });
    this.version(3).stores({ registrations: "++id, status, createdAt, clientUuid", records: "++id, patientId, status, createdAt" });
    this.version(4).stores({ registrations: "++id, status, createdAt, clientUuid, ownerId", records: "++id, patientId, status, createdAt, ownerId" });
    this.version(5).stores({ registrations: "++id, status, createdAt, clientUuid, ownerId", records: "++id, status, createdAt, ownerId" });
  }
}

export const patientOutbox = new PatientOutbox();

export async function queuePatientRegistration(draft: PatientDraft) {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) throw new Error("Sign in before saving data for offline sync.");
  const provisionalToken = `P-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;
  const operation = await enqueueOperation("create_patient", {
    name: draft.name,
    phone: draft.phone,
    address: draft.address,
    ...(draft.dateOfBirth.trim() ? { dateOfBirth: draft.dateOfBirth.trim() } : {}),
    abha: draft.abhaId,
    mandal: draft.mandal ?? "Paderu",
    preferredLanguage: draft.preferredLanguage ?? "en"
  });
  if (draft.consent) {
    const consentUuidKey = `aarogya-consent-operation-${operation.clientUuid}`;
    const consentUuid = localStorage.getItem(consentUuidKey) ?? crypto.randomUUID();
    localStorage.setItem(consentUuidKey, consentUuid);
    await enqueueOperation("create_consent", { patientClientUuid: operation.clientUuid, purpose: "data_processing", granted: true }, consentUuid);
    await offlineDb.consents.put({
      clientUuid: consentUuid,
      ownerId,
      encryptedData: await encryptLocalValue({ patientClientUuid: operation.clientUuid, purpose: "data_processing", granted: true, createdAt: new Date().toISOString() })
    });
  }
  await patientOutbox.registrations.add({
    clientUuid: operation.clientUuid,
    ownerId,
    createdAt: new Date().toISOString(),
    provisionalToken,
    encryptedDraft: await encryptLocalValue(draft),
    status: "pending",
  });
  window.dispatchEvent(new CustomEvent("aarogya-outbox-added"));
  return provisionalToken;
}

export async function queuePatientRecord(item: Omit<OfflineRecord, "id" | "ownerId" | "createdAt" | "status" | "progress">) {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) throw new Error("Sign in before saving data for offline sync.");
  const id = await patientOutbox.records.add({
    ownerId,
    createdAt: new Date().toISOString(),
    status: "saved-offline",
    progress: 0,
    encryptedData: await encryptLocalValue(item)
  });
  window.dispatchEvent(new CustomEvent("aarogya-outbox-added"));
  return id;
}

export async function readQueuedPatientRecords(patientId: string) {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) return [];
  const rows = await patientOutbox.records.where("ownerId").equals(ownerId).toArray();
  const matching: Array<OfflineRecord | null> = await Promise.all(rows.map(async (row): Promise<OfflineRecord | null> => {
    if (!row.encryptedData) return null;
    const data = await decryptLocalValue<Omit<OfflineRecord, "id" | "ownerId" | "createdAt" | "status" | "progress" | "error">>(row.encryptedData);
    if (data.patientId !== patientId) return null;
    return { ...data, ...(row.id ? { id: row.id } : {}), ownerId: row.ownerId, createdAt: row.createdAt, status: row.status, progress: row.progress, error: row.error };
  }));
  return matching.filter((item): item is OfflineRecord => item !== null);
}

export async function syncPatientRecords(patientId: string, onChange?: () => void) {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) return;
  const rows = await patientOutbox.records.where("ownerId").equals(ownerId).filter((item) => item.status !== "synced").toArray();
  for (const row of rows) {
    if (!row.id || !row.encryptedData) continue;
    const item = await decryptLocalValue<Omit<OfflineRecord, "id" | "ownerId" | "createdAt" | "status" | "progress" | "error">>(row.encryptedData);
    if (item.patientId !== patientId) continue;
    await patientOutbox.records.update(row.id, { status: "syncing", progress: 0, error: undefined });
    onChange?.();
    try {
      await uploadPatientRecord(patientId, item, (progress) => {
        void patientOutbox.records.update(row.id!, { progress });
        onChange?.();
      });
      await patientOutbox.records.delete(row.id);
    } catch {
      await patientOutbox.records.update(row.id, { status: "failed", error: "Upload failed; retry when connected." });
    }
    onChange?.();
  }
}

export async function migratePatientOutboxData(ownerId: string) {
  for (const item of await patientOutbox.registrations.toArray()) {
    if ((item.ownerId && item.ownerId !== ownerId) || !item.id) continue;
    if (item.encryptedDraft) continue;
    if (!item.draft) {
      await patientOutbox.registrations.update(item.id, { ownerId });
      continue;
    }
    const { draft, ...metadata } = item;
    await patientOutbox.registrations.put({ ...metadata, ownerId, encryptedDraft: await encryptLocalValue(draft) });
  }
  for (const item of await patientOutbox.records.toArray()) {
    if ((item.ownerId && item.ownerId !== ownerId) || !item.id) continue;
    if (item.encryptedData) continue;
    const legacy = item as unknown as OfflineRecord;
    const { id, ownerId: recordOwnerId, createdAt, status, progress, error, ...sensitive } = legacy;
    await patientOutbox.records.put({
      id,
      ownerId: recordOwnerId ?? ownerId,
      createdAt,
      status,
      progress,
      error,
      encryptedData: await encryptLocalValue(sensitive)
    });
  }
}

registerOfflineDataMigration(migratePatientOutboxData);

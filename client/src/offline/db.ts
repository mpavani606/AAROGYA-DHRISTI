import Dexie, { type Table } from "dexie";

export type SyncStatus = "saved_offline" | "pending_sync" | "syncing" | "synced" | "failed_retry";
export type OutboxOperation = {
  id?: number;
  clientUuid: string;
  ownerId: string;
  opType: string;
  payload: Record<string, unknown>;
  payloadEncrypted?: EncryptedLocalValue;
  retryCount: number;
  status: SyncStatus;
  createdAt: string;
  nextAttemptAt?: string;
  result?: Record<string, unknown>;
  resultEncrypted?: EncryptedLocalValue;
  error?: string;
};
export type EncryptedLocalValue = { iv: Uint8Array; ciphertext: ArrayBuffer };
export type EncryptedOfflineRecord = Record<string, unknown> & {
  clientUuid: string;
  ownerId: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
  serverId?: string;
  encryptedData?: EncryptedLocalValue;
};
export type LocalImage = {
  id?: number;
  clientUuid: string;
  ownerId: string;
  caseClientUuid: string;
  fileName: string;
  mimeType: string;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  chunkSize: number;
  uploadedChunks: number[];
  uploadId?: string;
  status: SyncStatus;
  createdAt: string;
  syncedAt?: string;
  retryCount: number;
  nextAttemptAt?: string;
};

class AarogyaOfflineDb extends Dexie {
  patients!: Table<Record<string, unknown>, string>;
  consents!: Table<Record<string, unknown>, string>;
  habits!: Table<Record<string, unknown>, string>;
  symptoms!: Table<Record<string, unknown>, string>;
  cases!: Table<Record<string, unknown>, string>;
  caseImages!: Table<LocalImage, number>;
  outbox!: Table<OutboxOperation, number>;
  serverUpdates!: Table<{ key: string; value?: unknown; encryptedValue?: EncryptedLocalValue; updatedAt: string }, string>;

  constructor() {
    super("aarogya-drishti-offline");
    this.version(1).stores({
      patients: "clientUuid, patientCode, updatedAt",
      consents: "clientUuid, patientId, createdAt",
      habits: "clientUuid, patientId, createdAt",
      symptoms: "clientUuid, patientId, createdAt",
      cases: "clientUuid, serverId, status, updatedAt",
      caseImages: "++id, clientUuid, caseClientUuid, status, createdAt, syncedAt",
      outbox: "++id, &clientUuid, opType, status, createdAt, nextAttemptAt"
    });
    this.version(2).stores({
      patients: "clientUuid, patientCode, updatedAt",
      consents: "clientUuid, patientId, createdAt",
      habits: "clientUuid, patientId, createdAt",
      symptoms: "clientUuid, patientId, createdAt",
      cases: "clientUuid, serverId, status, updatedAt",
      caseImages: "++id, clientUuid, caseClientUuid, status, createdAt, syncedAt",
      outbox: "++id, &clientUuid, opType, status, createdAt, nextAttemptAt",
      serverUpdates: "&key, updatedAt"
    });
    this.version(4).stores({
      patients: "clientUuid, patientCode, updatedAt, ownerId",
      consents: "clientUuid, patientId, createdAt, ownerId",
      habits: "clientUuid, patientId, createdAt, ownerId",
      symptoms: "clientUuid, patientId, createdAt, ownerId",
      cases: "clientUuid, serverId, status, updatedAt, ownerId",
      caseImages: "++id, clientUuid, caseClientUuid, status, createdAt, syncedAt, ownerId",
      outbox: "++id, &clientUuid, opType, status, createdAt, nextAttemptAt, ownerId",
      serverUpdates: "&key, updatedAt"
    });
    this.version(3).stores({
      patients: "clientUuid, patientCode, updatedAt, ownerId",
      consents: "clientUuid, patientId, createdAt, ownerId",
      habits: "clientUuid, patientId, createdAt, ownerId",
      symptoms: "clientUuid, patientId, createdAt, ownerId",
      cases: "clientUuid, serverId, status, updatedAt, ownerId",
      caseImages: "++id, clientUuid, caseClientUuid, status, createdAt, syncedAt, ownerId",
      outbox: "++id, &clientUuid, opType, status, createdAt, nextAttemptAt, ownerId",
      serverUpdates: "&key, updatedAt"
    });
  }
}

export const offlineDb = new AarogyaOfflineDb();

function uuid() {
  return crypto.randomUUID();
}
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function enqueueOperation(opType: string, payload: Record<string, unknown>, clientUuid: string = uuid()) {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) throw new Error("Sign in before saving data for offline sync.");
  const existing = await offlineDb.outbox.where("clientUuid").equals(clientUuid).first();
  if (existing) {
    if (existing.ownerId !== ownerId) throw new Error("This offline item belongs to a different account.");
    return existing;
  }
  const payloadEncrypted = await encryptLocalValue(payload);
  const item: OutboxOperation = { clientUuid, ownerId, opType, payload: {}, payloadEncrypted, retryCount: 0, status: "saved_offline", createdAt: new Date().toISOString() };
  await offlineDb.outbox.add(item);
  window.dispatchEvent(new CustomEvent("aarogya-outbox-added"));
  return item;
}

export async function pendingCount(ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "") {
  if (!ownerId) return 0;
  const [operations, images] = await Promise.all([
    offlineDb.outbox.where("ownerId").equals(ownerId).and((item) => ["saved_offline", "pending_sync", "failed_retry"].includes(item.status)).count(),
    offlineDb.caseImages.where("ownerId").equals(ownerId).and((item) => ["saved_offline", "pending_sync", "failed_retry"].includes(item.status)).count()
  ]);
  return operations + images;
}

let activeKey: CryptoKey | null = null;
let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
let migrateAdditionalOfflineData: ((ownerId: string) => Promise<void>) | undefined;

export function registerOfflineDataMigration(migrate: (ownerId: string) => Promise<void>) {
  migrateAdditionalOfflineData = migrate;
}

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => { activeKey = null; window.dispatchEvent(new CustomEvent("aarogya-pin-lock")); }, 5 * 60 * 1000);
}
export function keepOfflineDataUnlocked() {
  if (activeKey) resetInactivityTimer();
}
export function isOfflineDataUnlocked() {
  return activeKey !== null;
}

async function deriveKey(pin: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: asArrayBuffer(salt), iterations: 250_000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function unlockOfflineData(pin: string) {
  if (!/^\d{4,12}$/.test(pin)) throw new Error("PIN must contain 4 to 12 digits.");
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) throw new Error("Sign in to unlock offline data.");
  const saltKey = `aarogya-offline-pin-salt-${ownerId}`;
  const verifierKey = `aarogya-offline-pin-check-${ownerId}`;
  let saltText = localStorage.getItem(saltKey);
  if (!saltText) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltText = btoa(String.fromCharCode(...salt));
    localStorage.setItem(saltKey, saltText);
  }
  const salt = Uint8Array.from(atob(saltText), (character) => character.charCodeAt(0));
  const key = await deriveKey(pin, salt);
  const verifier = localStorage.getItem(verifierKey);
  if (verifier) {
    const [ivText, cipherText] = verifier.split(".");
    try {
      const iv = Uint8Array.from(atob(ivText), (character) => character.charCodeAt(0));
      const ciphertext = Uint8Array.from(atob(cipherText), (character) => character.charCodeAt(0));
      const result = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, asArrayBuffer(ciphertext));
      if (new TextDecoder().decode(result) !== "aarogya-local-key") throw new Error("PIN is incorrect.");
    } catch { throw new Error("PIN is incorrect."); }
  } else {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, new TextEncoder().encode("aarogya-local-key"));
    localStorage.setItem(verifierKey, `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(ciphertext)))}`);
  }
  activeKey = key;
  resetInactivityTimer();
  try {
    await migrateLegacyOfflineData(ownerId);
    await migrateAdditionalOfflineData?.(ownerId);
  } catch (error) {
    lockOfflineData();
    throw error;
  }
  window.dispatchEvent(new CustomEvent("aarogya-pin-unlock"));
}

export function lockOfflineData() {
  activeKey = null;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  window.dispatchEvent(new CustomEvent("aarogya-pin-lock"));
}

async function requireKey() {
  if (!activeKey) throw new Error("Set or unlock your offline PIN before storing or synchronizing patient data.");
  resetInactivityTimer();
  return activeKey;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function serializeBlobs(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    return { __aarogyaBlob: true, type: value.type, data: encodeBase64(new Uint8Array(await value.arrayBuffer())) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(serializeBlobs));
  if (value && typeof value === "object") {
    const entries = await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await serializeBlobs(entry)] as const));
    return Object.fromEntries(entries);
  }
  return value;
}

function restoreBlobs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreBlobs);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.__aarogyaBlob === true && typeof record.type === "string" && typeof record.data === "string") {
      return new Blob([asArrayBuffer(decodeBase64(record.data))], { type: record.type });
    }
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, restoreBlobs(entry)]));
  }
  return value;
}

export async function encryptLocalValue(value: unknown): Promise<EncryptedLocalValue> {
  const key = await requireKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const serialized = await serializeBlobs(value);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, new TextEncoder().encode(JSON.stringify(serialized)));
  return { iv, ciphertext };
}

export async function decryptLocalValue<T>(encrypted: EncryptedLocalValue): Promise<T> {
  const key = await requireKey();
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(encrypted.iv) }, key, encrypted.ciphertext);
  return restoreBlobs(JSON.parse(new TextDecoder().decode(plaintext))) as T;
}

export async function encryptLocalText(value: string) {
  const encrypted = await encryptLocalValue(value);
  return JSON.stringify({ iv: encodeBase64(encrypted.iv), ciphertext: encodeBase64(new Uint8Array(encrypted.ciphertext)) });
}

function isSerializedCipher(value: unknown): value is { iv: string; ciphertext: string } {
  return Boolean(value && typeof value === "object" && "iv" in value && "ciphertext" in value
    && typeof (value as { iv?: unknown }).iv === "string" && typeof (value as { ciphertext?: unknown }).ciphertext === "string");
}

export async function readEncryptedLocalText(value: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("This local draft is not encrypted. Unlock your offline data to migrate it safely."); }
  if (!isSerializedCipher(parsed)) throw new Error("This local draft is not encrypted. Unlock your offline data to migrate it safely.");
  return decryptLocalValue<string>({ iv: decodeBase64(parsed.iv), ciphertext: asArrayBuffer(decodeBase64(parsed.ciphertext)) });
}

export async function putEncryptedRecord(table: Table<Record<string, unknown>, string>, record: Record<string, unknown>) {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) throw new Error("Sign in before saving data for offline sync.");
  const metadataKeys = ["clientUuid", "ownerId", "status", "updatedAt", "createdAt", "serverId"];
  const metadata = Object.fromEntries(metadataKeys.flatMap((key) => key in record ? [[key, record[key]]] : []));
  const sensitive = Object.fromEntries(Object.entries(record).filter(([key]) => !metadataKeys.includes(key)));
  await table.put({ ...metadata, ownerId, encryptedData: await encryptLocalValue(sensitive) });
}

async function migrateTable(table: Table<Record<string, unknown>, string>, ownerId: string) {
  const rows = await table.toArray();
  for (const row of rows) {
    if ((row.ownerId && row.ownerId !== ownerId) || row.encryptedData) continue;
    await putEncryptedRecord(table, { ...row, ownerId });
  }
}

async function migrateLegacyOfflineData(ownerId: string) {
  for (const table of [offlineDb.patients, offlineDb.consents, offlineDb.habits, offlineDb.symptoms, offlineDb.cases]) {
    await migrateTable(table, ownerId);
  }
  for (const item of await offlineDb.outbox.toArray()) {
    if (item.ownerId && item.ownerId !== ownerId) continue;
    const changes: Partial<OutboxOperation> = {};
    if (!item.payloadEncrypted) {
      changes.payloadEncrypted = await encryptLocalValue(item.payload ?? {});
      changes.payload = {};
    }
    if (item.result && !item.resultEncrypted) {
      changes.resultEncrypted = await encryptLocalValue(item.result);
      changes.result = undefined;
    }
    if (item.id && Object.keys(changes).length) await offlineDb.outbox.update(item.id, { ...changes, ownerId });
  }
  for (const item of await offlineDb.serverUpdates.toArray()) {
    if (!item.key.startsWith(`${ownerId}:`) || "encryptedValue" in item) continue;
    const { value, ...metadata } = item;
    await offlineDb.serverUpdates.put({ ...metadata, encryptedValue: await encryptLocalValue(value) } as typeof item);
  }
  const draftKey = `aarogya-case-draft-${ownerId}`;
  const legacyDraft = localStorage.getItem(draftKey);
  if (legacyDraft) {
    try {
      const parsed = JSON.parse(legacyDraft);
      if (!isSerializedCipher(parsed)) localStorage.setItem(draftKey, await encryptLocalText(legacyDraft));
    } catch (error) {
      if (error instanceof SyntaxError) localStorage.setItem(draftKey, await encryptLocalText(legacyDraft));
      else throw error;
    }
  }
}

export async function storeEncryptedImage(file: Blob, caseClientUuid: string, fileName: string) {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) throw new Error("Sign in before saving data for offline sync.");
  const existing = await offlineDb.caseImages.where("caseClientUuid").equals(caseClientUuid).filter((item) => item.ownerId === ownerId).first();
  if (existing) return existing.id!;
  const estimate = await navigator.storage?.estimate();
  if (estimate?.quota && estimate.usage && estimate.quota - estimate.usage < file.size * 2) throw new Error("Storage is nearly full. Sync or remove older offline items.");
  const key = await requireKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, await file.arrayBuffer());
  const imageId = await offlineDb.caseImages.add({ clientUuid: uuid(), ownerId, caseClientUuid, fileName, mimeType: file.type || "application/octet-stream", iv, ciphertext, chunkSize: 256 * 1024, uploadedChunks: [], status: "saved_offline", createdAt: new Date().toISOString(), retryCount: 0 });
  window.dispatchEvent(new CustomEvent("aarogya-outbox-added"));
  return imageId;
}

export async function decryptLocalImage(item: LocalImage) {
  const key = await requireKey();
  return new Blob([await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(item.iv) }, key, item.ciphertext)], { type: item.mimeType });
}

export async function purgeRetainedImages(ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "", now = Date.now()) {
  if (!ownerId) return;
  const cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  await offlineDb.caseImages.where("ownerId").equals(ownerId).filter((item) => item.status === "synced" && Boolean(item.syncedAt && item.syncedAt < cutoff)).delete();
}

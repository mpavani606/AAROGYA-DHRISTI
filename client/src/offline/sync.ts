import api from "../features/auth/api";
import { decryptLocalImage, decryptLocalValue, encryptLocalValue, lockOfflineData, offlineDb, pendingCount, purgeRetainedImages, type OutboxOperation } from "./db";
import { patientOutbox, syncPatientRecords as syncLegacyPatientRecords } from "../features/patient/offline";

const DEVICE_KEY = "aarogya-device-id";
const LAST_PULL_KEY = "aarogya-sync-pulled-at";
let running: Promise<void> | null = null;
let interval: ReturnType<typeof setInterval> | undefined;

export async function totalPendingCount() {
  if (!sessionStorage.getItem("aarogya-access-token")) return 0;
  const ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
  if (!ownerId) return 0;
  const [core, registrations, records] = await Promise.all([
    pendingCount(ownerId),
    patientOutbox.registrations.where("ownerId").equals(ownerId).and((item) => item.status === "pending").count(),
    patientOutbox.records.where("ownerId").equals(ownerId).and((item) => item.status !== "synced").count()
  ]);
  return core + registrations + records;
}

export function getDeviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, value); }
  return value;
}

export async function isConnected() {
  if (!navigator.onLine) return false;
  try { await api.get("/health", { timeout: 5000 }); return true; } catch { return false; }
}

function stableBatchId(items: OutboxOperation[]) {
  const attempt = Math.max(...items.map((item) => item.retryCount));
  return `batch-${items[0].clientUuid}-${items[items.length - 1].clientUuid}-${attempt}`;
}
function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  return btoa(binary);
}

async function syncOperations() {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) return;
  while (true) {
    const now = new Date().toISOString();
    const items = await offlineDb.outbox.where("ownerId").equals(ownerId).sortBy("createdAt").then((all) => all.filter((item) =>
      ["saved_offline", "pending_sync", "failed_retry"].includes(item.status)
      && (!item.nextAttemptAt || item.nextAttemptAt <= now)
    ).slice(0, 10));
    if (!items.length) break;
    await offlineDb.transaction("rw", offlineDb.outbox, async () => {
      await Promise.all(items.map((item) => item.id && offlineDb.outbox.update(item.id, { status: "syncing" })));
    });
    try {
      const operations = await Promise.all(items.map(async (item) => {
        if (!item.payloadEncrypted) throw new Error("An offline submission is not encrypted. Unlock your offline data to migrate it before syncing.");
        const payload = await decryptLocalValue<Record<string, unknown>>(item.payloadEncrypted);
        return { clientUuid: item.clientUuid, opType: item.opType, payload, deviceTime: item.createdAt };
      }));
      const { data } = await api.post("/sync/batch", { operations }, {
        headers: { "X-Device-Id": getDeviceId(), "Idempotency-Key": stableBatchId(items) }
      });
      for (const result of data.results as Array<{ clientUuid: string; status: string; entityId?: string; patientCode?: string; tokenNo?: string; conflictId?: string; code?: string }>) {
        const item = items.find((entry) => entry.clientUuid === result.clientUuid);
        if (!item?.id) continue;
        if (result.status === "synced") {
          await offlineDb.outbox.update(item.id, {
            status: "synced", payload: {}, payloadEncrypted: undefined, result: undefined,
            resultEncrypted: await encryptLocalValue(result), error: undefined
          });
          if (item.opType === "create_patient") await patientOutbox.registrations.where("clientUuid").equals(item.clientUuid).delete();
          if (item.opType === "create_case") {
            await offlineDb.cases.put({ clientUuid: item.clientUuid, ownerId, serverId: result.entityId, status: "synced", updatedAt: new Date().toISOString() });
            const draftKey = `aarogya-case-draft-${ownerId}`;
            const caseUuidKey = `aarogya-case-client-uuid-${ownerId}`;
            if (localStorage.getItem(caseUuidKey) === item.clientUuid) {
              localStorage.removeItem(draftKey);
              localStorage.removeItem(caseUuidKey);
            }
          }
        } else {
          const retryCount = item.retryCount + 1;
          await offlineDb.outbox.update(item.id, {
            status: "failed_retry",
            retryCount,
            nextAttemptAt: item.opType === "create_appointment_request"
              ? "2999-01-01T00:00:00.000Z"
              : new Date(Date.now() + Math.min(60 * 60 * 1000, 1000 * (2 ** Math.min(retryCount, 12)))).toISOString(),
            error: result.status === "conflict_review" ? `Conflict review ${result.conflictId}` : result.status === "failed" ? `Request rejected: ${result.code ?? "unknown error"}` : result.status
          });
        }
      }
    } catch (error) {
      for (const item of items) {
        if (!item.id) continue;
        const retryCount = item.retryCount + 1;
        await offlineDb.outbox.update(item.id, {
          status: "failed_retry",
          retryCount,
          nextAttemptAt: new Date(Date.now() + Math.min(60 * 60 * 1000, 1000 * (2 ** Math.min(retryCount, 12)))).toISOString(),
          error: error instanceof Error ? error.message : "Sync request failed"
        });
      }
      throw error;
    }
  }
}

async function syncImages() {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) return;
  const now = new Date().toISOString();
  const images = await offlineDb.caseImages.where("ownerId").equals(ownerId).filter((item) =>
    ["saved_offline", "pending_sync", "failed_retry"].includes(item.status) && (!item.nextAttemptAt || item.nextAttemptAt <= now)
  ).toArray();
  for (const item of images) {
    const caseRecord = await offlineDb.cases.get(item.caseClientUuid);
    if (caseRecord?.ownerId !== ownerId) continue;
    const serverCaseId = typeof caseRecord?.serverId === "string" ? caseRecord.serverId : item.caseClientUuid;
    if (serverCaseId === item.caseClientUuid) {
      await offlineDb.caseImages.update(item.id!, { status: "failed_retry" });
      continue;
    }
    try {
      const blob = await decryptLocalImage(item);
      const totalChunks = Math.ceil(blob.size / item.chunkSize);
      let uploadId = item.uploadId;
      if (!uploadId) {
        const { data } = await api.post("/sync/uploads", { uploadId: crypto.randomUUID(), caseId: serverCaseId, fileName: item.fileName, mimeType: item.mimeType, totalChunks }, { headers: { "X-Device-Id": getDeviceId() } });
        uploadId = data.uploadId as string;
        await offlineDb.caseImages.update(item.id!, { uploadId, status: "syncing" });
      }
      const { data: status } = await api.get(`/sync/uploads/${uploadId}`, { headers: { "X-Device-Id": getDeviceId() } });
      if (status.status === "complete") {
        await offlineDb.caseImages.delete(item.id!);
        continue;
      }
      const received = new Set<number>(status.received as number[]);
      for (let index = 0; index < totalChunks; index += 1) {
        if (received.has(index)) continue;
        const chunk = await blob.slice(index * item.chunkSize, Math.min(blob.size, (index + 1) * item.chunkSize)).arrayBuffer();
        const base64 = encodeBase64(new Uint8Array(chunk));
        const { data: result } = await api.put(`/sync/uploads/${uploadId}/chunks`, { index, data: base64 }, { headers: { "X-Device-Id": getDeviceId() } });
        if (result.complete) await offlineDb.caseImages.delete(item.id!);
        else await offlineDb.caseImages.update(item.id!, { uploadedChunks: result.received, status: "syncing" });
      }
      if (totalChunks === 0) await offlineDb.caseImages.delete(item.id!);
    } catch {
      const retryCount = item.retryCount + 1;
      await offlineDb.caseImages.update(item.id!, { status: "failed_retry", retryCount, nextAttemptAt: new Date(Date.now() + Math.min(60 * 60 * 1000, 1000 * (2 ** Math.min(retryCount, 12)))).toISOString() });
    }
  }
}

async function syncPatientRecords() {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) return;
  const rows = await patientOutbox.records.where("ownerId").equals(ownerId).toArray();
  const decrypted = await Promise.all(rows.flatMap((item) => item.encryptedData ? [decryptLocalValue<{ patientId: string }>(item.encryptedData)] : []));
  const patientIds = [...new Set(decrypted.map((item) => item.patientId))];
  for (const patientId of patientIds) {
    if (typeof patientId === "string") await syncPatientRecordsForPatient(patientId);
  }
}

async function syncPatientRecordsForPatient(patientId: string) {
  await syncLegacyPatientRecords(patientId, () => window.dispatchEvent(new CustomEvent("aarogya-sync-progress")));
}

async function pullUpdates() {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
  const pullKey = `${LAST_PULL_KEY}-${ownerId}`;
  const since = localStorage.getItem(pullKey) ?? new Date(0).toISOString();
  const { data } = await api.get("/sync/pull", { params: { since }, headers: { "X-Device-Id": getDeviceId() } });
  if (data.wipeLocalData) {
    await wipeCurrentUserData();
    return;
  }
  localStorage.setItem(pullKey, data.pulledAt ?? new Date().toISOString());
  const updatedAt = data.pulledAt ?? new Date().toISOString();
  const updateOwnerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
  await Promise.all(["assignments", "appointments", "recaptureRequests", "education"].map(async (key) =>
    offlineDb.serverUpdates.put({
      key: `${updateOwnerId}:${key}`,
      encryptedValue: await encryptLocalValue(data[key] ?? []),
      updatedAt
    })
  ));
  for (const item of data.recaptureRequests as Array<{ _id: string; status: string; updatedAt?: string }>) {
    await offlineDb.cases.put({ clientUuid: `${updateOwnerId}-server-${item._id}`, ownerId: updateOwnerId, serverId: item._id, status: item.status, updatedAt: item.updatedAt ?? updatedAt });
  }
  window.dispatchEvent(new CustomEvent("aarogya-sync-pulled", { detail: data }));
}

export async function syncNow() {
  if (running) return running;
  running = (async () => {
    if (!sessionStorage.getItem("aarogya-access-token")) throw new Error("Sign in again before syncing offline data.");
    if (!await isConnected()) throw new Error("No internet. Your data is saved.");
    const ownerId = localStorage.getItem("aarogya-offline-owner-id");
    if (!ownerId) throw new Error("Sign in again before syncing offline data.");
    await offlineDb.outbox.where("ownerId").equals(ownerId).and((item) => item.status === "syncing").modify({ status: "pending_sync" });
    await offlineDb.caseImages.where("ownerId").equals(ownerId).and((item) => item.status === "syncing").modify({ status: "pending_sync" });
    await syncOperations();
    await syncImages();
    await syncPatientRecords();
    await pullUpdates();
    await purgeRetainedImages(ownerId);
    window.dispatchEvent(new CustomEvent("aarogya-sync-complete"));
  })().catch(async (error: unknown) => {
    const body = (error as { response?: { data?: { error?: { wipeLocalData?: boolean } } } })?.response?.data;
    if (body?.error?.wipeLocalData) {
      await wipeCurrentUserData();
      sessionStorage.removeItem("aarogya-access-token");
      sessionStorage.removeItem("aarogya-auth-token");
      lockOfflineData();
    }
    throw error;
  }).finally(() => { running = null; });
  return running;
}

async function wipeCurrentUserData() {
  const ownerId = localStorage.getItem("aarogya-offline-owner-id");
  if (!ownerId) return;
  for (const table of [offlineDb.patients, offlineDb.consents, offlineDb.habits, offlineDb.symptoms, offlineDb.cases, offlineDb.caseImages, offlineDb.outbox]) {
    await table.where("ownerId").equals(ownerId).delete();
  }
  await offlineDb.serverUpdates.filter((item) => item.key.startsWith(`${ownerId}:`)).delete();
  await patientOutbox.registrations.where("ownerId").equals(ownerId).delete();
  await patientOutbox.records.where("ownerId").equals(ownerId).delete();
  for (const key of [`aarogya-case-draft-${ownerId}`, `aarogya-case-client-uuid-${ownerId}`, `${LAST_PULL_KEY}-${ownerId}`, `aarogya-offline-pin-salt-${ownerId}`, `aarogya-offline-pin-check-${ownerId}`]) localStorage.removeItem(key);
  lockOfflineData();
}

export function startAutomaticSync() {
  const trigger = () => { if (navigator.onLine && document.visibilityState === "visible") void syncNow().catch(() => undefined); };
  const pendingOnly = async () => { if (navigator.onLine && await totalPendingCount() > 0) void syncNow().catch(() => undefined); };
  window.addEventListener("online", trigger);
  window.addEventListener("aarogya-outbox-added", trigger);
  document.addEventListener("visibilitychange", trigger);
  interval = setInterval(() => { void pendingOnly(); }, 30_000);
  trigger();
  return () => {
    window.removeEventListener("online", trigger);
    window.removeEventListener("aarogya-outbox-added", trigger);
    document.removeEventListener("visibilitychange", trigger);
    if (interval) clearInterval(interval);
  };
}

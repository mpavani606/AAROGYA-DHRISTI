import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SimulationBanner } from "../../components/SimulationBanner";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { decryptLocalValue, offlineDb, type LocalImage, type OutboxOperation } from "../../offline/db";
import { syncNow } from "../../offline/sync";
export default function SyncCentre() {
  const [items, setItems] = useState<OutboxOperation[]>([]);
  const [images, setImages] = useState<LocalImage[]>([]);
  const [message, setMessage] = useState("");
  const reload = async () => {
    const ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
    const [operations, imageRows] = await Promise.all([offlineDb.outbox.where("ownerId").equals(ownerId).reverse().sortBy("createdAt"), offlineDb.caseImages.where("ownerId").equals(ownerId).reverse().sortBy("createdAt")]);
    const visibleOperations = await Promise.all(operations.map(async (item) => item.resultEncrypted
      ? { ...item, result: await decryptLocalValue<Record<string, unknown>>(item.resultEncrypted) }
      : item));
    setItems(visibleOperations); setImages(imageRows);
  };
  useEffect(() => {
    const refresh = () => { void reload().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unlock your offline PIN to view sync results.")); };
    refresh();
    window.addEventListener("aarogya-sync-complete", refresh);
    window.addEventListener("aarogya-pin-unlock", refresh);
    return () => { window.removeEventListener("aarogya-sync-complete", refresh); window.removeEventListener("aarogya-pin-unlock", refresh); };
  }, []);
  async function retry(item: OutboxOperation) {
    if (!item.id) return;
    await offlineDb.outbox.update(item.id, { status: "pending_sync", retryCount: item.retryCount + 1, nextAttemptAt: undefined, error: undefined });
    try { await syncNow(); setMessage("Sync finished / సమకాలీకరణ పూర్తయింది / सिंक पूरा हुआ"); } catch (error) { setMessage(error instanceof Error ? error.message : "Sync failed."); }
    await reload();
  }
  async function discard(item: OutboxOperation) {
    if (!item.id) return;
    await offlineDb.outbox.delete(item.id);
    await reload();
  }
  const group = (title: string, statuses: string[]) => <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">{title}</h2><div className="mt-3 grid gap-3">{items.filter((item) => statuses.includes(item.status)).map((item) => <article key={item.clientUuid} className="rounded-xl border p-4"><p className="font-bold">{item.opType} · {item.status}</p><p className="break-all text-xs text-slate-600">{item.clientUuid}</p>{typeof item.result?.patientCode === "string" && <p className="mt-2 font-semibold">Patient code: {item.result.patientCode}</p>}{typeof item.result?.entityId === "string" && <p className="break-all text-xs">Server ID: {item.result.entityId}</p>}{item.error && <p className="mt-2 text-sm text-red-700">{item.error}</p>}{item.status === "failed_retry" && <div className="mt-2 flex gap-2"><button className="min-h-touch rounded-lg border px-3 font-bold" type="button" onClick={() => void retry(item)}>Retry / మళ్లీ ప్రయత్నించండి / पुनः प्रयास करें</button>{item.opType === "create_appointment_request" && <button className="min-h-touch rounded-lg border px-3 font-bold" type="button" onClick={() => void discard(item)}>Remove</button>}</div>}</article>)}</div></section>;
  return <><SimulationBanner /><main className="mx-auto max-w-5xl px-4 pb-12 pt-24"><header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-bold">Sync Centre / సమకాలీకరణ కేంద్రం / सिंक केंद्र</h1><p className="mt-2 text-slate-700">Queued offline data syncs in order when the connection is available.</p></div><div className="flex gap-2"><LanguageSwitcher /><Link className="min-h-touch rounded-xl border px-4 py-3 font-bold" to="/home">Home</Link></div></header><button className="primary mt-6" type="button" onClick={() => void syncNow().then(() => { setMessage("Sync complete."); return reload(); }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Sync failed."))}>Sync now / ఇప్పుడే సమకాలీకరించండి / अभी सिंक करें</button>{message && <p className="mt-3 rounded-xl bg-amber-50 p-4" role="status">{message}</p>}<section className="mt-6 rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">Encrypted images / ఎన్‌క్రిప్ట్ చేసిన చిత్రాలు / एन्क्रिप्टेड चित्र</h2><div className="mt-3 grid gap-2">{images.map((image) => <div key={image.clientUuid} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><span>{image.fileName} · {image.status}</span>{image.status === "failed_retry" && <button className="min-h-touch rounded-lg border px-3 font-bold" type="button" onClick={() => { void offlineDb.caseImages.update(image.id!, { status: "pending_sync", nextAttemptAt: undefined }).then(syncNow).then(reload); }}>Retry / మళ్లీ ప్రయత్నించండి / पुनः प्रयास करें</button>}</div>)}{images.length === 0 && <p className="text-slate-600">No image uploads queued.</p>}</div></section><div className="mt-6 grid gap-4 md:grid-cols-3">{group("Pending / పెండింగ్ / लंबित", ["saved_offline", "pending_sync", "syncing"])}{group("Synced / సమకాలీకరించబడింది / सिंक", ["synced"])}{group("Failed / విఫలమైంది / विफल", ["failed_retry"])}</div></main></>;
}

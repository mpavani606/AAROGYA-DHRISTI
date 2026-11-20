import { useEffect, useState } from "react";
import { totalPendingCount } from "../offline/sync";
export function SyncStatusChip() {
  const [count, setCount] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const refresh = () => { void totalPendingCount().then(setCount); setOnline(navigator.onLine); };
    window.addEventListener("online", refresh); window.addEventListener("offline", refresh); window.addEventListener("aarogya-sync-complete", refresh); window.addEventListener("aarogya-sync-pulled", refresh); window.addEventListener("aarogya-outbox-added", refresh); window.addEventListener("aarogya-sync-progress", refresh);
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); window.removeEventListener("aarogya-sync-complete", refresh); window.removeEventListener("aarogya-sync-pulled", refresh); window.removeEventListener("aarogya-outbox-added", refresh); window.removeEventListener("aarogya-sync-progress", refresh); clearInterval(timer); };
  }, []);
  const text = online ? `${count ? `${count} pending` : "Synced"} / ${count ? "పెండింగ్" : "సమకాలీకరించబడింది"} / ${count ? "लंबित" : "सिंक किया गया"}` : "No internet. Your data is saved. / ఇంటర్నెట్ లేదు. డేటా సేవ్ అయింది. / इंटरनेट नहीं। डेटा सहेजा गया।";
  return <div className="fixed bottom-3 left-3 z-40 max-w-[calc(100%-1.5rem)] rounded-full border border-medical-800 bg-white px-4 py-2 text-sm font-bold text-medical-900 shadow-lg" role="status">{text}</div>;
}

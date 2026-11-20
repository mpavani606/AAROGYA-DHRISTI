import { useEffect, useState } from "react";
import { keepOfflineDataUnlocked, lockOfflineData, unlockOfflineData } from "../offline/db";
import { useAuth } from "../features/auth/AuthProvider";
export function PinLock() {
  const { user, loading } = useAuth();
  const ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
  const [configured, setConfigured] = useState(Boolean(ownerId && localStorage.getItem(`aarogya-offline-pin-salt-${ownerId}`)));
  const [locked, setLocked] = useState(configured);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const lock = () => setLocked(true);
    const unlock = () => { setConfigured(true); setLocked(false); setPin(""); setMessage(""); };
    const openSetup = () => { setPin(""); setMessage(""); setLocked(true); };
    const activity = () => keepOfflineDataUnlocked();
    const ownerChanged = () => {
      const currentOwner = localStorage.getItem("aarogya-offline-owner-id") ?? "";
      const hasPin = Boolean(currentOwner && localStorage.getItem(`aarogya-offline-pin-salt-${currentOwner}`));
      setConfigured(hasPin); setLocked(hasPin); setPin(""); setMessage("");
    };
    window.addEventListener("aarogya-pin-lock", lock); window.addEventListener("aarogya-pin-unlock", unlock);
    window.addEventListener("aarogya-open-pin-setup", openSetup);
    window.addEventListener("aarogya-offline-owner-changed", ownerChanged);
    window.addEventListener("pointerdown", activity); window.addEventListener("keydown", activity); window.addEventListener("touchstart", activity);
    return () => { window.removeEventListener("aarogya-pin-lock", lock); window.removeEventListener("aarogya-pin-unlock", unlock); window.removeEventListener("aarogya-open-pin-setup", openSetup); window.removeEventListener("aarogya-offline-owner-changed", ownerChanged); window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity); window.removeEventListener("touchstart", activity); };
  }, []);
  if (loading || !user) return null;
  if (!locked && !configured) return <button type="button" className="fixed bottom-20 left-3 z-40 min-h-touch rounded-full bg-white px-4 font-bold shadow" onClick={() => setLocked(true)}>Set offline PIN</button>;
  if (!locked) return <button type="button" className="fixed bottom-20 left-3 z-40 min-h-touch rounded-full bg-white px-4 font-bold shadow" onClick={() => { lockOfflineData(); setLocked(true); }}>Lock data</button>;
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-5"><form className="w-full max-w-sm rounded-2xl bg-white p-6" onSubmit={(event) => { event.preventDefault(); void unlockOfflineData(pin).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to unlock.")); }}><h2 className="text-2xl font-bold">Offline data PIN / ఆఫ్‌లైన్ పిన్ / ऑफलाइन पिन</h2><p className="mt-2 text-slate-700">This PIN encrypts locally stored patient, screening, and image data. It is never uploaded. / ఈ పిన్ స్థానికంగా నిల్వ చేసిన రోగి, స్క్రీనింగ్ మరియు చిత్రాల డేటాను గుప్తీకరిస్తుంది. ఇది అప్‌లోడ్ చేయబడదు. / यह पिन स्थानीय रूप से संग्रहीत रोगी, स्क्रीनिंग और छवि डेटा को एन्क्रिप्ट करता है। इसे अपलोड नहीं किया जाता।</p><label className="mt-4 block font-bold" htmlFor="offline-pin">PIN</label><input id="offline-pin" className="field mt-2" autoComplete="off" inputMode="numeric" pattern="[0-9]{4,12}" type="password" value={pin} onChange={(event) => setPin(event.target.value)} required /><button className="primary mt-4 w-full" type="submit">{configured ? "Unlock / తెరవండి / खोलें" : "Set PIN / పిన్ సెట్ / पिन सेट करें"}</button>{message && <p className="mt-3 text-red-700" role="alert">{message}</p>}</form></div>;
}

import { useEffect, useState } from "react";
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  if (!installEvent) return null;
  return <button type="button" className="fixed right-3 top-14 z-40 min-h-touch rounded-xl bg-medical-700 px-4 font-bold text-white shadow" onClick={() => { void installEvent.prompt().then(() => installEvent.userChoice).finally(() => setInstallEvent(null)); }}>Install app / యాప్ ఇన్‌స్టాల్ / ऐप इंस्टॉल</button>;
}

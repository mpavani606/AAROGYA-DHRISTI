import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SimulationBanner } from "../../components/SimulationBanner";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import api from "../auth/api";
export default function LocationConsent() {
  const [params] = useSearchParams(); const [message, setMessage] = useState("");
  async function share() { try { const token = params.get("token"); const patientId = params.get("patientId"); if (!token || !patientId) throw new Error("Missing consent link."); const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject)); await api.post("/location/share", { token, patientId, lat: position.coords.latitude, lng: position.coords.longitude, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }); setMessage("Location shared with consent / సమ్మతితో స్థానం పంచబడింది / ubicación compartida con consentimiento"); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to share location."); } }
  return <><SimulationBanner /><main className="mx-auto max-w-xl px-4 pt-24"><header className="flex justify-between"><h1 className="text-3xl font-bold">Location consent / స్థాన సమ్మతి / स्थान सहमति</h1><LanguageSwitcher /></header><p className="mt-6 rounded-xl bg-white p-5">Only share your location for this care purpose. It expires automatically. Live tracking from a phone number alone is not possible or lawful.</p><button className="primary mt-5 w-full" type="button" onClick={() => void share()}>Share one-time location / ఒకసారి స్థానం / एक बार स्थान साझा करें</button>{message && <p className="mt-4 rounded-xl bg-amber-50 p-4" role="status">{message}</p>}</main></>;
}

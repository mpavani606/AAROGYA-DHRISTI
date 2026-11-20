import { Link, useNavigate } from "react-router-dom";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { useAuth } from "../auth/AuthProvider";

export default function DashboardShell({ title, description }: { title: string; description: string }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return <><SimulationBanner /><main className="mx-auto max-w-4xl px-4 pb-10 pt-24"><header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">{title}</h1><p className="mt-2 text-slate-700">{description}</p></div><div className="flex items-center gap-2"><LanguageSwitcher /><button className="rounded-lg border px-3" type="button" onClick={async () => { try { await logout(); } finally { navigate(user?.role === "patient" ? "/patient/login" : "/login"); } }}>Logout</button></div></header>  <section className="mt-8 rounded-2xl bg-white p-6"><p className="font-semibold">{user?.name}</p><p className="text-slate-600">{user?.role}{user?.subRole ? ` · ${user.subRole}` : ""}</p>
    {user?.role === "doctor" && <Link className="primary mt-6 inline-flex" to="/doctor/cases">Open case check</Link>}
  </section></main></>;
}

import { useEffect, useState } from "react";
import { SimulationBanner } from "../../components/SimulationBanner";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import api from "../auth/api";
type Task = { _id: string; type: string; status: string; riskPoints: number; riskBand?: string; dueAt: string };
export default function NavigatorBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => { void api.get("/navigator/tasks").then(({ data }) => setTasks(data.tasks)); }, []);
  const columns = ["open", "in_progress", "done"];
  return <><SimulationBanner /><main className="mx-auto max-w-6xl px-4 pb-10 pt-24"><header className="flex justify-between gap-4"><div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">Navigator board / నావిగేటర్ బోర్డు / नेविगेटर बोर्ड</h1></div><LanguageSwitcher /></header><div className="mt-8 grid gap-4 md:grid-cols-3">{columns.map((status) => <section key={status} className="rounded-2xl bg-slate-100 p-4"><h2 className="font-bold">{status}</h2><div className="mt-3 grid gap-3">{tasks.filter((task) => task.status === status).map((task) => <article key={task._id} className="rounded-xl bg-white p-4 shadow-sm"><p className="font-bold">{task.type}</p><p className="text-sm">Risk points: {task.riskPoints} · {task.riskBand ?? "Low"}</p><p className="text-sm text-slate-600">{new Date(task.dueAt).toLocaleString()}</p></article>)}</div></section>)}</div></main></>;
}

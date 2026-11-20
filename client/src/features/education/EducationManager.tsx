import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import api from "../auth/api";
import { SimulationBanner } from "../../components/SimulationBanner";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import type { EducationPage } from "./educationApi";

const fields = [
  ["title_en", "English title"], ["title_te", "Telugu title"], ["title_hi", "Hindi title"],
  ["body_en", "English text"], ["body_te", "Telugu text"], ["body_hi", "Hindi text"]
] as const;
type Draft = Record<(typeof fields)[number][0], string> & { slug: string };
const emptyDraft: Draft = { slug: "", title_en: "", title_te: "", title_hi: "", body_en: "", body_te: "", body_hi: "" };

export default function EducationManager() {
  const [pages, setPages] = useState<EducationPage[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const { data } = await api.get<{ pages: EducationPage[] }>("/education/manage/pages");
    setPages(data.pages);
  }, []);
  useEffect(() => { void load().catch(() => setMessage("Could not load content manager.")); }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (editingId) {
        const fieldsToUpdate = {
          title_en: draft.title_en, title_te: draft.title_te, title_hi: draft.title_hi,
          body_en: draft.body_en, body_te: draft.body_te, body_hi: draft.body_hi
        };
        await api.patch(`/education/manage/pages/${editingId}`, fieldsToUpdate);
        setMessage("Draft updated.");
      } else {
        await api.post("/education/manage/pages", draft);
        setMessage("Draft created.");
      }
      setDraft(emptyDraft); setEditingId(null); await load();
    } catch { setMessage("Draft could not be saved. Check all three language fields."); }
  }
  async function transition(page: EducationPage, action: "review" | "publish") {
    if (!page._id) return;
    try {
      await api.post(`/education/manage/pages/${page._id}/${action}`, { confirmed: true });
      setMessage(`Page ${action === "review" ? "reviewed" : "published"}.`); await load();
    } catch { setMessage(`Page could not be ${action === "review" ? "reviewed" : "published"}.`); }
  }
  return <><SimulationBanner /><main className="mx-auto max-w-5xl px-4 pb-12 pt-24">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><Link to="/education" className="min-h-touch inline-flex items-center font-bold">← Education</Link><h1 className="mt-2 text-3xl font-bold">Education content manager</h1><p className="mt-2">Doctor-only draft → reviewed → published workflow.</p></div><LanguageSwitcher /></header>
    {message && <p className="mt-4 rounded-xl bg-amber-50 p-4" role="status">{message}</p>}
    <form className="mt-6 grid gap-4 rounded-2xl bg-white p-5 shadow-sm" onSubmit={(event) => void submit(event)}>
      <h2 className="text-xl font-bold">{editingId ? "Edit draft" : "Create education draft"}</h2>
      <label className="grid gap-2 font-semibold">Slug<input className="min-h-touch rounded-lg border px-3" required pattern="[a-z0-9-]+" disabled={Boolean(editingId)} value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label>
      {fields.map(([name, label]) => <label className="grid gap-2 font-semibold" key={name}>{label}{name.startsWith("title")
        ? <input className="min-h-touch rounded-lg border px-3" required value={draft[name]} onChange={(event) => setDraft({ ...draft, [name]: event.target.value })} />
        : <textarea className="min-h-32 rounded-lg border p-3" required value={draft[name]} onChange={(event) => setDraft({ ...draft, [name]: event.target.value })} />}</label>)}
      <div className="flex flex-wrap gap-3"><button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white" type="submit">{editingId ? "Update draft" : "Save draft"}</button>{editingId && <button className="min-h-touch rounded-xl border px-5 font-bold" type="button" onClick={() => { setEditingId(null); setDraft(emptyDraft); }}>Cancel edit</button>}</div>
    </form>
    <section className="mt-8 grid gap-4" aria-label="Education workflow">
      {pages.map((page) => <article key={page._id ?? page.slug} className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">{page.title_en}</h2><p className="text-sm text-slate-600">{page.slug} · {page.status}</p></div><p className="font-semibold">{page.status === "draft" ? "Needs doctor review" : page.status === "reviewed" ? "Ready to publish" : "Published"}</p></div>
        <div className="mt-3 flex flex-wrap gap-3">
          {page.status === "draft" && page._id && <button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={() => {
            setEditingId(page._id ?? null);
            setDraft({ slug: page.slug, title_en: page.title_en ?? "", title_te: page.title_te ?? "", title_hi: page.title_hi ?? "", body_en: page.body_en ?? "", body_te: page.body_te ?? "", body_hi: page.body_hi ?? "" });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}>Edit draft</button>}
          {page.status === "draft" && <button className="min-h-touch rounded-xl border border-medical-700 px-4 font-bold" type="button" onClick={() => void transition(page, "review")}>Mark reviewed</button>}
          {page.status === "reviewed" && <button className="min-h-touch rounded-xl bg-medical-700 px-4 font-bold text-white" type="button" onClick={() => void transition(page, "publish")}>Publish</button>}
        </div>
      </article>)}
    </section>
  </main></>;
}

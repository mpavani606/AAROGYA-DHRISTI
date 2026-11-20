import api from "../auth/api";

export type Language = "en" | "te" | "hi";
export type EducationPage = {
  _id?: string;
  slug: string;
  title: string;
  body: string;
  title_en?: string;
  title_te?: string;
  title_hi?: string;
  body_en?: string;
  body_te?: string;
  body_hi?: string;
  status: "draft" | "reviewed" | "published";
  audioRef_en?: string;
  audioRef_te?: string;
  audioRef_hi?: string;
  reviewedAt?: string;
  reviewedBy?: { name?: string } | string;
  audioRef?: string;
};
export type Catalog = {
  pages: Array<{ slug: string; title: Record<Language, string>; body: Record<Language, string> }>;
  foods: Array<{ id: string; name: Record<Language, string>; category: string }>;
  softFoodTip: Record<Language, string>;
};

export function currentLanguage(language: string): Language {
  const code = language.split("-")[0];
  return code === "te" || code === "hi" ? code : "en";
}

export async function getCatalog(): Promise<Catalog> {
  const response = await fetch("/education/catalog.json");
  if (!response.ok) throw new Error("Offline education content could not be loaded.");
  return response.json() as Promise<Catalog>;
}

export async function loadPages(language: Language): Promise<EducationPage[]> {
  try {
    const { data } = await api.get<{ pages: EducationPage[] }>("/education/pages", { params: { language } });
    return data.pages;
  } catch {
    const catalog = await getCatalog();
    return catalog.pages.map((page) => ({ slug: page.slug, title: page.title[language], body: page.body[language], status: "draft" }));
  }
}

export async function loadPage(slug: string, language: Language): Promise<EducationPage> {
  try {
    const { data } = await api.get<{ page: EducationPage }>(`/education/pages/${encodeURIComponent(slug)}`, { params: { language } });
    return data.page;
  } catch {
    const catalog = await getCatalog();
    const page = catalog.pages.find((item) => item.slug === slug);
    if (!page) throw new Error("This education page is not available.");
    return { slug, title: page.title[language], body: page.body[language], status: "draft" };
  }
}

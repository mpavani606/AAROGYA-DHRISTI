import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

export const apiBaseUrl = new URL(
  import.meta.env.VITE_API_URL ?? "/api/v1",
  window.location.origin
).toString().replace(/\/+$/, "");

const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: { "Content-Type": "application/json" }
});

let refreshing: Promise<unknown> | null = null;

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = sessionStorage.getItem("aarogya-access-token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (typeof FormData !== "undefined" && config.data instanceof FormData) config.headers.delete("Content-Type");
  return config;
});

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config;
  if (error.response?.status !== 401 || !original || original.url?.includes("/auth/")) throw error;
  refreshing ??= api.post("/auth/refresh").then(({ data }) => {
    if (data.accessToken) sessionStorage.setItem("aarogya-access-token", data.accessToken);
  }).finally(() => { refreshing = null; });
  await refreshing;
  return api(original);
});

export function getApiMessage(error: unknown, fallback: string) {
  if (error instanceof AxiosError) {
    const body = error.response?.data as { error?: { message_en?: string } } | undefined;
    return body?.error?.message_en ?? fallback;
  }
  return navigator.onLine ? fallback : "No internet connection";
}

export default api;

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import api from "./api";
import { lockOfflineData } from "../../offline/db";

export type UserRole = "patient" | "doctor" | "hospital_manager" | "district_admin" | "system_admin" | "asha_worker";
const activeRoles: UserRole[] = ["patient", "doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"];
export type AuthUser = { id: string; name: string; email?: string; phone?: string; role: UserRole; subRole?: string; hospitalId?: string; language?: "te" | "en" | "hi"; assignments?: Array<{ mandal?: string; phc?: string; village?: string }> };
type AuthContextValue = { user: AuthUser | null; loading: boolean; setSession: (token: string, user: AuthUser) => void; logout: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeUser(value: Record<string, unknown>): AuthUser {
  const rawId = value.id ?? value._id;
  const id = typeof rawId === "string" ? rawId : rawId && typeof rawId === "object" && "toString" in rawId ? rawId.toString() : "";
  if (!id || typeof value.name !== "string" || typeof value.role !== "string" || !activeRoles.includes(value.role as UserRole)) {
    throw new Error("The authenticated user response is incomplete.");
  }
  return { ...value, id, role: value.role as UserRole } as AuthUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem("aarogya-access-token");
    if (!token) { setLoading(false); return; }
    api.get("/users/me").then(({ data }) => {
      const current = normalizeUser(data.user ?? data);
      if (localStorage.getItem("aarogya-offline-owner-id") !== current.id) lockOfflineData();
      localStorage.setItem("aarogya-offline-owner-id", current.id);
      window.dispatchEvent(new CustomEvent("aarogya-offline-owner-changed"));
      setUser(current);
    }).catch(() => {
      sessionStorage.removeItem("aarogya-access-token");
      sessionStorage.removeItem("aarogya-auth-token");
    }).finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    setSession: (token, nextUser) => {
      const current = normalizeUser(nextUser);
      if (localStorage.getItem("aarogya-offline-owner-id") !== current.id) lockOfflineData();
      sessionStorage.setItem("aarogya-access-token", token);
      sessionStorage.setItem("aarogya-auth-token", token);
      localStorage.setItem("aarogya-offline-owner-id", current.id);
      window.dispatchEvent(new CustomEvent("aarogya-offline-owner-changed"));
      setUser(current);
    },
    logout: async () => {
      try { await api.post("/auth/logout"); } finally {
        lockOfflineData();
        sessionStorage.removeItem("aarogya-access-token");
        sessionStorage.removeItem("aarogya-auth-token");
        setUser(null);
      }
    }
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

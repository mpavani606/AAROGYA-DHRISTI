import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { UserRole } from "./AuthProvider";
import { useAuth } from "./AuthProvider";

export function ProtectedRoute({ roles }: { roles?: UserRole[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8">Loading...</div>;
  if (!user) {
    const loginPath = roles?.length === 1 && roles[0] === "doctor"
      ? "/doctor/login"
      : roles?.includes("patient")
      ? "/patient/login"
      : location.pathname.startsWith("/hospital-manager") ? "/login?role=hospital_manager"
      : location.pathname.startsWith("/asha") ? "/login?role=asha_worker"
      : location.pathname.startsWith("/admin") ? "/login?role=district_admin" : "/login";
    return <Navigate to={loginPath} replace state={{ from: location }} />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate to="/home" replace />;
  return <Outlet />;
}

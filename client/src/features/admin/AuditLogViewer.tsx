import { useEffect, useState } from "react";
import api from "../auth/api";
export default function AuditLogViewer() {
  const [logs, setLogs] = useState<{ _id: string; action: string; resource?: string; createdAt: string }[]>([]);
  useEffect(() => { void api.get("/admin/audit-logs").then(({ data }) => setLogs(data.logs ?? [])); }, []);
  return <section className="mx-auto max-w-5xl px-4 pb-10 pt-24"><h1 className="text-3xl font-bold">Audit logs</h1><div className="mt-6 overflow-auto rounded-2xl bg-white shadow-sm"><table className="w-full text-left"><thead><tr className="border-b"><th className="p-4">Action</th><th className="p-4">Resource</th><th className="p-4">Time</th></tr></thead><tbody>{logs.map((log) => <tr className="border-b" key={log._id}><td className="p-4">{log.action}</td><td className="p-4">{log.resource ?? "—"}</td><td className="p-4">{new Date(log.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></section>;
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { forwardToFastApi } from "@/lib/fastapi-bridge";

export default async function AdminPage() {
  const session = (await cookies()).get("phigrad_session")?.value;
  if (!session) redirect("/login?next=/admin");
  const response = await forwardToFastApi("/auth/me", { headers: { Cookie: `phigrad_session=${session}` } });
  const payload = response.ok ? await response.json() : null;
  const user = payload && typeof payload === "object" ? (payload as { user?: { is_superadmin?: boolean } }).user : null;
  if (!user?.is_superadmin) redirect("/");
  return <AdminDashboard />;
}

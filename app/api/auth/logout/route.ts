import { NextRequest, NextResponse } from "next/server";
import { forwardToFastApi } from "@/lib/fastapi-bridge";
import { clearAuthCookies } from "@/lib/auth-session";

export async function POST(request: NextRequest) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("Cookie", cookie);
  try {
    await forwardToFastApi("/auth/logout", { method: "POST", headers, body: "{}" });
  } catch {
    // The browser cookies are cleared even if the API is briefly unavailable.
  }
  const result = NextResponse.json({ ok: true });
  clearAuthCookies(result);
  return result;
}

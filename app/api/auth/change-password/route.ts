import { NextRequest, NextResponse } from "next/server";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";
import { clearAuthCookies } from "@/lib/auth-session";

export async function POST(request: NextRequest) {
  const cookie = request.headers.get("cookie");
  try {
    const response = await forwardToFastApi("/auth/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: await request.text(),
    });
    const result = new NextResponse(await response.arrayBuffer(), {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
    if (response.ok) clearAuthCookies(result);
    return result;
  } catch (error) {
    const status = error instanceof FastApiBridgeError ? error.status : 502;
    return NextResponse.json({ detail: "Password change is unavailable." }, { status });
  }
}

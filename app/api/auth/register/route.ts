import { NextRequest, NextResponse } from "next/server";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";
import { setAuthCookies } from "@/lib/auth-session";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Registration details are required." }, { status: 400 });
  }
  try {
    const response = await forwardToFastApi("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json();
    const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    const workspace = typeof record.workspace === "object" && record.workspace !== null
      ? record.workspace as Record<string, unknown>
      : null;
    const result = NextResponse.json(
      {
        user: record.user ?? null,
        workspace,
        verification_required: record.verification_required === true,
        detail: record.detail,
      },
      { status: response.status },
    );
    if (
      response.ok &&
      typeof record.session_token === "string" &&
      record.session_token &&
      workspace &&
      typeof workspace.id === "string"
    ) {
      setAuthCookies(result, record.session_token, workspace.id);
    }
    return result;
  } catch (error) {
    const status = error instanceof FastApiBridgeError ? error.status : 502;
    return NextResponse.json({ detail: "Registration is unavailable." }, { status });
  }
}

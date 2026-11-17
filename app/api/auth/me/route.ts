import { NextRequest, NextResponse } from "next/server";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";

export async function GET(request: NextRequest) {
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  const authorization = request.headers.get("authorization");
  if (cookie) headers.set("Cookie", cookie);
  if (authorization) headers.set("X-User-Authorization", authorization);
  try {
    const response = await forwardToFastApi("/auth/me", { headers });
    const payload: unknown = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const status = error instanceof FastApiBridgeError ? error.status : 502;
    return NextResponse.json({ detail: "Account details are unavailable." }, { status });
  }
}

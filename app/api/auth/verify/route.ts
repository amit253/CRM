import { NextRequest, NextResponse } from "next/server";
import { forwardToFastApi } from "@/lib/fastapi-bridge";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const login = new URL("/login", request.url);
  try {
    const response = await forwardToFastApi(`/auth/verify?token=${encodeURIComponent(token)}`);
    login.searchParams.set("verified", response.ok ? "1" : "0");
  } catch {
    login.searchParams.set("verified", "0");
  }
  return NextResponse.redirect(login);
}

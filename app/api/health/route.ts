import { NextResponse } from "next/server";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";

export async function GET() {
  try {
    const response = await forwardToFastApi("/health");
    if (!response.ok) {
      return NextResponse.json({ status: "unavailable" }, { status: 503 });
    }
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof FastApiBridgeError ? error.status : 503;
    return NextResponse.json({ status: "unavailable" }, { status });
  }
}

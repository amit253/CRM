import { NextRequest, NextResponse } from "next/server";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";

export async function GET(request: NextRequest) {
  try {
    const response = await forwardToFastApi(`/auth/invitation${request.nextUrl.search}`);
    return new NextResponse(await response.arrayBuffer(), {
      status: response.status,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    });
  } catch (error) {
    const status = error instanceof FastApiBridgeError ? error.status : 502;
    return NextResponse.json({ detail: "The invitation could not be checked." }, { status });
  }
}

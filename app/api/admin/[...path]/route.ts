import { NextRequest, NextResponse } from "next/server";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";

type RouteContext = { params: Promise<{ path: string[] }> };

async function bridgeRequest(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (
    path.length === 0 ||
    path.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))
  ) {
    return NextResponse.json({ detail: "Choose a valid admin path." }, { status: 400 });
  }
  const endpoint = `/admin/${path.map((segment) => encodeURIComponent(segment)).join("/")}${request.nextUrl.search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const cookie = request.headers.get("cookie");
  if (contentType) headers.set("Content-Type", contentType);
  if (cookie) headers.set("Cookie", cookie);
  try {
    const response = await forwardToFastApi(endpoint, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
    });
    return new NextResponse(response.status === 204 ? null : await response.arrayBuffer(), {
      status: response.status,
      headers: { "Cache-Control": "no-store", "Content-Type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    if (error instanceof FastApiBridgeError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const GET = bridgeRequest;
export const POST = bridgeRequest;

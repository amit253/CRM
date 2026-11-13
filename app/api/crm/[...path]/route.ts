import { NextRequest, NextResponse } from "next/server";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const allowedMethods = new Set(["GET", "POST", "PATCH", "DELETE"]);
const forwardedHeaders = ["content-type", "etag", "last-modified"];

async function bridgeRequest(request: NextRequest, context: RouteContext) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const requestHost = request.headers.get("host")?.toLowerCase();
      const parsedOrigin = new URL(origin);
      if (
        !requestHost ||
        parsedOrigin.protocol !== "http:" ||
        parsedOrigin.host.toLowerCase() !== requestHost ||
        parsedOrigin.username ||
        parsedOrigin.password
      ) {
        return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403 });
    }
  }
  if (!allowedMethods.has(request.method)) {
    return NextResponse.json({ error: "HTTP method is not supported." }, { status: 405 });
  }

  const { path } = await context.params;
  if (
    path.length === 0 ||
    path.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))
  ) {
    return NextResponse.json({ error: "Choose a valid CRM API path." }, { status: 400 });
  }

  const endpoint = `/crm/${path.map((segment) => encodeURIComponent(segment)).join("/")}${request.nextUrl.search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  try {
    const response = await forwardToFastApi(endpoint, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
    });
    const responseHeaders = new Headers();
    for (const header of forwardedHeaders) {
      const value = response.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }
    responseHeaders.set("Cache-Control", "no-store");
    return new NextResponse(
      response.status === 204 || response.status === 304 ? null : await response.arrayBuffer(),
      { status: response.status, headers: responseHeaders },
    );
  } catch (error) {
    if (error instanceof FastApiBridgeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const GET = bridgeRequest;
export const POST = bridgeRequest;
export const PATCH = bridgeRequest;
export const DELETE = bridgeRequest;

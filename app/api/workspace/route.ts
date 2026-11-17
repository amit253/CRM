import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";

const COOKIE = "phigrad_client";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

function isClient(value: unknown): value is { id: string; name: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    typeof value.id === "string" &&
    typeof value.name === "string"
  );
}

export async function GET() {
  try {
    const response = await forwardToFastApi("/crm/clients");
    const payload: unknown = await response.json();
    const clients = Array.isArray(payload) ? payload.filter(isClient) : [];
    if (!response.ok) {
      return NextResponse.json(
        { detail: "Workspace list is unavailable." },
        { status: response.status },
      );
    }
    const requested = (await cookies()).get(COOKIE)?.value || "";
    const active = clients.some((client) => client.id === requested)
      ? requested
      : clients[0]?.id || "";
    if (!active) {
      return NextResponse.json({ detail: "You do not have access to a workspace." }, { status: 403 });
    }
    const result = NextResponse.json({ id: active, clients });
    if (active !== requested) {
      result.cookies.set(COOKIE, active, cookieOptions());
    }
    return result;
  } catch (error) {
    const status = error instanceof FastApiBridgeError ? error.status : 502;
    return NextResponse.json({ detail: "Workspace list is unavailable." }, { status });
  }
}

export async function POST(request: NextRequest) {
  let body: { action?: string; name?: string; client_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "A workspace action is required." }, { status: 400 });
  }

  try {
    if (body.action === "create") {
      const created = await forwardToFastApi("/crm/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: String(body.name || "").trim().slice(0, 80) }),
      });
      const payload: unknown = await created.json();
      if (!created.ok || !isClient(payload)) {
        return NextResponse.json(
          { detail: "Couldn't create that workspace." },
          { status: created.ok ? 502 : created.status },
        );
      }
      const result = NextResponse.json(payload);
      result.cookies.set(COOKIE, payload.id, cookieOptions());
      return result;
    }

    if (body.action === "switch") {
      const clientId = String(body.client_id || "");
      const listed = await forwardToFastApi("/crm/clients");
      const payload: unknown = await listed.json();
      const clients = Array.isArray(payload) ? payload.filter(isClient) : [];
      if (!clients.some((client) => client.id === clientId)) {
        return NextResponse.json({ detail: "You do not have access to that workspace." }, { status: 403 });
      }
      const result = NextResponse.json({ id: clientId });
      result.cookies.set(COOKIE, clientId, cookieOptions());
      return result;
    }
  } catch (error) {
    const status = error instanceof FastApiBridgeError ? error.status : 502;
    return NextResponse.json({ detail: "Workspace update failed." }, { status });
  }

  return NextResponse.json({ detail: "Unknown workspace action." }, { status: 400 });
}

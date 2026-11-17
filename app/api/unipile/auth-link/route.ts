import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { acceptedBrowserOrigin } from "@/lib/app-origin";
import { cookieSecure } from "@/lib/auth-session";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";

const allowedProviders = new Set([
  "linkedin",
  "whatsapp",
  "google",
  "outlook",
  "imap",
  "telegram",
  "instagram",
  "facebook",
]);

export async function POST(request: NextRequest) {
  const origin = acceptedBrowserOrigin(request.headers.get("origin"), request.headers.get("host"));
  if (!origin) {
    return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "A provider selection is required." }, { status: 400 });
  }

  const provider =
    typeof payload === "object" && payload !== null && "provider" in payload
      ? payload.provider
      : null;
  if (typeof provider !== "string" || !allowedProviders.has(provider)) {
    return NextResponse.json({ error: "Choose a supported provider." }, { status: 400 });
  }

  const statePrefix = origin === "http://127.0.0.1:3000" ? "ip" : origin === "http://localhost:3000" ? "lh" : "app";
  const state = `${statePrefix}.${randomBytes(32).toString("base64url")}`;

  try {
    const upstream = await forwardToFastApi("/v2/auth/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers: [provider],
        expires_on: new Date(Date.now() + 10 * 60_000).toISOString(),
        redirect_uri: new URL("/api/unipile/callback", origin).toString(),
        state,
      }),
    });
    if (!upstream.ok) {
      console.error(`FastAPI Unipile auth-link request failed with status ${upstream.status}.`);
      return NextResponse.json(
        { error: "Could not start account connection. Check the FastAPI and Unipile settings." },
        { status: 502 },
      );
    }

    const result: unknown = await upstream.json();
    const link =
      typeof result === "object" && result !== null && "link" in result
        ? result.link
        : null;
    if (typeof link !== "string" || !link) {
      throw new Error("Unipile did not return an authentication link.");
    }
    const authUrl = new URL(link);
    if (authUrl.protocol !== "https:") {
      throw new Error("Unipile returned an insecure authentication link.");
    }

    const response = NextResponse.json(
      { url: authUrl.toString() },
      { headers: { "Cache-Control": "no-store" } },
    );
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: cookieSecure(),
      path: "/",
      maxAge: 10 * 60,
    };
    response.cookies.set("unipile_auth_state", "", { ...cookieOptions, path: "/api/unipile/callback", maxAge: 0 });
    response.cookies.set("unipile_auth_state", state, cookieOptions);
    response.cookies.set("unipile_return_origin", origin, cookieOptions);
    return response;
  } catch (error) {
    if (error instanceof FastApiBridgeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}

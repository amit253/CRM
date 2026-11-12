import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
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
  const expectedOrigin = new URL(process.env.APP_URL || request.url).origin;
  const requestOrigin = request.headers.get("origin");
  let originMatches = false;
  try {
    originMatches = Boolean(requestOrigin && new URL(requestOrigin).origin === expectedOrigin);
  } catch {
    originMatches = false;
  }
  if (!originMatches) {
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

  const state = randomBytes(32).toString("base64url");
  const origin = new URL(process.env.APP_URL || request.url).origin;

  try {
    const response = await forwardToFastApi("/v2/auth/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers: [provider],
        expires_on: new Date(Date.now() + 10 * 60_000).toISOString(),
        redirect_uri: new URL("/api/unipile/callback", origin).toString(),
        state,
      }),
    });
    if (!response.ok) {
      console.error(`FastAPI Unipile auth-link request failed with status ${response.status}.`);
      return NextResponse.json(
        { error: "Could not start account connection. Check the FastAPI and Unipile settings." },
        { status: 502 },
      );
    }

    const result: unknown = await response.json();
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

    const cookieStore = await cookies();
    cookieStore.set("unipile_auth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/unipile/callback",
      maxAge: 10 * 60,
    });

    return NextResponse.json(
      { url: authUrl.toString() },
      { headers: { "Cache-Control": "no-store" } },
    );
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

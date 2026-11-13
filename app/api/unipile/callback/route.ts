import { NextRequest, NextResponse } from "next/server";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";

function homeRedirect(
  request: NextRequest,
  result: "success" | "failed",
  options: { provider?: string; clearState?: boolean } = {},
) {
  const origin = new URL(process.env.APP_URL || request.url).origin;
  const url = new URL("/inbox", origin);
  url.searchParams.set("connection", result);
  if (options.provider) {
    url.searchParams.set("provider", options.provider);
  }

  const response = NextResponse.redirect(url);
  if (options.clearState) {
    response.cookies.set("unipile_auth_state", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/unipile/callback",
      maxAge: 0,
    });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const expectedState = request.cookies.get("unipile_auth_state")?.value;
  const receivedState = params.get("state");
  if (!expectedState || !receivedState || expectedState !== receivedState) {
    return homeRedirect(request, "failed");
  }
  if (params.has("error_type")) {
    return homeRedirect(request, "failed", { clearState: true });
  }

  const accountId = params.get("account_id");
  if (!accountId || accountId.length > 256) {
    return homeRedirect(request, "failed", { clearState: true });
  }

  try {
    const accountResponse = await forwardToFastApi(
      `/v2/accounts/${encodeURIComponent(accountId)}`,
    );
    if (!accountResponse.ok) {
      console.error(`FastAPI account verification failed with status ${accountResponse.status}.`);
      return homeRedirect(request, "failed", { clearState: true });
    }

    const account: unknown = await accountResponse.json();
    const accountRecord =
      typeof account === "object" && account !== null && !Array.isArray(account)
        ? account
        : null;
    if (!accountRecord || !("id" in accountRecord) || accountRecord.id !== accountId) {
      console.error("Unipile callback account verification returned an unexpected account.");
      return homeRedirect(request, "failed", { clearState: true });
    }

    return homeRedirect(request, "success", {
      provider:
        "provider" in accountRecord && typeof accountRecord.provider === "string"
          ? accountRecord.provider
          : undefined,
      clearState: true,
    });
  } catch (error) {
    if (error instanceof FastApiBridgeError) {
      console.error(`FastAPI account verification failed with status ${error.status}.`);
      return homeRedirect(request, "failed", { clearState: true });
    }
    throw error;
  }
}

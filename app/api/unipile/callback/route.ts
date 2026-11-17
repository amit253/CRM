import { NextRequest, NextResponse } from "next/server";
import { appOrigin, configuredAppOrigin } from "@/lib/app-origin";
import { cookieSecure } from "@/lib/auth-session";
import { FastApiBridgeError, forwardToFastApi } from "@/lib/fastapi-bridge";

function startedOrigin(state: string) {
  if (state.startsWith("ip.")) return "http://127.0.0.1:3000";
  if (state.startsWith("lh.")) return "http://localhost:3000";
  if (state.startsWith("app.")) return configuredAppOrigin();
  return "";
}

function homeRedirect(
  request: NextRequest,
  result: "success" | "failed",
  options: { provider?: string; clearState?: boolean; reason?: string } = {},
) {
  const origin = appOrigin(request.cookies.get("unipile_return_origin")?.value || "")
    || appOrigin(`http://${request.headers.get("host") || ""}`)
    || appOrigin(`https://${request.headers.get("host") || ""}`)
    || configuredAppOrigin()
    || new URL(request.url).origin;
  const url = new URL("/inbox", origin);
  url.searchParams.set("connection", result);
  if (options.provider) {
    url.searchParams.set("provider", options.provider);
  }
  if (options.reason) {
    url.searchParams.set("reason", options.reason);
  }

  const response = NextResponse.redirect(url);
  response.cookies.set("unipile_return_origin", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("unipile_auth_state", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("unipile_auth_state", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/api/unipile/callback",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const receivedState = params.get("state") || "";
  const started = startedOrigin(receivedState);
  const here = appOrigin(`http://${request.headers.get("host") || ""}`)
    || appOrigin(`https://${request.headers.get("host") || ""}`)
    || appOrigin(request.url);
  if (started && here && started !== here) {
    const target = new URL("/api/unipile/callback", started);
    params.forEach((value, key) => target.searchParams.append(key, value));
    return NextResponse.redirect(target);
  }

  const expectedState = request.cookies.get("unipile_auth_state")?.value;
  if (!expectedState || !receivedState || expectedState !== receivedState) {
    return homeRedirect(request, "failed", { reason: "state" });
  }
  const errorType = params.get("error_type") || "";
  const duplicateAccount = /(?:^|\/)already_exists$/i.test(errorType);
  if (errorType && !duplicateAccount) {
    const normalizedError = errorType.toLowerCase();
    const reason = normalizedError.includes("account_limit_reached")
      ? "account-limit"
      : normalizedError.includes("account_restricted")
        ? "account-restricted"
        : "provider";
    console.error(`Unipile hosted-auth callback returned ${errorType}.`);
    return homeRedirect(request, "failed", { clearState: true, reason });
  }

  // Unipile reports a duplicate as error_detail=<existing account ID> after
  // the provider identity has been authenticated. Verify that account through
  // the API, then let our workspace ownership check decide whether it can be
  // attached here.
  const accountId = params.get("account_id") || (duplicateAccount ? params.get("error_detail") : "");
  if (!accountId || accountId.length > 256) {
    return homeRedirect(request, "failed", {
      clearState: true,
      reason: duplicateAccount ? "already-connected" : "verify",
    });
  }

  try {
    const accountResponse = await forwardToFastApi(
      `/v2/accounts/${encodeURIComponent(accountId)}`,
      { method: "GET" },
      { claimAccount: true },
    );
    if (!accountResponse.ok) {
      console.error(`FastAPI account verification failed with status ${accountResponse.status}.`);
      return homeRedirect(request, "failed", {
        clearState: true,
        reason: duplicateAccount ? "already-connected" : "verify",
      });
    }

    const account: unknown = await accountResponse.json();
    const accountRecord =
      typeof account === "object" && account !== null && !Array.isArray(account)
        ? account
        : null;
    if (!accountRecord || !("id" in accountRecord) || accountRecord.id !== accountId) {
      console.error("Unipile callback account verification returned an unexpected account.");
      return homeRedirect(request, "failed", { clearState: true, reason: "verify" });
    }

    const registered = await forwardToFastApi("/crm/unipile-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId }),
    });
    if (!registered.ok) {
      console.error(`Workspace account registration failed with status ${registered.status}.`);
      return homeRedirect(request, "failed", {
        clearState: true,
        reason: registered.status === 409 ? "already-connected" : "register",
      });
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
      return homeRedirect(request, "failed", { clearState: true, reason: "verify" });
    }
    throw error;
  }
}

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const sessionCookie = "phigrad_session";
export const workspaceCookie = "phigrad_client";
export const csrfCookie = "phigrad_csrf";

const fourteenDays = 60 * 60 * 24 * 14;

export function cookieSecure() {
  if (process.env.NODE_ENV !== "production") return false;
  const appUrl = (process.env.APP_URL || "").toLowerCase();
  if (appUrl.startsWith("http://127.0.0.1") || appUrl.startsWith("http://localhost")) return false;
  return true;
}

export function setAuthCookies(response: NextResponse, sessionToken: string, workspaceId: string) {
  const secure = cookieSecure();
  response.cookies.set(sessionCookie, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: fourteenDays,
  });
  response.cookies.set(workspaceCookie, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: fourteenDays,
  });
  response.cookies.set(csrfCookie, randomBytes(32).toString("base64url"), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: fourteenDays,
  });
}

export function clearAuthCookies(response: NextResponse) {
  const secure = cookieSecure();
  for (const name of [sessionCookie, workspaceCookie, csrfCookie]) {
    response.cookies.set(name, "", { httpOnly: name !== csrfCookie, sameSite: "lax", path: "/", secure, maxAge: 0 });
  }
}

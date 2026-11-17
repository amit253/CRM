import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicPages = new Set(["/login", "/register"]);
const csrfExempt = new Set(["/api/auth/login", "/api/auth/register", "/api/auth/verify"]);

function tokensMatch(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = Boolean(request.cookies.get("phigrad_session")?.value);
  const isPublicApi = pathname.startsWith("/api/auth/") || pathname === "/api/health";
  const isPublicPage = publicPages.has(pathname);

  if (!signedIn && !isPublicApi && !isPublicPage) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ detail: "Sign in required." }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const method = request.method.toUpperCase();
  if (
    signedIn &&
    pathname.startsWith("/api/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !csrfExempt.has(pathname)
  ) {
    const cookieToken = request.cookies.get("phigrad_csrf")?.value || "";
    const headerToken = request.headers.get("x-csrf-token") || "";
    if (!tokensMatch(cookieToken, headerToken)) {
      return NextResponse.json({ detail: "The request could not be verified. Refresh the page and try again." }, { status: 403 });
    }
  }

  const response = NextResponse.next();
  if (signedIn && !request.cookies.get("phigrad_csrf")?.value) {
    response.cookies.set("phigrad_csrf", crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""), {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 14,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

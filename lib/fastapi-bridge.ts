import "server-only";
import { cookies } from "next/headers";

export class FastApiBridgeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "FastApiBridgeError";
  }
}

function getBridgeConfig() {
  const token = process.env.LOCAL_API_TOKEN;
  if (!token) {
    throw new FastApiBridgeError("Local FastAPI bridge is not configured.", 503);
  }

  const baseUrl = process.env.FASTAPI_BASE_URL || "http://127.0.0.1:8001";
  const parsedUrl = new URL(baseUrl);
  if (
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    !parsedUrl.hostname ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new FastApiBridgeError("FastAPI bridge must use a valid internal HTTP(S) address.", 500);
  }

  return { token, baseUrl: baseUrl.replace(/\/+$/, "") };
}

export async function forwardToFastApi(
  path: string,
  init: RequestInit = {},
  options: { claimAccount?: boolean } = {},
): Promise<Response> {
  const { token, baseUrl } = getBridgeConfig();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath === "/health") {
    return await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  }
  const [namespace, ...segments] = normalizedPath.slice(1).split("/");
  if (
    !["v1", "v2", "crm", "auth", "admin"].includes(namespace) ||
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..") ||
    normalizedPath.includes("\\") ||
    /[\u0000-\u001f]/.test(normalizedPath)
  ) {
    throw new FastApiBridgeError("Unsupported FastAPI endpoint path.", 400);
  }

  try {
    const headers = new Headers(init.headers);
    const userAuthorization = headers.get("X-User-Authorization");
    headers.set("Authorization", `Bearer ${token}`);
    if (userAuthorization) headers.set("X-User-Authorization", userAuthorization);
    const jar = await cookies();
    if (!headers.has("Cookie")) {
      const session = jar.get("phigrad_session")?.value;
      if (session) headers.set("Cookie", `phigrad_session=${session}`);
    }
    if (!headers.has("X-Client-Id")) {
      const clientId = jar.get("phigrad_client")?.value;
      if (clientId && /^[A-Za-z0-9_-]{1,64}$/.test(clientId)) {
        headers.set("X-Client-Id", clientId);
      }
    }
    if (options.claimAccount) {
      headers.set("X-Unipile-Account-Claim", "1");
    }
    return await fetch(`${baseUrl}${normalizedPath}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new FastApiBridgeError(
      "FastAPI backend service is unavailable. Please try again.",
      502,
    );
  }
}

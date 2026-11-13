import "server-only";

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
    parsedUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new FastApiBridgeError("FastAPI bridge must use its local HTTP address.", 500);
  }

  return { token, baseUrl: baseUrl.replace(/\/+$/, "") };
}

export async function forwardToFastApi(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { token, baseUrl } = getBridgeConfig();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const [namespace, ...segments] = normalizedPath.slice(1).split("/");
  if (
    !["v1", "v2", "crm"].includes(namespace) ||
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..") ||
    normalizedPath.includes("\\") ||
    /[\u0000-\u001f]/.test(normalizedPath)
  ) {
    throw new FastApiBridgeError("Unsupported FastAPI endpoint path.", 400);
  }

  try {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return await fetch(`${baseUrl}${normalizedPath}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new FastApiBridgeError(
      "FastAPI is not running. Start the backend on http://127.0.0.1:8001.",
      502,
    );
  }
}

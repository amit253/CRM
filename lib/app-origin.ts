const localHosts = new Set(["localhost:3000", "127.0.0.1:3000"]);

function parsedOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
    return url;
  } catch {
    return null;
  }
}

export function configuredAppOrigin() {
  const url = parsedOrigin(process.env.APP_URL || "");
  return url ? url.origin : "";
}

export function appOrigin(value: string) {
  const url = parsedOrigin(value);
  if (!url) return "";
  if (url.protocol === "http:" && localHosts.has(url.host.toLowerCase())) return url.origin;
  const configured = configuredAppOrigin();
  if (configured && url.origin === configured) return url.origin;
  return "";
}

export function localAppOrigin(value: string) {
  const url = parsedOrigin(value);
  if (!url || url.protocol !== "http:" || !localHosts.has(url.host.toLowerCase())) return "";
  return url.origin;
}

export function acceptedBrowserOrigin(originHeader: string | null, requestHost?: string | null) {
  if (!originHeader) return "";
  const allowed = appOrigin(originHeader);
  if (allowed) return allowed;
  const url = parsedOrigin(originHeader);
  if (!url || !requestHost || url.host.toLowerCase() !== requestHost.toLowerCase()) return "";
  return url.origin;
}

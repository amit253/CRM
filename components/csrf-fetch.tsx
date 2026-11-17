"use client";

declare global {
  interface Window {
    __phigradCsrfFetch?: boolean;
  }
}

function csrfToken() {
  const match = document.cookie.match(/(?:^|; )phigrad_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

if (typeof window !== "undefined" && !window.__phigradCsrfFetch) {
  window.__phigradCsrfFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const token = csrfToken();
      if (token) {
        const headers = new Headers(init?.headers);
        if (!headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", token);
        return original(input, { ...init, headers });
      }
    }
    return original(input, init);
  };
}

export function CsrfFetch() {
  return null;
}

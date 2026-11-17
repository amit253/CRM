"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const verified = params.get("verified");
  const nextPath = params.get("next");
  const destination = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload: { detail?: unknown } = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof payload.detail === "string" ? payload.detail : "Email or password is incorrect.");
        return;
      }
      window.location.assign(destination);
    } catch {
      setError("Sign in is unavailable right now.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <span className="auth-mark">p</span>
        <h1>Sign in</h1>
        <p>Use the workspace account for your CRM and inbox.</p>
        {verified === "1" && <p className="auth-note">Email confirmed. You can sign in.</p>}
        {verified === "0" && <p className="auth-error">That confirmation link is invalid or expired.</p>}
        <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="auth-shell" />}>
      <LoginForm />
    </Suspense>
  );
}

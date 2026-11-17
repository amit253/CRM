"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const inviteOnly = "Phigrad is invite-only. Please contact your administrator or use your invitation link.";

function RegisterForm() {
  const token = useSearchParams().get("token") || "";
  const [email, setEmail] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) return;
    void fetch(`/api/auth/invitation?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload: { detail?: string; email?: string; workspace_name?: string } = await response.json().catch(() => ({}));
        if (!response.ok || !payload.email) {
          setError(typeof payload.detail === "string" ? payload.detail : "This invitation is invalid.");
          return;
        }
        setEmail(payload.email);
        setWorkspace(payload.workspace_name || "");
        setReady(true);
      })
      .catch(() => setError("The invitation could not be checked."));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, full_name: fullName, password, confirm_password: confirmPassword }),
      });
      const payload: { detail?: unknown } = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof payload.detail === "string" ? payload.detail : "The invitation could not be accepted.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Registration is unavailable right now.");
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <span className="auth-mark">p</span>
          <h1>Invite only</h1>
          <p>{inviteOnly}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <span className="auth-mark">p</span>
        <h1>Accept invitation</h1>
        <p>{workspace ? `Join ${workspace}.` : "Create your Phigrad account."}</p>
        {error && <p className="auth-error">{error}</p>}
        <label>Email<input type="email" value={email} readOnly required /></label>
        <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={120} autoComplete="name" /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" /></label>
        <label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" /></label>
        <button type="submit" disabled={pending || !ready}>{pending ? "Creating account…" : "Create account"}</button>
      </form>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="auth-shell" />}>
      <RegisterForm />
    </Suspense>
  );
}

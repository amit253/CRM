"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Workspace = { id: string; name: string; role?: string };

export function WorkspaceSwitcher({ variant }: { variant: "crm" | "inbox" }) {
  const [clients, setClients] = useState<Workspace[]>([]);
  const [current, setCurrent] = useState("");
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [notice, setNotice] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/workspace", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { id?: string; clients?: Workspace[] }) => {
        setCurrent(typeof payload.id === "string" ? payload.id : "default_workspace");
        setClients(Array.isArray(payload.clients) ? payload.clients : []);
      })
      .catch(() => setError("Workspace list is unavailable."));
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { user?: { is_superadmin?: boolean } }) => setSuperAdmin(Boolean(payload.user?.is_superadmin)))
      .catch(() => setSuperAdmin(false));
  }, []);

  async function choose(id: string) {
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "switch", client_id: id }),
    });
    if (!response.ok) {
      setError("Couldn't switch workspace.");
      return;
    }
    window.location.reload();
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  async function inviteCustomer() {
    const email = customerEmail.trim();
    const name = customerName.trim();
    if (!email || !name) return;
    setError("");
    setNotice("");
    setInviteLink("");
    const response = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_name: name, email }),
    });
    const payload: { detail?: string; invitation_url?: string } = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(typeof payload.detail === "string" ? payload.detail : "Couldn't create that customer workspace.");
      return;
    }
    setCustomerEmail("");
    setCustomerName("");
    setInviteLink(payload.invitation_url || "");
    setNotice("New empty workspace created. This customer will connect their own accounts.");
  }

  async function invite() {
    const email = inviteEmail.trim();
    if (!email) return;
    setError("");
    setNotice("");
    const response = await fetch("/api/crm/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role: inviteRole }),
    });
    const payload: { detail?: string; invitation_url?: string } = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(typeof payload.detail === "string" ? payload.detail : "Couldn't send that invitation.");
      return;
    }
    setInviteEmail("");
    setInviteLink(payload.invitation_url || "");
    setNotice(payload.invitation_url ? "Invitation created. Share this link once." : "Invitation sent.");
  }

  const active = clients.find((client) => client.id === current);
  const canInvite = active?.role === "owner" || active?.role === "admin";
  const root = variant === "crm" ? "crm-workspace-switch" : "unified-workspace-switch";

  return (
    <div className={root}>
      <button type="button" className={`${root}-trigger`} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span><small>WORKSPACE</small><strong>{active?.name || "Workspace"}</strong></span>
        <b aria-hidden="true">⌄</b>
      </button>
      {open && (
        <div className={`${root}-menu`}>
          {clients.map((client) => (
            <button type="button" key={client.id} onClick={() => void choose(client.id)} disabled={client.id === current}>
              {client.name}
            </button>
          ))}
          {superAdmin && (
            <>
              <label>
                New customer workspace
                <input value={customerName} maxLength={80} onChange={(event) => setCustomerName(event.target.value)} placeholder="Company name" />
              </label>
              <label>
                Customer email
                <input value={customerEmail} maxLength={254} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="owner@company.com" />
              </label>
              <button type="button" onClick={() => void inviteCustomer()} disabled={!customerName.trim() || !customerEmail.trim()}>Invite to a new workspace</button>
            </>
          )}
          {canInvite && (
            <>
              <label>
                Add teammate to {active?.name || "this workspace"}
                <input value={inviteEmail} maxLength={254} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" />
              </label>
              <p>They will see this workspace&apos;s contacts and inboxes.</p>
              <label>
                Role
                <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button type="button" onClick={() => void invite()} disabled={!inviteEmail.trim()}>Add teammate</button>
            </>
          )}
          {superAdmin && <Link href="/admin">Platform admin</Link>}
          <button type="button" onClick={() => void signOut()}>Sign out</button>
          {notice && <p>{notice}</p>}
          {inviteLink && <p className="workspace-invite-link">{inviteLink}</p>}
          {error && <p>{error}</p>}
        </div>
      )}
    </div>
  );
}

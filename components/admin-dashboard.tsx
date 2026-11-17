"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Membership = { id: string; name: string; role: string };
type UserRow = {
  id: string;
  email: string;
  full_name: string;
  is_superadmin: boolean;
  is_suspended: boolean;
  workspaces: Membership[];
};
type WorkspaceRow = { id: string; name: string; member_count: number };
type InvitationRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  workspace_name: string;
  expires_at: string;
};

const statusLabel: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  expired: "Expired",
  revoked: "Revoked",
};

export function AdminDashboard() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [userResponse, workspaceResponse, invitationResponse] = await Promise.all([
      fetch("/api/admin/users", { cache: "no-store" }),
      fetch("/api/admin/workspaces", { cache: "no-store" }),
      fetch("/api/admin/invitations", { cache: "no-store" }),
    ]);
    if (!userResponse.ok) {
      setError("Admin data is unavailable.");
      return;
    }
    setUsers(await userResponse.json());
    setWorkspaces(workspaceResponse.ok ? await workspaceResponse.json() : []);
    setInvitations(invitationResponse.ok ? await invitationResponse.json() : []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createCustomer(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLink("");
    const response = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_name: workspaceName, email }),
    });
    const payload: { detail?: string; invitation_url?: string } = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(typeof payload.detail === "string" ? payload.detail : "The invitation could not be created.");
      return;
    }
    setLink(payload.invitation_url || "");
    setWorkspaceName("");
    setEmail("");
    await load();
  }

  async function act(path: string) {
    setError("");
    const response = await fetch(path, { method: "POST" });
    if (!response.ok) {
      const payload: { detail?: string } = await response.json().catch(() => ({}));
      setError(payload.detail || "That action was not allowed.");
      return;
    }
    await load();
  }

  return (
    <main className="admin-shell">
      <header>
        <span className="auth-mark">p</span>
        <div>
          <h1>Platform admin</h1>
          <p>{users.length} users · {workspaces.length} workspaces</p>
        </div>
        <Link href="/">Back to workspace</Link>
      </header>
      {error && <p className="auth-error">{error}</p>}
      <form className="admin-create" onSubmit={(event) => void createCustomer(event)}>
        <h2>Invite a customer</h2>
        <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace name" required maxLength={80} />
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@company.com" type="email" required maxLength={254} />
        <button type="submit">Create workspace and invite owner</button>
        {link && <p className="workspace-invite-link">Share this link once: {link}</p>}
      </form>
      <section>
        <h2>Users</h2>
        <table>
          <thead><tr><th>Email</th><th>Name</th><th>Workspace</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.email}</td>
                <td>{user.full_name}</td>
                <td>{user.workspaces.map((item) => item.name).join(", ") || "—"}</td>
                <td>{[user.is_superadmin ? "Super admin" : "", ...user.workspaces.map((item) => item.role)].filter(Boolean).join(", ") || "—"}</td>
                <td>{user.is_suspended ? "Suspended" : "Active"}</td>
                <td>
                  {user.is_suspended ? (
                    <button type="button" onClick={() => void act(`/api/admin/users/${user.id}/reactivate`)}>Reactivate</button>
                  ) : (
                    <button type="button" onClick={() => void act(`/api/admin/users/${user.id}/suspend`)}>Suspend</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Workspaces</h2>
        <table>
          <thead><tr><th>Name</th><th>Members</th></tr></thead>
          <tbody>
            {workspaces.map((workspace) => (
              <tr key={workspace.id}><td>{workspace.name}</td><td>{workspace.member_count}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Invitations</h2>
        <table>
          <thead><tr><th>Email</th><th>Workspace</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>{invitation.email}</td>
                <td>{invitation.workspace_name}</td>
                <td>{invitation.role}</td>
                <td>{statusLabel[invitation.status] || invitation.status}</td>
                <td>
                  {invitation.status === "pending" && (
                    <button type="button" onClick={() => void act(`/api/admin/invitations/${invitation.id}/revoke`)}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

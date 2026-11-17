"""Platform administration. Every route checks is_superadmin on the server."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.auth import normalize_email, revoke_sessions
from app.crm import database, insert_client, require_user, utc_now
from app.invitations import create_invitation, deliver_invitation, invitation_url, public_invitation

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class CustomerInvitation(AdminInput):
    workspace_name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)


def require_superadmin() -> str:
    user_id = require_user()
    with database() as connection:
        row = connection.execute(
            "SELECT is_superadmin, is_suspended FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if row is None or not row["is_superadmin"] or row["is_suspended"]:
        raise HTTPException(status_code=403, detail="Platform admin access is required.")
    return user_id


def active_superadmin_count(connection) -> int:
    return connection.execute(
        "SELECT COUNT(*) FROM users WHERE is_superadmin = 1 AND is_suspended = 0"
    ).fetchone()[0]


@router.get("/users")
def list_users():
    require_superadmin()
    with database() as connection:
        users = connection.execute(
            """
            SELECT id, email, full_name, is_verified, is_superadmin, is_suspended, created_at
            FROM users ORDER BY created_at
            """
        ).fetchall()
        memberships = connection.execute(
            """
            SELECT m.user_id, c.id AS workspace_id, c.name AS workspace_name, m.role
            FROM workspace_memberships m
            JOIN clients c ON c.id = m.workspace_id
            ORDER BY c.name COLLATE NOCASE
            """
        ).fetchall()
    grouped: dict[str, list[dict]] = {}
    for row in memberships:
        grouped.setdefault(row["user_id"], []).append({
            "id": row["workspace_id"],
            "name": row["workspace_name"],
            "role": row["role"],
        })
    return [
        {
            "id": row["id"],
            "email": row["email"],
            "full_name": row["full_name"],
            "is_verified": bool(row["is_verified"]),
            "is_superadmin": bool(row["is_superadmin"]),
            "is_suspended": bool(row["is_suspended"]),
            "created_at": row["created_at"],
            "workspaces": grouped.get(row["id"], []),
        }
        for row in users
    ]


@router.post("/users/{user_id}/suspend")
def suspend_user(user_id: str):
    actor = require_superadmin()
    with database() as connection:
        target = connection.execute(
            "SELECT id, is_superadmin, is_suspended FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if target is None:
            raise HTTPException(status_code=404, detail="User not found.")
        if target["is_superadmin"] and active_superadmin_count(connection) <= 1:
            raise HTTPException(status_code=403, detail="The only active super admin cannot be suspended.")
        if actor == user_id and active_superadmin_count(connection) <= 1:
            raise HTTPException(status_code=403, detail="The only active super admin cannot be suspended.")
        connection.execute(
            "UPDATE users SET is_suspended = 1, updated_at = ? WHERE id = ?",
            (utc_now(), user_id),
        )
        revoke_sessions(connection, user_id)
    return {"suspended": True}


@router.post("/users/{user_id}/reactivate")
def reactivate_user(user_id: str):
    require_superadmin()
    with database() as connection:
        updated = connection.execute(
            "UPDATE users SET is_suspended = 0, updated_at = ? WHERE id = ?",
            (utc_now(), user_id),
        )
        if updated.rowcount != 1:
            raise HTTPException(status_code=404, detail="User not found.")
    return {"reactivated": True}


@router.get("/workspaces")
def list_workspaces():
    require_superadmin()
    with database() as connection:
        rows = connection.execute(
            """
            SELECT c.id, c.name, c.created_at, COUNT(m.user_id) AS member_count
            FROM clients c
            LEFT JOIN workspace_memberships m ON m.workspace_id = c.id
            GROUP BY c.id
            ORDER BY c.created_at
            """
        ).fetchall()
    return [dict(row) for row in rows]


@router.post("/invitations", status_code=201)
def invite_customer(payload: CustomerInvitation):
    actor = require_superadmin()
    email = normalize_email(payload.email)
    with database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        workspace_id = insert_client(connection, payload.workspace_name.strip())
        invitation_id, raw_token = create_invitation(connection, workspace_id, email, "owner", actor)
        row = connection.execute(
            """
            SELECT i.*, c.name AS workspace_name
            FROM workspace_invitations i JOIN clients c ON c.id = i.workspace_id
            WHERE i.id = ?
            """,
            (invitation_id,),
        ).fetchone()
    url = invitation_url(raw_token)
    delivery = deliver_invitation(email, url)
    return {**public_invitation(row), "invitation_url": url, "delivery": delivery}


@router.get("/invitations")
def list_invitations():
    require_superadmin()
    with database() as connection:
        rows = connection.execute(
            """
            SELECT i.*, c.name AS workspace_name
            FROM workspace_invitations i
            JOIN clients c ON c.id = i.workspace_id
            ORDER BY i.created_at DESC
            """
        ).fetchall()
    return [public_invitation(row) for row in rows]


@router.post("/invitations/{invitation_id}/revoke")
def revoke_invitation(invitation_id: str):
    require_superadmin()
    with database() as connection:
        updated = connection.execute(
            """
            UPDATE workspace_invitations
            SET revoked_at = ?
            WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL
            """,
            (utc_now(), invitation_id),
        )
        if updated.rowcount != 1:
            raise HTTPException(status_code=404, detail="That pending invitation was not found.")
    return {"revoked": True}

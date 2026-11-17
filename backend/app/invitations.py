"""Single-use workspace invitations. Raw tokens are never stored."""

from __future__ import annotations

import os
import secrets
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.auth import hash_secret, issue_session, normalize_email, public_user
from app.crm import (
    add_membership,
    client_scope,
    database,
    require_user,
    utc_now,
    workspace_role,
)

router = APIRouter(tags=["invitations"])
INVITE_HOURS = 48
ALLOWED_TEAM_ROLES = {"admin", "member"}


def production_mode() -> bool:
    return os.getenv("PHIGRAD_ENV", "development").strip().lower() == "production"


def invitation_status(row) -> str:
    if row["revoked_at"]:
        return "revoked"
    if row["accepted_at"]:
        return "accepted"
    if row["expires_at"] < utc_now():
        return "expired"
    return "pending"


def invitation_url(raw_token: str) -> str:
    origin = os.getenv("APP_URL", "http://127.0.0.1:3000").rstrip("/")
    return f"{origin}/register?token={raw_token}"


def deliver_invitation(email: str, url: str) -> str:
    host = os.getenv("SMTP_HOST", "").strip()
    if host:
        message = EmailMessage()
        message["Subject"] = "You're invited to Phigrad"
        message["From"] = os.getenv("SMTP_FROM") or os.getenv("SMTP_USERNAME") or "invites@localhost"
        message["To"] = email
        message.set_content(
            "You have been invited to Phigrad.\n\n"
            f"Open this link within 48 hours to create your account:\n{url}\n"
        )
        try:
            port = int(os.getenv("SMTP_PORT", "587"))
            with smtplib.SMTP(host, port, timeout=20) as smtp:
                if os.getenv("SMTP_USE_TLS", "true").strip().lower() != "false":
                    smtp.starttls()
                username = os.getenv("SMTP_USERNAME", "").strip()
                password = os.getenv("SMTP_PASSWORD", "")
                if username:
                    smtp.login(username, password)
                smtp.send_message(message)
            return "sent"
        except (OSError, smtplib.SMTPException, ValueError):
            print("Invitation email could not be sent.", flush=True)
    if not production_mode():
        print(f"Invitation link for {email}: {url}", flush=True)
        return "logged"
    print("Invitation created, but email is not configured. The link was not written to the log.", flush=True)
    return "unsent"


def load_invitation(connection, raw_token: str):
    if not raw_token:
        return None
    return connection.execute(
        """
        SELECT i.*, c.name AS workspace_name
        FROM workspace_invitations i
        JOIN clients c ON c.id = i.workspace_id
        WHERE i.token_hash = ?
        """,
        (hash_secret(raw_token),),
    ).fetchone()


def public_invitation(row) -> dict:
    return {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "workspace_name": row["workspace_name"] if "workspace_name" in row.keys() else "",
        "email": row["email"],
        "role": row["role"],
        "status": invitation_status(row),
        "expires_at": row["expires_at"],
        "accepted_at": row["accepted_at"],
        "revoked_at": row["revoked_at"],
        "created_at": row["created_at"],
    }


def assert_redeemable(row) -> None:
    status = invitation_status(row)
    if status == "revoked":
        raise HTTPException(status_code=400, detail="This invitation has been revoked.")
    if status == "accepted":
        raise HTTPException(status_code=400, detail="This invitation has already been used.")
    if status == "expired":
        raise HTTPException(status_code=400, detail="This invitation has expired.")


def create_invitation(connection, workspace_id: str, email: str, role: str, invited_by: str) -> tuple[str, str]:
    if role not in {"owner", "admin", "member"}:
        raise HTTPException(status_code=422, detail="Choose a valid workspace role.")
    existing = connection.execute(
        """
        SELECT id FROM workspace_invitations
        WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at >= ?
        """,
        (workspace_id, email, utc_now()),
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail="A pending invitation already exists for that email.")
    raw_token = secrets.token_urlsafe(32)
    invitation_id = str(uuid.uuid4())
    expires = (datetime.now(timezone.utc) + timedelta(hours=INVITE_HOURS)).isoformat(timespec="seconds")
    connection.execute(
        """
        INSERT INTO workspace_invitations
        (id, workspace_id, email, role, token_hash, invited_by_user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (invitation_id, workspace_id, email, role, hash_secret(raw_token), invited_by, expires, utc_now()),
    )
    return invitation_id, raw_token


def accept_invitation(raw_token: str, full_name: str, hashed_password: str):
    user_id = str(uuid.uuid4())
    timestamp = utc_now()
    with database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = load_invitation(connection, raw_token)
        if row is None:
            raise HTTPException(status_code=400, detail="This invitation is invalid.")
        assert_redeemable(row)
        email = normalize_email(row["email"])
        taken = connection.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if taken:
            raise HTTPException(status_code=409, detail="An account with that email already exists.")
        updated = connection.execute(
            """
            UPDATE workspace_invitations
            SET accepted_at = ?
            WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at >= ?
            """,
            (timestamp, row["id"], timestamp),
        )
        if updated.rowcount != 1:
            raise HTTPException(status_code=409, detail="This invitation has already been used.")
        is_super = 1 if email == os.getenv("SUPERADMIN_EMAIL", "").strip().lower() else 0
        connection.execute(
            """
            INSERT INTO users
            (id, email, hashed_password, full_name, is_verified, is_superadmin, is_suspended, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?)
            """,
            (user_id, email, hashed_password, full_name, is_super, timestamp, timestamp),
        )
        add_membership(connection, row["workspace_id"], user_id, row["role"])
        session_token = issue_session(connection, user_id)
        user = connection.execute(
            "SELECT id, email, full_name, is_verified, is_superadmin, is_suspended FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        workspace = {"id": row["workspace_id"], "name": row["workspace_name"], "role": row["role"]}
    return public_user(user), workspace, session_token


@router.get("/auth/invitation")
def preview_invitation(token: str = ""):
    with database() as connection:
        row = load_invitation(connection, token.strip())
    if row is None:
        raise HTTPException(status_code=400, detail="This invitation is invalid.")
    assert_redeemable(row)
    return {
        "email": row["email"],
        "workspace_name": row["workspace_name"],
        "role": row["role"],
        "expires_at": row["expires_at"],
    }


class TeamInvitationCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    role: str = Field(default="member", max_length=20)


@router.post("/crm/invitations", status_code=201)
def invite_teammate(payload: TeamInvitationCreate):
    actor = require_user()
    workspace_id = client_scope()
    role = workspace_role(actor, workspace_id)
    if role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Only a workspace owner or admin can invite teammates.")
    if payload.role not in ALLOWED_TEAM_ROLES:
        raise HTTPException(status_code=422, detail="Team invitations can only grant admin or member access.")
    email = normalize_email(payload.email)
    with database() as connection:
        invitation_id, raw_token = create_invitation(connection, workspace_id, email, payload.role, actor)
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


@router.get("/crm/invitations")
def list_workspace_invitations():
    actor = require_user()
    workspace_id = client_scope()
    if workspace_role(actor, workspace_id) not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Only a workspace owner or admin can view invitations.")
    with database() as connection:
        rows = connection.execute(
            """
            SELECT i.*, c.name AS workspace_name
            FROM workspace_invitations i JOIN clients c ON c.id = i.workspace_id
            WHERE i.workspace_id = ?
            ORDER BY i.created_at DESC
            """,
            (workspace_id,),
        ).fetchall()
    return [public_invitation(row) for row in rows]


@router.post("/crm/invitations/{invitation_id}/revoke")
def revoke_workspace_invitation(invitation_id: str):
    actor = require_user()
    workspace_id = client_scope()
    if workspace_role(actor, workspace_id) not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Only a workspace owner or admin can revoke invitations.")
    with database() as connection:
        updated = connection.execute(
            """
            UPDATE workspace_invitations
            SET revoked_at = ?
            WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
            """,
            (utc_now(), invitation_id, workspace_id),
        )
        if updated.rowcount != 1:
            raise HTTPException(status_code=404, detail="That pending invitation was not found in this workspace.")
    return {"revoked": True}

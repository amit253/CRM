"""Local user accounts, session cookies, and workspace membership."""

from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.crm import (
    DEFAULT_CLIENT_ID,
    add_membership,
    database,
    utc_now,
    workspace_memberships,
)

router = APIRouter(prefix="/auth", tags=["auth"])
SESSION_DAYS = 14


class AuthInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class RegisterRequest(AuthInput):
    token: str = Field(min_length=20, max_length=200)
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=72)
    confirm_password: str = Field(min_length=8, max_length=72)


class PasswordChangeRequest(AuthInput):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class LoginRequest(AuthInput):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=72)


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@") or " " in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    return email


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def password_matches(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def public_user(row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "full_name": row["full_name"],
        "is_verified": bool(row["is_verified"]),
        "is_superadmin": bool(row["is_superadmin"]) if "is_superadmin" in row.keys() else False,
        "is_suspended": bool(row["is_suspended"]) if "is_suspended" in row.keys() else False,
    }


def issue_session(connection, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
    connection.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (hash_secret(token), user_id, expires, utc_now()),
    )
    return token


def user_from_session(raw_token: str):
    if not raw_token:
        return None
    with database() as connection:
        row = connection.execute(
            """
            SELECT u.id, u.email, u.full_name, u.is_verified, u.is_superadmin, u.is_suspended, s.expires_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
            """,
            (hash_secret(raw_token),),
        ).fetchone()
    if row is None:
        return None
    if row["expires_at"] < utc_now():
        return None
    return row


def preferred_workspace(user_id: str) -> dict | None:
    memberships = workspace_memberships(user_id)
    primary = next((m for m in memberships if m["id"] == DEFAULT_CLIENT_ID), None)
    if primary:
        return primary
    return memberships[0] if memberships else None


def revoke_sessions(connection, user_id: str) -> None:
    connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def bootstrap_superadmin() -> None:
    """Grant super admin only to the existing account named by SUPERADMIN_EMAIL."""
    configured = os.getenv("SUPERADMIN_EMAIL", "").strip().lower()
    if not configured:
        print("SUPERADMIN_EMAIL is not set. No super admin was granted.", flush=True)
        return
    with database() as connection:
        row = connection.execute("SELECT id, is_superadmin FROM users WHERE email = ?", (configured,)).fetchone()
        if row is None:
            user_count = connection.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"]
            initial_password = os.getenv("SUPERADMIN_INITIAL_PASSWORD", "")
            if user_count == 0 and len(initial_password.encode()) >= 8 and len(initial_password.encode()) <= 72:
                user_id = str(uuid.uuid4())
                timestamp = utc_now()
                connection.execute(
                    """
                    INSERT INTO users
                    (id, email, hashed_password, full_name, is_verified, is_superadmin, is_suspended, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 1, 1, 0, ?, ?)
                    """,
                    (user_id, configured, hash_password(initial_password), "Super Admin", timestamp, timestamp),
                )
                add_membership(connection, DEFAULT_CLIENT_ID, user_id, "owner")
                print(
                    "Created the first super admin on an empty database. Remove SUPERADMIN_INITIAL_PASSWORD after signing in.",
                    flush=True,
                )
                return
            print(
                "SUPERADMIN_EMAIL does not match an existing account. No account was created and no super admin was granted.",
                flush=True,
            )
            if user_count == 0:
                print(
                    "On an empty database, set SUPERADMIN_INITIAL_PASSWORD (8 to 72 bytes) to create that first account.",
                    flush=True,
                )
            return
        if not row["is_superadmin"]:
            connection.execute(
                "UPDATE users SET is_superadmin = 1, updated_at = ? WHERE id = ?",
                (utc_now(), row["id"]),
            )
            print("Super admin privileges granted to the configured existing account.", flush=True)


@router.post("/register", status_code=201)
def register(payload: RegisterRequest):
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    from app.invitations import accept_invitation

    try:
        hashed = hash_password(payload.password)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Password is too long.") from error
    user, workspace, session_token = accept_invitation(payload.token.strip(), payload.full_name.strip(), hashed)
    return {"user": user, "workspace": workspace, "session_token": session_token}


@router.post("/login")
def login(payload: LoginRequest):
    email = normalize_email(payload.email)
    with database() as connection:
        user = connection.execute(
            """
            SELECT id, email, full_name, is_verified, is_superadmin, is_suspended, hashed_password
            FROM users WHERE email = ?
            """,
            (email,),
        ).fetchone()
        if user is None or not password_matches(payload.password, user["hashed_password"]):
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        if user["is_suspended"]:
            raise HTTPException(status_code=403, detail="Your account has been suspended. Please contact support.")
        if not user["is_verified"]:
            raise HTTPException(status_code=403, detail="Confirm your email before signing in.")
        session_token = issue_session(connection, user["id"])
    workspace = preferred_workspace(user["id"])
    if workspace is None:
        raise HTTPException(status_code=403, detail="This account has no workspace.")
    return {
        "user": public_user(user),
        "workspace": workspace,
        "session_token": session_token,
    }


@router.post("/logout")
def logout(request: Request):
    raw_token = read_session_token(
        request.headers.get("cookie", ""),
        request.headers.get("x-user-authorization", ""),
    )
    if raw_token:
        with database() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_secret(raw_token),))
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    user = user_from_session(read_session_token(
        request.headers.get("cookie", ""),
        request.headers.get("x-user-authorization", ""),
    ))
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required.")
    return {"user": public_user(user), "workspaces": workspace_memberships(user["id"])}


@router.post("/change-password")
def change_password(payload: PasswordChangeRequest, request: Request):
    raw_token = read_session_token(
        request.headers.get("cookie", ""),
        request.headers.get("x-user-authorization", ""),
    )
    current = user_from_session(raw_token)
    if current is None:
        raise HTTPException(status_code=401, detail="Sign in required.")
    with database() as connection:
        user = connection.execute(
            "SELECT id, hashed_password, is_suspended FROM users WHERE id = ?",
            (current["id"],),
        ).fetchone()
        if user is None or user["is_suspended"] or not password_matches(payload.current_password, user["hashed_password"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect.")
        try:
            hashed = hash_password(payload.new_password)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Password is too long.") from error
        connection.execute(
            "UPDATE users SET hashed_password = ?, updated_at = ? WHERE id = ?",
            (hashed, utc_now(), user["id"]),
        )
        revoke_sessions(connection, user["id"])
    return {"ok": True}


@router.get("/verify")
def verify_email(token: str = ""):
    if not token:
        raise HTTPException(status_code=400, detail="Verification link is invalid.")
    with database() as connection:
        row = connection.execute(
            "SELECT user_id, expires_at FROM email_verifications WHERE token_hash = ?",
            (hash_secret(token),),
        ).fetchone()
        if row is None or row["expires_at"] < utc_now():
            raise HTTPException(status_code=400, detail="Verification link is invalid or expired.")
        connection.execute(
            "UPDATE users SET is_verified = 1, updated_at = ? WHERE id = ?",
            (utc_now(), row["user_id"]),
        )
        connection.execute("DELETE FROM email_verifications WHERE user_id = ?", (row["user_id"],))
    return {"verified": True}


def read_session_token(cookie_header: str, user_authorization: str) -> str:
    for part in cookie_header.split(";"):
        name, separator, value = part.strip().partition("=")
        if separator and name == "phigrad_session" and value:
            return value
    if user_authorization.lower().startswith("bearer "):
        return user_authorization.split(" ", 1)[1].strip()
    return ""

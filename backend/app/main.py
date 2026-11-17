from __future__ import annotations

import hmac
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Security
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.background import BackgroundTask

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

from app.admin import router as admin_router
from app.auth import bootstrap_superadmin, read_session_token, revoke_sessions, router as auth_router, user_from_session
from app.invitations import router as invitation_router
from app.crm import (
    bind_client,
    bind_user,
    database,
    filter_unipile_accounts,
    initialize_database,
    reset_client,
    reset_user,
    router as crm_router,
    unipile_account_allowed,
    valid_client_id,
    workspace_memberships,
    workspace_role,
)

LOCAL_HOSTS = {"localhost:8001", "127.0.0.1:8001"}
LOCAL_ORIGINS = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8001",
    "http://127.0.0.1:8001",
}


def allowed_hosts() -> set[str]:
    hosts = set(LOCAL_HOSTS)
    fastapi_base = os.getenv("FASTAPI_BASE_URL", "").strip()
    if fastapi_base:
        parsed = urlsplit(fastapi_base)
        if parsed.netloc:
            hosts.add(parsed.netloc.lower())
    return hosts


def allowed_origins() -> set[str]:
    origins = set(LOCAL_ORIGINS)
    configured = os.getenv("APP_URL", "").strip().rstrip("/")
    if configured:
        origins.add(configured)
    return origins
FORWARDED_RESPONSE_HEADERS = {
    "accept-ranges",
    "cache-control",
    "content-disposition",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
}
FORWARDED_REQUEST_HEADERS = {"accept", "content-type"}
SUPPORTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]
LOCAL_DOCUMENTATION_PATHS = {"/docs", "/docs/oauth2-redirect", "/openapi.json", "/redoc"}
PUBLIC_PATHS = {"/health", "/auth/register", "/auth/login", "/auth/verify", "/auth/invitation"}
SESSION_ONLY_PATHS = {"/auth/me", "/auth/logout", "/crm/clients"}
bearer_scheme = HTTPBearer(auto_error=False)


def unipile_base_url() -> str:
    value = os.getenv("UNIPILE_API_BASE_URL", "https://api.unipile.com").rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not (parsed.hostname == "unipile.com" or parsed.hostname.endswith(".unipile.com"))
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise HTTPException(
            status_code=500,
            detail="UNIPILE_API_BASE_URL must be an HTTPS Unipile API host.",
        )
    return value


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    bootstrap_superadmin()
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        app.state.unipile_client = client
        yield


app = FastAPI(
    title="Phigrad Local Unipile Bridge",
    description=(
        "Local-development-only authenticated proxy for Unipile v1 and v2 REST endpoints. "
        "The API key is injected server-side and never returned to the browser."
    ),
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(crm_router)
app.include_router(auth_router)
app.include_router(invitation_router)
app.include_router(admin_router)


@app.middleware("http")
async def enforce_local_access(request: Request, call_next):
    host = request.headers.get("host", "").lower()
    if host not in allowed_hosts():
        return JSONResponse(
            {"detail": "This bridge is available on localhost only."},
            status_code=403,
        )

    origin = request.headers.get("origin")
    if origin and origin not in allowed_origins():
        return JSONResponse(
            {"detail": "Request origin was not accepted."},
            status_code=403,
        )

    if request.url.path in LOCAL_DOCUMENTATION_PATHS:
        return await call_next(request)

    expected_token = os.getenv("LOCAL_API_TOKEN")
    provided_token = request.headers.get("authorization", "")
    if not expected_token:
        return JSONResponse(
            {"detail": "LOCAL_API_TOKEN is not configured."},
            status_code=503,
        )
    if not hmac.compare_digest(provided_token, f"Bearer {expected_token}"):
        return JSONResponse(
            {"detail": "Local bridge authorization failed."},
            status_code=401,
        )

    if request.url.path in PUBLIC_PATHS:
        return await call_next(request)

    session_token = read_session_token(
        request.headers.get("cookie", ""),
        request.headers.get("x-user-authorization", ""),
    )
    user = user_from_session(session_token)
    if user is None:
        return JSONResponse({"detail": "Sign in required."}, status_code=401)
    if user["is_suspended"]:
        with database() as connection:
            revoke_sessions(connection, user["id"])
        return JSONResponse(
            {"detail": "Your account has been suspended. Please contact support."},
            status_code=403,
        )
    if not user["is_verified"]:
        return JSONResponse({"detail": "Confirm your email before continuing."}, status_code=403)
    if request.url.path.startswith("/admin") and not user["is_superadmin"]:
        return JSONResponse({"detail": "Platform admin access is required."}, status_code=403)

    memberships = workspace_memberships(user["id"])
    allowed = {item["id"] for item in memberships}
    if request.url.path.startswith("/admin"):
        user_token = bind_user(user["id"])
        client_token = bind_client(memberships[0]["id"] if memberships else "")
        try:
            return await call_next(request)
        finally:
            reset_client(client_token)
            reset_user(user_token)
    if not allowed:
        return JSONResponse({"detail": "This account has no workspace."}, status_code=403)
    requested_client = request.headers.get("x-client-id", "").strip()
    session_only = request.url.path in SESSION_ONLY_PATHS
    if requested_client and requested_client not in allowed and not session_only:
        return JSONResponse({"detail": "You do not have access to that workspace."}, status_code=403)
    if requested_client in allowed:
        active_client = requested_client
    else:
        active_client = memberships[0]["id"]
    if not valid_client_id(active_client) or workspace_role(user["id"], active_client) is None:
        return JSONResponse({"detail": "You do not have access to that workspace."}, status_code=403)

    user_token = bind_user(user["id"])
    client_token = bind_client(active_client)
    try:
        return await call_next(request)
    finally:
        reset_client(client_token)
        reset_user(user_token)


@app.get("/health", include_in_schema=False)
async def health():
    return {
        "status": "ok",
        "unipile_api_key_configured": bool(
            os.getenv("UNIPILE_API_KEY") or os.getenv("Unipile_Api_Key")
        ),
        "openrouter_api_key_configured": bool(
            os.getenv("OPENROUTER_API_KEY") or os.getenv("Open_Router_Api_Key")
        ),
    }


def unipile_account_in_path(endpoint_path: str) -> str | None:
    """Return the account id a path belongs to.

    None means the path is shared (account list or hosted sign-in).
    An empty string means the path is not one this workspace proxy allows.
    """
    if endpoint_path in {"accounts", "auth"} or endpoint_path.startswith("auth/"):
        return None
    parts = endpoint_path.split("/")
    resources = {"emails", "chats", "contacts", "messages", "users", "inboxes", "folders"}
    if endpoint_path.startswith("accounts/") and len(parts) >= 2 and parts[1]:
        return parts[1]
    if len(parts) >= 2 and parts[0] and parts[1] in resources:
        return parts[0]
    return ""


async def proxy_unipile(
    request: Request,
    version: str,
    endpoint_path: str,
    _credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
):
    if version not in {"v1", "v2"}:
        raise HTTPException(status_code=404, detail="Only Unipile API versions v1 and v2 are supported.")

    segments = endpoint_path.split("/")
    if (
        not endpoint_path
        or len(endpoint_path) > 2048
        or any(segment in {".", ".."} for segment in segments)
        or any("\\" in segment or any(ord(char) < 32 for char in segment) for segment in segments)
    ):
        raise HTTPException(status_code=400, detail="Invalid Unipile endpoint path.")

    api_key = os.getenv("UNIPILE_API_KEY") or os.getenv("Unipile_Api_Key")
    if not api_key:
        raise HTTPException(status_code=503, detail="The Unipile API key is not configured.")

    account_id = unipile_account_in_path(endpoint_path)
    claim_header = request.headers.get("x-unipile-account-claim") == "1"
    claiming_new_account = (
        claim_header
        and request.method == "GET"
        and endpoint_path.startswith("accounts/")
        and account_id not in (None, "")
    )
    if account_id == "":
        raise HTTPException(status_code=404, detail="This inbox path is not available for the active workspace.")
    if endpoint_path == "accounts" and request.method != "GET":
        raise HTTPException(status_code=404, detail="This inbox path is not available for the active workspace.")
    if account_id and not claiming_new_account and not unipile_account_allowed(account_id):
        raise HTTPException(status_code=404, detail="That connected account is not in this workspace.")

    encoded_path = "/".join(quote(segment, safe="-._~:@!$&'()*+,;=%") for segment in segments)
    upstream_url = f"{unipile_base_url()}/{version}/{encoded_path}"
    headers = {
        key: value
        for key, value in request.headers.items()
        if key in FORWARDED_REQUEST_HEADERS
    }
    headers["X-API-KEY"] = api_key

    client: httpx.AsyncClient = request.app.state.unipile_client
    try:
        upstream_request = client.build_request(
            request.method,
            upstream_url,
            params=request.url.query,
            headers=headers,
            content=await request.body(),
        )
        upstream_response = await client.send(upstream_request, stream=True)
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Unipile request timed out.") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Could not reach the Unipile API.") from exc

    if endpoint_path == "accounts" and request.method == "GET":
        body = await upstream_response.aread()
        await upstream_response.aclose()
        if upstream_response.status_code != 200:
            return JSONResponse(
                {"detail": "Connected accounts could not be loaded."},
                status_code=upstream_response.status_code,
            )
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Connected accounts returned an unexpected response.") from exc
        items = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(items, list):
            ids = [
                item.get("id")
                for item in items
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            ]
            allowed = filter_unipile_accounts(ids)
            payload["data"] = [
                item for item in items
                if isinstance(item, dict) and item.get("id") in allowed
            ]
        return JSONResponse(payload, status_code=upstream_response.status_code)

    response_headers = {
        key: value
        for key, value in upstream_response.headers.items()
        if key in FORWARDED_RESPONSE_HEADERS
    }
    response_headers["Cache-Control"] = "no-store"
    return StreamingResponse(
        upstream_response.aiter_raw(),
        status_code=upstream_response.status_code,
        headers=response_headers,
        background=BackgroundTask(upstream_response.aclose),
    )


for method in SUPPORTED_METHODS:
    app.add_api_route(
        "/{version}/{endpoint_path:path}",
        proxy_unipile,
        methods=[method],
        name=f"proxy_unipile_{method.lower()}",
        operation_id=f"proxy_unipile_{method.lower()}",
    )

from __future__ import annotations

import hmac
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

from app.crm import initialize_database, router as crm_router

LOCAL_HOSTS = {"localhost:8001", "127.0.0.1:8001"}
LOCAL_ORIGINS = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8001",
    "http://127.0.0.1:8001",
}
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


@app.middleware("http")
async def enforce_local_access(request: Request, call_next):
    host = request.headers.get("host", "").lower()
    if host not in LOCAL_HOSTS:
        return JSONResponse(
            {"detail": "This bridge is available on localhost only."},
            status_code=403,
        )

    origin = request.headers.get("origin")
    if origin and origin not in LOCAL_ORIGINS:
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

    return await call_next(request)


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

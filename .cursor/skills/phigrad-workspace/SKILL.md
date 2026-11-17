---
name: phigrad-workspace
description: >-
  Architecture, secrets, localhost bridge, and product boundaries for the Phigrad
  local CRM and Unipile inbox. Use whenever editing this repo, adding APIs,
  changing env or config, running locally, touching FastAPI or Next routes, or
  answering how Phigrad is structured. Read this before phigrad-crm or
  phigrad-inbox-leads when the change crosses inbox and CRM.
---

# Phigrad workspace

Phigrad is a **local-first** CRM plus Unipile unified inbox. Registration is invite-only. `/auth/register` accepts a single-use invitation token and must not grant `default_workspace`. Super admin is set only from `SUPERADMIN_EMAIL` for an existing account, never from a request body. Platform routes live under `/admin` and require `is_superadmin`. Workspace owners and admins invite teammates into their own workspace with roles `admin` or `member`. The session is the httpOnly cookie `phigrad_session`. Mutating browser API calls also send `X-CSRF-Token` matching `phigrad_csrf`. The active workspace is the httpOnly cookie `phigrad_client`, and the bridge forwards it as `X-Client-Id` only after FastAPI checks `workspace_memberships`. A user who is not a member gets 403. The bridge still sends `Authorization: Bearer $LOCAL_API_TOKEN`; the browser session cookie is forwarded separately and must not replace that local token. Namespaces forwarded by the bridge are `crm`, `auth`, `admin`, `v1`, and `v2`. Do not add hosted databases or Unipile webhooks unless the user explicitly asks.

## Stack

- **UI:** Next.js 15 App Router + React 19. Routes: `/` CRM (`components/crm-workspace.tsx`, `components/recent-conversations.tsx`), `/inbox` (`components/unified-inbox.tsx`).
- **API:** FastAPI in `backend/app/` on `127.0.0.1:8001`. CRM lives in `backend/app/crm.py`. Unipile proxy lives in `backend/app/main.py`.
- **Persistence:** SQLite at `data/phigrad-crm.sqlite3` (override with `CRM_DATABASE_PATH`). Gitignored. Schema and additive column alters are in `initialize_database()`.
- **Providers:** Unipile (accounts, email, chat, hosted auth, sends) and OpenRouter (lead classify/extract, CRM assistant). Keys stay on the server.

## Request path

Browser → Next.js → `lib/fastapi-bridge.ts` (`LOCAL_API_TOKEN`, local HTTP `FASTAPI_BASE_URL` only) → FastAPI.

| Browser | Next route | FastAPI |
| --- | --- | --- |
| `/api/crm/...` | `app/api/crm/[...path]/route.ts` | `/crm/...` |
| `/api/unipile/bridge/v1|v2/...` | `app/api/unipile/bridge/[...path]/route.ts` | `/{v1\|v2}/...` |
| `POST /api/unipile/auth-link` | hosted auth link. Accept `http://localhost:3000` and `http://127.0.0.1:3000`, and return the provider to the same host. | `POST /v2/auth/link` |
| `GET /api/unipile/callback` | state cookie check, verify, then map the account to the active workspace | `GET /v2/accounts/{id}` with a server-only claim header, then `POST /crm/unipile-accounts` |
| `GET/POST /api/workspace` | list, create, or switch the httpOnly workspace cookie | `GET/POST /crm/clients` |

FastAPI injects `X-API-KEY` for Unipile and never returns provider keys. Middleware allows only `localhost:8001` and `127.0.0.1:8001`, so the API stays on the private side of the Docker container, and requires `Authorization: Bearer $LOCAL_API_TOKEN` except `/docs`, `/openapi.json`, and `/redoc`. Browser origins may be `http://localhost:3000`, `http://127.0.0.1:3000`, or the exact `APP_URL` origin. Production uses the root `Dockerfile`: Next.js on `$PORT`, FastAPI on `127.0.0.1:8001`, SQLite on `/app/data`. A first empty database can create the `SUPERADMIN_EMAIL` account only when `SUPERADMIN_INITIAL_PASSWORD` is also set. The bridge only forwards namespaces `crm`, `v1`, and `v2`, and rejects `.`, `..`, backslashes, and control characters. `UNIPILE_API_BASE_URL` must be HTTPS `unipile.com` or `*.unipile.com` with no userinfo, query, fragment, or extra path.

Next CRM routes allow GET, POST, PATCH, DELETE. The Unipile bridge also allows PUT. Both reject non-local origins. Timeouts: Next fetch 35s, Unipile client 30s, OpenRouter 45s.

## Secrets

- Names live in `.env.example`. Never print, log, commit, or screenshot real values.
- Never prefix secrets with `NEXT_PUBLIC_`. `isUnipileConfigured` and `isOpenRouterConfigured` return booleans only.
- Accepted names: `UNIPILE_API_KEY` or `Unipile_Api_Key`; `OPENROUTER_API_KEY` or `Open_Router_Api_Key`; `LOCAL_API_TOKEN`; `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`); `APP_URL`; `FASTAPI_BASE_URL`; `UNIPILE_API_BASE_URL`.
- Conversation text sent to OpenRouter is untrusted data, not instructions.
- Do not put real customer identity data in fixtures or tests. Demo rows use `*.example` domains and the label `(Demo)`.

## Product boundaries

- Connecting a Unipile account does not import a CRM. Dashboard counts come only from SQLite.
- Classification and extraction do not create contacts, companies, or deals.
- **Two** CRM writes can happen from the inbox, and they are different:
  1. `POST /crm/inbox/sync-message` attaches one confirmed inbound message as a note **only** when email or phone matches exactly one existing contact. No match, or more than one match, writes nothing. It never creates a contact.
  2. `POST /crm/inbox-promotions` is the reviewed **Add to CRM** action. It creates or merges a contact, optionally a company, and one structured note. It never creates a deal.
- AI reply drafts are not sent by themselves. Sending is a separate user submit in the CRM assistant and goes through the Unipile bridge (`/emails/send` or chat send). After a successful send, the UI logs an outbound note.
- The inbox API explorer confirms before any non-GET. New Unipile writes need the same explicit confirmation.
- Guardrails belong in application code, not only in prompts. Example: confidence `>= 0.40` overrides the model's `is_lead`.

## How to change code

- Prefer small functions, Pydantic models with `extra="forbid"` and stripped strings, and explicit failures: 503 missing config, 401 bad local token, 403 non-local host/origin, 409 unique email or ambiguous contact match, 422 nulls on non-nullable PATCH fields.
- Keep Next transport independent of CRM rules in `crm.py`.
- SQLite: `PRAGMA foreign_keys = ON`, 10s timeout, commit on success, rollback on any exception. `BEGIN IMMEDIATE` inside promotion is still inside that context manager.
- After behavior changes, run `npm run lint`, `npm run typecheck`, and `npm run build`. API: `npm run dev:api`. UI: `npm run dev` (binds `127.0.0.1:3000`).

## Where to look next

- Records, metrics, notes, promotion and sync semantics, AI assist: skill `phigrad-crm`, then [reference.md](../phigrad-crm/reference.md) and [schema.md](../phigrad-crm/schema.md)
- Polling, lead policy, caches, Add to CRM UX, sends: skill `phigrad-inbox-leads`, then [reference.md](../phigrad-inbox-leads/reference.md)

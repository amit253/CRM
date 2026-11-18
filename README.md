# Phigrad CRM and communications workspace

A local-first CRM with contacts, companies, a sales pipeline, follow-up tasks, private notes, a Unipile unified inbox, and OpenRouter-powered business-message classification.

## Run locally

1. Install Node.js 20.9 or newer and Python 3.10 or newer.
2. Install project dependencies with `npm install`. Create the backend environment if needed:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
   ```

3. Keep `.env` private. The server recognizes `UNIPILE_API_KEY` or `Unipile_Api_Key` for Unipile and `OPENROUTER_API_KEY` or `Open_Router_Api_Key` for AI. The default model is `openai/gpt-4o-mini`; override it with `OPENROUTER_MODEL`.
4. Configure `LOCAL_API_TOKEN` in `.env`. Never prefix any key or token with `NEXT_PUBLIC_`.
5. Start FastAPI and Next.js in separate terminals:

   ```powershell
   npm run dev:api
   npm run dev
   ```

6. Open `http://localhost:3000` for the CRM, or `http://localhost:3000/inbox` for the unified inbox. FastAPI docs are at `http://127.0.0.1:8001/docs`.

The Next.js server forwards app requests to FastAPI. FastAPI injects the Unipile API key server-side. The OpenRouter key is also read only by FastAPI and is never returned to the browser.

## CRM features

- **Overview:** contact/company counts, open sales count, upcoming follow-ups, recent contacts, and sales counts by stage without currency amounts.
- **Contacts:** create and edit business contacts, associate a company, maintain status/source, add private notes, and review linked sales and tasks.
- **Companies:** maintain company profiles and see related contact and open-deal counts.
- **Sales:** track opportunities across New, Qualified, Proposal, Won, and Lost stages, with close dates, contacts, and companies. Currency amounts are not shown or edited in the sales pipeline.
- **Tasks:** create and complete follow-ups linked to a contact and/or deal.
- **AI conversation assistant:** open **AI assistant** from the CRM sidebar or from a contact profile. A contact profile shows saved conversation history above the assistant; choose **Draft a follow-up**, **Quick summary**, or **What may be blocking the deal?** to load that history and focus the analysis. Linked deal and open-task details are also included as context. Review the text and explicitly confirm sharing before submitting it to OpenRouter. Results include business relevance, opportunity signal, summary, next step, and reply draft. The suggested next step can be saved as a linked task; reply drafts are never sent automatically.
- **Unified inbox:** `/inbox` reads supported email/chat data from connected Unipile accounts, labels conversations by provider, and checks for new messages about once a minute while the page is open. Newly observed inbound messages are classified by Anand-specific lead rules using OpenRouter; available chat history is included as context. A message classified as a lead at 40% confidence or higher is automatically sent for a second extraction request using the conversation and available sender metadata. Lead status and extracted details are shown in the inbox. Older conversations are classified only when requested, and extraction remains part of the manual **Add to CRM** flow. Before saving, users can check the edited email or phone against CRM contacts. Matching is case-insensitive for email and ignores phone formatting; a match blocks creating a contact, company, or lead note.
- The development API retains a sample-data endpoint for local testing, but the CRM UI does not display sample-data controls or labels.

Local CRM records are persisted in `data/phigrad-crm.sqlite3`, which is ignored by Git. When `DATABASE_URL` is set, the backend uses PostgreSQL instead; local SQLite remains the fallback when it is unset.

The overview numbers are calculated from the configured CRM database: **Contacts** counts non-archived contact rows; **Companies** counts company rows; **Open sales pipeline** counts sales not in Won or Lost; **Follow-ups** counts incomplete tasks, with the smaller number counting incomplete tasks whose due date is today or earlier. Stage totals include the number of sales in each stage, not their currency values. These figures do not read Gmail, Unipile conversations, or inbox messages.

## Deploy with Docker

The production image runs Next.js and FastAPI in one container. Next.js listens on the platform-provided `$PORT`; FastAPI listens only on `127.0.0.1:8001`, and the server-side bridge uses that local address by default. The browser never calls FastAPI directly. The FastAPI readiness check verifies the configured database as well as the process. Without `DATABASE_URL`, SQLite is stored at `/app/data/phigrad-crm.sqlite3`.

```powershell
docker build -t phigrad .
docker run --rm -p 3000:3000 --env-file .env -e PHIGRAD_ENV=production -e NODE_ENV=production -e APP_URL=http://127.0.0.1:3000 -v phigrad-data:/app/data phigrad
```

Do not commit `.env`. For a new empty database, set `SUPERADMIN_EMAIL` and `SUPERADMIN_INITIAL_PASSWORD`, sign in once, then remove the initial password. Set `APP_URL` to the public `https` origin and register `https://<your-host>/api/unipile/callback` with Unipile.

### Use Supabase Postgres on Render

1. In the Supabase project, click **Connect** and copy the **Session pooler** connection string, which Supabase documents as IPv4-compatible. Keep the password encoded in the connection string if it contains reserved URL characters.
2. In the Render service environment, set `DATABASE_URL` to that connection string. For an existing Blueprint service, add it manually under **Environment**; Render does not add new `sync: false` variables when syncing Blueprint updates. Keep it server-side; do not use it in a `NEXT_PUBLIC_` variable or browser code.
3. Redeploy. On startup, FastAPI creates the app tables and enables Row Level Security on them. The app connects server-side and performs its own workspace authorization; its tables have no public Supabase Data API policies.
4. The first empty Supabase database bootstraps `SUPERADMIN_EMAIL` using `SUPERADMIN_INITIAL_PASSWORD`. Sign in, then remove the initial password from Render.

Supabase starts with a new, empty database; existing SQLite records are not copied automatically. Local development still uses SQLite unless `DATABASE_URL` is set. The Render Blueprint no longer needs a persistent disk when `DATABASE_URL` points to Supabase. Lovable is a hosted app builder and is not the runtime for this Next.js and FastAPI image.

### Deploy with Railway and Supabase

1. Deploy the GitHub branch selected in the Railway service. Railway detects the root `Dockerfile` automatically.
2. Add these Railway variables:
   - `DATABASE_URL`: the Supabase Session Pooler connection string (port `5432`).
   - `LOCAL_API_TOKEN`: a long random secret shared by Next.js and FastAPI inside the container.
   - `APP_URL`: the public HTTPS origin, for example `https://<service>.up.railway.app`.
   - `PHIGRAD_ENV=production`.
   - `SUPERADMIN_EMAIL`; set `SUPERADMIN_INITIAL_PASSWORD` only while bootstrapping an empty database, then remove it after first sign-in.
   - `UNIPILE_API_KEY` for Gmail/LinkedIn. `UNIPILE_API_BASE_URL` defaults to `https://api.unipile.com`.
   - `OPENROUTER_API_KEY` for AI features. `OPENROUTER_MODEL` defaults to `openai/gpt-4o-mini`.
   - For invitation email delivery, configure `SMTP_HOST`, `SMTP_USERNAME`, and `SMTP_PASSWORD`; `SMTP_PORT` defaults to `587`, `SMTP_USE_TLS` defaults to `true`, and `SMTP_FROM` is optional.
   - `FASTAPI_BASE_URL` normally needs no override; the image defaults to `http://127.0.0.1:8001`. Do not point it at the public Railway domain or another service while using this single-container setup.
   - `DATABASE_POOL_MIN_SIZE` and `DATABASE_POOL_MAX_SIZE` are optional tuning settings; defaults are `1` and `4`. `DATABASE_POOL_TIMEOUT` defaults to `8` seconds.
3. Set the service health check path to `/api/health`. It now checks FastAPI and performs a lightweight database query. On first startup, the app initializes its tables in Supabase.

This branch omits Docker's `VOLUME` instruction because Railway manages persistent storage through service volumes. With Supabase configured, the app does not need a Railway volume. If you choose SQLite instead, attach a Railway volume mounted at `/app/data`; without it, SQLite data is ephemeral.

## Important boundaries

- Accounts are invite-only. CRM records are scoped by workspace in the configured database (SQLite locally or PostgreSQL when `DATABASE_URL` is set). There is no automated Unipile webhook; inbox sync still runs while the inbox page is open.
- CRM contacts, companies, sales, tasks, notes, dashboard counts, and demo records come from the configured database. Connecting Gmail or another Unipile account does not import it into CRM; the inbox and CRM are separate.
- The app does not automatically import messages into CRM records. Classification and extraction do not create CRM records. Use **Add to CRM** on a conversation classified as a lead to review and edit the extracted contact/opportunity fields, optionally check for an existing contact, then manually save a contact, an optional company, and a structured lead note. The server checks again during save and blocks the whole promotion if the email or phone already exists. Sales are never created by this action.
- Provider API availability and granted permissions determine which inbox data is available. Review provider permissions if an inbox cannot sync.
- Automatic inbox lead classification sends newly observed inbound conversation text (at most 12,000 characters per request) to OpenRouter about once a minute while `/inbox` is open. If classified as a lead with confidence >= 0.40, a second automatic request sends the same conversation text and available sender name/email/phone metadata for detail extraction. The inbox displays the lead result and whether extraction succeeded. The first inbox sync seeds current messages as existing and does not submit that backlog. Earlier conversations remain opt-in through **Classify as lead**, followed by detail extraction from **Add to CRM**. Classification and extraction results are cached in browser local storage (including extracted contact details) to support the inbox display and avoid unnecessary repeat analysis. Do not use shared browser profiles for sensitive inboxes. Neither classification nor extraction changes CRM records until the user reviews and saves. OpenRouter/model-provider data handling and retention still apply. Never commit `.env`.
- Lead classification uses confidence alone: confidence >= 0.40 is a lead, even if the model's `is_lead` field says false; below 0.40 is not a lead, even if that field says true. The API response explains when the confidence rule overrides the model's binary result. The CRM API independently rejects promotions without a lead classification; users must still review every extracted field before saving.
- Recent inbox analysis is performed one conversation at a time. Email history is limited to the email messages returned with the recent inbox listing; chat history uses the provider message endpoint. Provider permissions and available fields affect what can be reviewed. Analysis results are suggestions and should be checked before being saved as follow-up tasks.
- Automatic checks run only in an open inbox tab; they stop while the tab is hidden and when the page closes. They use polling rather than a server-side webhook and can miss messages outside the provider's recent-list window. CRM updates always require a separate manual action.
- Before customer deployment, add customer authentication, tenant-scoped authorization, server-hosted storage, secure account ownership, audit/retention controls, backups, rate limits, and production monitoring.
- Configure `APP_URL` to the exact public origin when deploying, and add that callback URL to the Unipile Hosted Auth configuration if required.

## Checks

Run `npm run lint`, `npm run typecheck`, and `npm run build`.

## FastAPI APIs

CRM endpoints are under `/crm/...` and use the local authenticated FastAPI service and configured database. The inbox reads connected accounts, email lists, chat lists, and individual chat message lists. The generic API explorer supports published Unipile paths under `/v1/...` and `/v2/...`; it does not hand-write a wrapper for every provider endpoint. Check Unipile's reference docs for exact schemas, provider-specific availability, permissions, and required fields.

`POST /crm/contacts/check-duplicate` accepts an email and/or phone and returns matching CRM contacts. Email matching is case-insensitive; phone matching compares digits only. Inbox promotion also performs this check atomically and returns HTTP 409 without writing a company, contact, or note when a duplicate is found.

The inbox API examples include:

- `GET /v2/accounts` lists accounts linked to this Unipile application.
- `GET /v2/{account_id}/emails` lists email.
- `GET /v2/{account_id}/contacts` lists provider contacts.
- `GET /v2/{account_id}/chats` lists chats where supported. LinkedIn uses its inbox list and inbox-chat endpoints.
- `GET /v2/{account_id}/chats/{chat_id}/messages` lists chat messages.

Unipile write operations can send, edit, or delete real data and require confirmation. Check provider support and permissions before relying on an endpoint.

## References

- [Unipile Hosted Authentication](https://developer.unipile.com/v2.0/docs/authenticate-with-hosted-auth)
- [Unipile Create Auth Link reference](https://developer.unipile.com/v2.0/reference/createauthlink)
- [Unipile API reference](https://developer.unipile.com/v2.0/reference)
- [OpenRouter API documentation](https://openrouter.ai/docs/api-reference/overview)

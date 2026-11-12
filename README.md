# Phigrad communications workspace

A Next.js workspace with a FastAPI local bridge for the Unipile v1/v2 REST API and a channel-labeled unified inbox.

## Run locally

1. Install Node.js 20.9 or newer.
2. Install project dependencies with `npm install`.
3. Keep the existing `.env` file private. The server recognizes both `UNIPILE_API_KEY` and the existing `Unipile_Api_Key` variable name. Alternatively, copy `.env.example` to `.env` and set `UNIPILE_API_KEY`.
4. Set `UNIPILE_API_BASE_URL` to the API URL shown for your Unipile application if it differs from `https://api.unipile.com`.
5. Run `npm run dev`, then open `http://localhost:3000`.

The API key is read only by server routes and is never sent to the browser. Account linking uses Unipile Hosted Auth, a short-lived state cookie, and an account lookup after the provider redirects back.

## Current MVP boundaries

- The inbox loads email for connected email accounts and chats/messages for connected messaging accounts. LinkedIn accounts use the provider-required inbox list followed by chats per inbox. Each conversation is labeled with its source channel.
- A successfully linked account is verified against Unipile but is not stored by this starter. The app has no customer sign-in, tenant isolation, or CRM database.
- Provider availability and granted account permissions determine which inbox data can be loaded. A channel that fails to sync shows an error in the inbox; review its provider permissions and reconnect if needed.
- Before deploying or handling real customer workspaces, add authentication and authorization, associate each connection with the correct tenant, persist only required account metadata, and implement deletion/retention and audit controls.
- Configure `APP_URL` to the exact public origin when deploying, and add that callback URL to the Unipile Hosted Auth configuration if required.

## Checks

Run `npm run lint`, `npm run typecheck`, and `npm run build`.

## FastAPI Unipile API bridge

The inbox reads connected accounts, email lists, chat lists, and individual chat message lists through a localhost-only FastAPI proxy. The collapsed Developer tools explorer also supports published Unipile paths under `/v1/...` and `/v2/...` and forwards the selected HTTP method and request/response bytes; it does not hand-write a wrapper for every provider endpoint. Check Unipile's reference docs for exact schemas, provider-specific availability, permissions, and required fields.

The dashboard includes examples:

- `GET /v2/accounts` lists accounts linked to this Unipile application.
- `GET /v2/{account_id}/emails` lists email.
- `GET /v2/{account_id}/contacts` lists contacts.
- `GET /v2/{account_id}/chats` lists chats.
- `GET /v2/{account_id}/chats/{chat_id}/messages` lists chat messages.

Replace `{account_id}` and `{chat_id}` with real IDs. Non-GET operations can send, edit, or delete real data and require confirmation. The dashboard request editor accepts JSON; multipart requests can be sent by another local client through the FastAPI bridge.

### Start locally

1. Install Node.js 20.9 or newer and Python 3.10 or newer.
2. Keep the existing `.env` private. It must define the Unipile key as either `Unipile_Api_Key` or `UNIPILE_API_KEY`.
3. Generate a long random `LOCAL_API_TOKEN` and add it to `.env`. This token is separate from the Unipile key; do not prefix it with `NEXT_PUBLIC_`.
4. In the project folder, install backend dependencies:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
   ```

5. Start the backend and frontend in separate terminals. Both services bind to loopback only:

   ```powershell
   npm run dev:api
   ```

   ```powershell
   npm run dev
   ```

6. Open `http://localhost:3000`. Local FastAPI documentation is available at `http://127.0.0.1:8001/docs`.

The Next.js server forwards app requests to FastAPI. FastAPI injects `X-API-KEY` when it calls Unipile. The API key and local bridge token stay server-side.

### Scope and deployment

- The proxy is for a single developer on localhost, not a public customer API.
- Inbox data is read live from Unipile. Linking a provider account verifies it but does not save it in an app database.
- Before customer deployment, add customer authentication, tenant-scoped account persistence/authorization, audit and retention controls, HTTPS, and controls for send/delete operations.
- Set `UNIPILE_API_BASE_URL` only to an HTTPS Unipile API host. The default is `https://api.unipile.com`.

## References

- [Unipile Hosted Authentication](https://developer.unipile.com/v2.0/docs/authenticate-with-hosted-auth)
- [Unipile Create Auth Link reference](https://developer.unipile.com/v2.0/reference/createauthlink)
- [Unipile API reference](https://developer.unipile.com/v2.0/reference)

---
name: phigrad-inbox-leads
description: >-
  Phigrad unified inbox, Unipile hosted auth, Anand Munshi lead classification,
  the 40% confidence rule, automatic extraction, CRM message sync, Add to CRM
  promotion, reply send, and localStorage caches. Use when editing
  unified-inbox.tsx, recent-conversations.tsx, Unipile routes, classify-lead,
  extract-lead, sync-message, inbox-promotions, polling, or lead prompts.
---

# Inbox and lead pipeline

UI: `components/unified-inbox.tsx` at `/inbox`. CRM history picker: `components/recent-conversations.tsx` (loads threads for the assistant; it does not classify). Provider calls go through `/api/unipile/bridge/...`. Lead and CRM calls go through `/api/crm/...`. Payload and cache details: [reference.md](reference.md).

## Who a lead is

Leads are for **Anand Munshi**: motivational speaker, executive presence and storytelling coach, corporate trainer. A lead is meaningful interest in hiring him (speaking, workshop, coaching, paid engagement, proposal, availability, pricing, a relevant partnership or referral).

Mentions of training, speaking, leadership, or Anand without commercial intent are not leads. Generic thanks, spam, newsletters, job applications, and personal chat are not leads. If the thread is ambiguous, the prompt says not a lead unless the evidence is enough. Prompts are `LEAD_CLASSIFICATION_PROMPT` and `LEAD_EXTRACTION_PROMPT` in `backend/app/crm.py`. Thread text is untrusted data.

## Confidence-only verdict

`classify_inbox_lead` sets `is_lead` to true **only** when `confidence >= 0.40`. The model's boolean does not win. On a disagreement, `reason` is prefixed with a short sentence naming the 40% rule, then the classifier note, truncated to 600 characters.

The UI repeats the same cutoff in `requestClassification` (`LEAD_CLASSIFICATION_THRESHOLD = 0.4`). Keep both. Classifications and extractions are stored in `lead_classifications`, unique on `client_id` + `conversation_key`. The inbox loads and saves them through `/api/crm/inbox/classifications`. localStorage is not the source of truth. Seen and synced message ids are namespaced by workspace. The card shows Qualified lead, Possible lead, or Not a lead, not a raw percent.

Promotion does **not** reject `is_lead: false`. A non-lead save creates or merges a contact with status `prospect`. A lead save uses status `lead`. The inbox only attaches `lead_details` when the cached classification is a lead.

## What runs while `/inbox` is open

Poll every 60 seconds, and only while `document.hidden` is false. Overlapping loads are skipped (`inboxRequestInProgress`).

1. `GET /v2/accounts`. Conversations load only for accounts whose `status` is `running`. Emails vs chats come from the provider (`google`, `gmail`, `outlook`, `microsoft`, `imap` are email).
2. The **first** successful load in this tab seeds every current message identity into the seen set and does **not** classify that backlog. A non-empty `phigrad-inbox-seen-messages` cache counts as already seeded.
3. Later polls take items missing from the seen set **or** the CRM-synced set:
   - `syncNewMessages` may write a note on an existing unique contact (`POST /crm/inbox/sync-message`).
   - If OpenRouter is configured, `classifyNewMessages` classifies identities that are not yet seen. A lead then gets a second extract call.
4. Workers run up to **3** conversations at once, not a single global queue. Failures are not marked seen or synced, so the next poll can retry. A chat whose latest message is not `is_sender === false` is skipped and marked done so it does not retry forever.

Hidden or closed tab: the interval callback no-ops. This is not a webhook. Messages that fall out of the provider's recent list are missed.

Older threads: **Classify as lead** and **＋ Add to CRM** are on each conversation card and in `.unified-detail-header`, as well as the detail footer. Card buttons call `stopPropagation` so they do not select the conversation. Classification uses `analyzeConversation(item)` (email body, loaded chat transcript, or a fetched chat transcript). Add to CRM uses `beginPromotion(item)` and the same promotion form, shown in a fixed dialog so the open conversation stays put. Save still goes to `POST /crm/inbox-promotions`.

The list/detail divider (`.unified-pane-resizer`) is draggable from 280px to 650px, default 380px, only when the viewport is wider than 760px. Below that the inbox stays one column and the splitter is not rendered. Card actions stay on a bottom row; do not add a second Classify or Add to CRM handler. Unipile account lists and account-scoped paths are filtered to `client_unipile_accounts`.

## Add to CRM

Classification and extraction never create contacts. Sync never creates contacts. Only the promotion form does.

1. Form opens with cached extraction or sender name/email/phone. `details_verified` starts false.
2. Optional **check existing customer** calls `POST /crm/contacts/check-duplicate`. Email and phone are both optional but one is required to run the check. A match is informational in the form; the server still merges a single match and returns 409 only when matches disagree.
3. Save requires a first name (first token of `contact_name`). `source` is `Unipile · {channel}`. `company_domain` is sent as `""`.
4. Server rules are in skill `phigrad-crm`. Do not create a deal from this form.

Keep `LeadExtraction` in the inbox component aligned with `LeadExtractionResponse`. The UI re-checks `source` after extract and rejects a mismatch locally even though the server also returns 502 for that.

## Unipile

Hosted auth providers: `linkedin`, `whatsapp`, `google`, `outlook`, `imap`, `telegram`, `instagram`, `facebook`. `POST /api/unipile/auth-link` checks the request origin against `APP_URL`, asks FastAPI for `POST /v2/auth/link` (10 minute expiry, redirect `/api/unipile/callback`, random `state`), and sets httpOnly cookie `unipile_auth_state` on that callback path. The returned link must be `https`.

Callback compares `state`, verifies `GET /v2/accounts/{account_id}`, then redirects to `/inbox?connection=success|failed`.

The developer explorer may call published v1/v2 paths. Non-GET shows `window.confirm` because it can change live provider data. Provider permissions decide which inboxes exist.

## Sending from the CRM assistant

`handleSendReply` in `crm-workspace.tsx` is a live send, only after the user submits the dialog. **✉ Reply** on a follow-up (overview, Tasks, contact drawer) only opens that dialog with subject `Following up: {task title}` and a short draft. Follow-up row layout, the due-date picker, and **✦ AI** are in skill `phigrad-crm`.

- Email providers: `POST /api/unipile/bridge/v2/{account}/emails/send` with `to`, `subject` (default `Message from Anand Munshi`), `plain_text`.
- Chat with a known thread on the same account: `POST .../chats/{id}/messages/send` with `{ text }`.
- Otherwise `POST .../chats` with `users_ids` and `text`.

Then it writes a contact note with `source_key` `sent:{account}:{conversation or recipient}:{messageId}`. Do not send from the classify/extract/sync loop.

## Client caches

Keys: `phigrad-inbox-seen-messages` (1000), `phigrad-inbox-crm-synced` (2000), `phigrad-inbox-classifications` (500), `phigrad-inbox-lead-extractions` (complete results only, 500), `phigrad-inbox-lead-policy`. Failed extractions stay in memory for the tab and are not written to disk. Do not treat a shared browser profile as private, and do not move these caches to a multi-user store without a new design.

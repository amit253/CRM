# Inbox behavior reference

Read this when changing polling, identity keys, extraction enums, the promotion form, or Unipile list parsing. Product rules stay in `SKILL.md`.

## Identity and item shape

Seen and synced sets use `accountId:kind:messageIdentity`.

`messageIdentity` is the provider id when one exists (email `id`, otherwise chat `last_message.id`, `last_message_id`, or `message_id`). With no id it is `{timestamp}:{fingerprint(content)}`, an FNV-1a style hash of the body or preview. Changing this function makes the next poll treat the visible window as new.

`item.key` is `accountId:kind:conversationId`. Classifications and extractions use that key, so a newer message in the same thread replaces the previous result. Seen and synced sets use the message identity, so a new message still enters the poll.

Email `inbound` is false when `is_sender` or `is_sent` is true, `direction` is `sent` or `outgoing`, or `folder` contains `sent`. Chat `inbound` on the listing is true only when `last_message.is_sender === false`. Automatic classify and sync still reload chat messages and require that same flag on the latest message.

Email conversation text for automatic classify is the listing body (`item.content`). Chat text is up to 50 messages, oldest first, labeled `Anand:` or `{sender}:`. Manual classify uses the same email body, or the chat messages already shown in the thread pane.

Extract always receives `source` from `leadSource(channel)`:

| Channel contains | source |
| --- | --- |
| linkedin | `linkedin` |
| whatsapp | `whatsapp` |
| instagram | `instagram` |
| email, gmail, outlook, imap | `email` |
| phone | `phone` |
| website | `website` |
| anything else | `other` |

Sender metadata on extract: display name, `senderEmail`, `senderPhone` parsed from the listing. The server copies those into empty extraction fields. The promotion form copies them again if the model left them empty.

## Poll sequence

`loadInbox(false)` on mount after reading caches. `loadInbox(true)` on the 60s timer.

`checkForNewMessages` candidates:

```
identity not in seen OR identity not in synced
```

So a seeded backlog is not classified, but the next poll can still sync it onto an existing contact. New mail is both classified and synced.

Sync skips (and marks synced) when:

- the item is not inbound
- chat history has no confirmed counterpart message (`is_sender !== false`)
- body or message id is empty after that lookup

Sync does **not** mark synced when the HTTP call fails or when the API returns `synced: false` (`contact_not_found`, `ambiguous_contact_match`). Those retry next poll. `synced: true` (including duplicates) is marked.

Classify skips (and marks seen) when the chat latest message is not from the other person, the item is not inbound, or text is shorter than 10 characters. OpenRouter errors are not marked seen.

Both loops use three async workers over a shared index. Do not raise that casually; each worker can call Unipile and then OpenRouter.

Account listing errors are per account and do not wipe other channels. The selected conversation is kept if its key is still in the new list.

## localStorage

| Key | Value |
| --- | --- |
| `phigrad-inbox-seen-messages` | JSON string array, last 1000 identities |
| `phigrad-inbox-crm-synced` | JSON string array, last 2000 identities |
| `phigrad-inbox-classifications` | Entries `[itemKey, Classification]`, last 500 |
| `phigrad-inbox-lead-extractions` | Entries `[itemKey, LeadExtraction]` for `status: "complete"` only |
| `phigrad-inbox-lead-policy` | `anand-leads-v3-confidence-only-0.4` |

`Classification`: `is_lead`, `confidence`, `reason`, `source` (`automatic` \| `manual`), `classified_at`.

If the policy key mismatches, classifications and extractions are removed and the new policy is stored. Seen and synced keys are kept.

Quota failures surface a banner. Seen-state failure can cause repeat classification after reload. Sync-state failure is safe because `source_key` is unique in SQLite; the UI warning says duplicate checks fall back to the database.

## Promotion request

Built in `submitPromotion`:

```json
{
  "first_name": "first token",
  "last_name": "remaining tokens",
  "email": "",
  "phone": "",
  "role": "",
  "company_name": "",
  "company_domain": "",
  "source": "Unipile · Gmail",
  "note": "channel, title, timestamp, transcript (max 12000)",
  "channel": "",
  "account_id": "",
  "conversation_id": "",
  "conversation_kind": "email",
  "message_id": "",
  "message_timestamp": "",
  "details_verified": false,
  "classification": null,
  "lead_details": null
}
```

`classification` is the cached object without `source` and `classified_at`. `lead_details` is the form when that classification is a lead, otherwise null. `details_verified` is the checkbox; unchecked means the server lists every filled extraction field as unverified.

`promotionExtractionRun` drops late extract responses after the user closes or reopens the form.

Duplicate-check UI stores the email and phone that were checked plus `matches`. It does not block submit. Ambiguous server matches come back as 409 and `crmRequestError` should show `detail.message` when `detail` is an object.

## Extraction enums

`service_interest`: `executive_coaching`, `executive_presence`, `storytelling_communication`, `corporate_training`, `leadership_workshop`, `keynote_speaking`, `event_speaking`, `professional_development`, `coaching_programme`, `other`, `unclear`.

`lead_intent`: `inquiry`, `availability_request`, `pricing_request`, `proposal_request`, `meeting_request`, `speaking_request`, `training_request`, `coaching_request`, `partnership`, `referral`, `other`.

`urgency`: `high`, `medium`, `low`, `unknown`. `decision_maker`: `yes`, `no`, `unknown`.

`lead_stage` (extraction only, not the deal pipeline): `new`, `contacted`, `discovery_call_booked`, `qualified`, `proposal_sent`, `follow_up`, `negotiation`, `won`, `lost`, `nurture`.

Prompt rules that the code does not re-check: do not invent facts; `decision_maker: yes` only with evidence; do not use late stages without evidence; `next_action_date` is an ISO date only when stated. `summary` max 1,200 on the model. If you change the prompt's allowed values, change the Pydantic literals and the TypeScript type in the same edit.

## CRM assistant inbox loader

`recent-conversations.tsx` lists running accounts, then up to 10 recent threads per account, and returns a transcript plus metadata (`channel`, `kind`, `accountId`, `conversationId`, `recipientEmail`, `subject`). The parent uses that metadata so a later send can reply inside the same chat. Nothing in this component calls classify, extract, sync, or promotion.

## Hosted auth failure modes

Auth-link returns 403 on origin mismatch, 400 on an unknown provider, and 502 when FastAPI or Unipile fails or the link is not HTTPS. Callback redirects to `/inbox?connection=failed` without clearing `unipile_auth_state` when the cookie and query `state` do not match. It clears the cookie on `error_type`, a missing `account_id`, a failed account check, and on success (`connection=success` plus `provider` when present). Do not log account payloads or the state value.

## Explorer examples

Default path `/v2/accounts`. Documented reads:

- `GET /v2/accounts`
- `GET /v2/{account_id}/emails`
- `GET /v2/{account_id}/contacts`
- `GET /v2/{account_id}/chats`
- `GET /v2/{account_id}/chats/{chat_id}/messages`

LinkedIn may need its own inbox paths; do not assume every provider implements `/chats`. Confirm provider docs before adding a new write.

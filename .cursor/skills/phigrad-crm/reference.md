# CRM HTTP API

FastAPI routes under `/crm`. Next forwards `/api/crm/<path>`. Models strip strings and reject unknown fields (`extra="forbid"`) on inputs.

## Summary and demo

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/crm/summary` | Counts, `pipeline_value`, stages `{stage, count, value}`, 5 recent contacts, 6 open tasks |
| GET | `/crm/demo-data` | `{ loaded, empty }` or loaded counts |
| POST | `/crm/demo-data` | Load `sample-v1` only when every CRM table is empty. 409 if any row exists. `{ already_loaded: true }` if demo is already present |
| DELETE | `/crm/demo-data` | Delete only ids stored for `sample-v1` |

## Contacts

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/crm/contacts` | Query `search` (max 120), `status`. Non-archived, newest `updated_at`, limit 500. Includes `company_name`, `open_tasks_count`, `total_tasks_count` |
| POST | `/crm/contacts` | 201. Default status `lead`. Tags max 20 |
| GET | `/crm/contacts/{id}` | Company `{id, name}`, deals, tasks (30), notes (100). `unverified_fields` parsed from JSON |
| PATCH | `/crm/contacts/{id}` | At least one field. `archived` allowed. `company_id` may be null |
| POST | `/crm/contacts/{id}/notes` | 201. See note fields below. Idempotent on `source_key` |
| POST | `/crm/contacts/check-duplicate` | `{ email?, phone? }` → `{ exists, matches }` |
| POST | `/crm/contacts/find-match` | Email/phone first, else name. `{ matched, contact }` |

Contact create/update limits: first name 1–100, last name 100, email 254, phone 50, title 150, source 80. Status: `lead`, `prospect`, `customer`, `partner`, `inactive`.

Duplicate match object: `id`, `name`, `email`, `phone`, `company_name` (check-duplicate only), `matched_fields` (`email` and/or `phone`).

## Companies, deals, tasks

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/crm/companies` | Search name, domain, industry. `contact_count` excludes archived. `open_deals` excludes won/lost |
| POST | `/crm/companies` | 201. Name 1–180 |
| PATCH | `/crm/companies/{id}` | No nullable fields |
| GET | `/crm/deals` | Includes `contact_name`, `company_name` |
| POST | `/crm/deals` | 201. Stage default `new`, amount default `0`, currency default `USD` |
| PATCH | `/crm/deals/{id}` | `contact_id`, `company_id`, `expected_close_date` may be null |
| GET | `/crm/tasks` | Query `completed`. Includes `contact_name`, `deal_title` |
| POST | `/crm/tasks` | 201. Priority default `medium` |
| PATCH | `/crm/tasks/{id}` | `completed` bool. `due_date`, `contact_id`, `deal_id` may be null |

Deal stages: `new`, `qualified`, `proposal`, `won`, `lost`. Amount `0`–`1e12`. Currency `^[A-Z]{3}$`. Task priorities: `low`, `medium`, `high`. Company notes and deal/task descriptions max 4,000.

## Notes

`POST /crm/contacts/{id}/notes` body:

| Field | Rule |
| --- | --- |
| `body` | Required, 1–8000 |
| `channel` | Optional, max 80 |
| `created_at` | Optional ISO. Invalid or missing becomes now |
| `source_key` | Optional, max 500. Unique when non-empty |
| `account_id` | Max 200 |
| `conversation_id` | Max 300 |
| `conversation_kind` | `email`, `chat`, or `""` |
| `message_id` | Max 300 |
| `unverified_fields` | String list, max 50 |

Response adds `duplicate` when `source_key` already existed. Returned row is the existing row in that case.

Prefixes in use:

- `unipile:` inbox sync
- `promotion:` Add to CRM
- `sent:` outbound send logged by the CRM assistant

## Inbox sync

`POST /crm/inbox/sync-message`. All ids required. `body` 1–12,000. `direction` default `inbound`.

| Outcome | Body |
| --- | --- |
| Outbound | `{ synced: false, reason: "outbound_message" }` |
| Source key exists | `{ synced: true, duplicate: true, contact_id, note_id }` |
| No email/phone match | `{ synced: false, reason: "contact_not_found" }` |
| 2+ matches | `{ synced: false, reason: "ambiguous_contact_match" }` |
| One match, inserted | `{ synced: true, duplicate: false, contact_id, note_id }` |

Does not create a contact, company, or deal. Phone compare uses digits only. Email compare is trimmed and lowercased.

## Inbox promotion

`POST /crm/inbox-promotions` returns 201.

Required: `first_name` (1–100), `source` (1–80), `note` (1–12,000). Optional classification (`is_lead`, `confidence` 0–1, `reason` 1–600) and `lead_details` (same object as extract). `details_verified` defaults false.

Success body:

```json
{
  "contact_id": "",
  "company_id": null,
  "contact_created": true,
  "company_created": false,
  "note_id": "",
  "merged": false,
  "duplicate_conversation": false,
  "is_lead": true
}
```

`is_lead` is null when no classification was sent. The UI sends classification only when that thread was classified, and sends `lead_details` only when `is_lead` is true.

409 body when email and phone hit different contacts (or otherwise more than one match):

```json
{
  "detail": {
    "code": "ambiguous_contact_match",
    "message": "The email and phone match different CRM contacts. Choose the correct contact before saving.",
    "matches": []
  }
}
```

Structured note JSON stored in `activities.body`:

```json
{
  "record_type": "inbox_conversation",
  "classification": null,
  "lead_details": null,
  "unverified_fields": [],
  "channel": "",
  "account_id": "",
  "conversation_id": "",
  "conversation_kind": "",
  "message_id": "",
  "conversation": ""
}
```

`crm-workspace.tsx` parses this with `structuredLeadNote`. Keep `record_type` and the key names stable or update that parser in the same change.

## Lead AI routes

| Method | Path | Input |
| --- | --- | --- |
| POST | `/crm/inbox/classify-lead` | `{ text }` 10–12,000 |
| POST | `/crm/inbox/extract-lead` | `{ text, source, sender_name, sender_email, sender_phone }` |
| POST | `/crm/ai/assist` | `{ text, contact_context, analysis_focus }` |

Classify response: `{ is_lead, confidence, reason }`. Server sets `is_lead` from `confidence >= 0.4` and, when that flips the model, prefixes `reason` with `Marked lead by the confidence-only 40% rule.` or `Marked not a lead by the confidence-only 40% rule.`

Extract: if the model returns a different `source` than the request, 502. Empty `email`, `phone`, or `contact_name` are filled from the request metadata when that metadata is non-empty. Allowed enums are on `LeadExtractionResponse` in `crm.py` and must match `LeadExtraction` in `unified-inbox.tsx`.

Assist response keys: `summary` (1200), `category` (80), `sentiment` (`positive|neutral|negative|mixed`), `next_step` (500), `suggested_reply` (3000), `business_relevance` (`business|not_business|unclear`), `business_reason`, `opportunity_status` (`opportunity|not_opportunity|unclear`), `opportunity_reason`.

## Errors

| Status | When |
| --- | --- |
| 400 | Empty PATCH, bad foreign key, invalid Unipile path on the proxy |
| 401 | Bad or missing `LOCAL_API_TOKEN` |
| 403 | Non-local Host or Origin |
| 404 | Unknown contact, company, deal, or task |
| 409 | Duplicate email, demo load into a non-empty database, ambiguous promotion match |
| 422 | Null sent for a non-nullable PATCH field, or Pydantic validation |
| 502 | OpenRouter or Unipile unreachable / bad payload |
| 503 | Missing `LOCAL_API_TOKEN`, Unipile key, or OpenRouter key |
| 504 | OpenRouter or Unipile timeout |

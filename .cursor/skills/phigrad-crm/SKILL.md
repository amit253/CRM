---
name: phigrad-crm
description: >-
  Phigrad local CRM schema, REST endpoints, dashboard metrics, demo data,
  contact notes, inbox sync and promotion, duplicate matching, and the
  OpenRouter conversation assistant. Use when changing contacts, companies,
  deals, tasks, notes, follow-up rows, due dates, Reply and AI pills,
  /crm APIs, crm-workspace.tsx, recent-conversations.tsx, AI assist, SQLite,
  or any code that creates or updates CRM rows.
---

# Phigrad CRM

Source of truth: `backend/app/crm.py`. UI: `components/crm-workspace.tsx`. Browser calls `/api/crm/...` only. Full route table: [reference.md](reference.md). Columns, indexes, demo dataset: [schema.md](schema.md).

## Entities

| Table | Role |
| --- | --- |
| `companies` | Name, domain, industry, website, size, notes |
| `contacts` | Person; optional `company_id`; status `lead` \| `prospect` \| `customer` \| `partner` \| `inactive`; email unique per `client_id` when non-empty |
| `deals` | Stages `new`, `qualified`, `proposal`, `won`, `lost`; optional contact and company. `amount` and `currency` are stored. The UI does not show currency totals |
| `tasks` | Follow-ups; priority `low` \| `medium` \| `high`; optional contact and deal |
| `activities` | Notes on a contact. Inbox sync, promotion, and sent replies store extra channel and source columns |
| `demo_datasets` | Tracks `sample-v1` ids so load/remove can target only those rows. The CRM UI must not show sample-data controls |

IDs are UUID strings. Timestamps are UTC ISO with seconds. Every CRM read and write uses `client_scope()` (`client_id`). Guessing another workspace's id returns 404. Existing rows stay on `default_workspace`. Deleting a contact nulls deal and task links and cascades notes. Deleting a company nulls contact and deal `company_id`.

Tags are a JSON array in `contacts.tags` (max 20 on write). `as_dict` parses tags and turns `archived` / `completed` into booleans.

## Dashboard

`GET /crm/summary` reads SQLite only:

- **Contacts:** `archived = 0`
- **Companies:** all rows
- **Open pipeline:** deals whose stage is not `won` or `lost`
- **Follow-ups:** incomplete tasks; the smaller due count is incomplete tasks with `due_date <= today` (server local date, ISO `YYYY-MM-DD`)
- Stage rows include `count` and a `value` sum. `pipeline_value` is also returned. Do not surface those currency figures in the CRM UI unless the user asks

Do not mix Unipile or inbox counts into these numbers. Lists cap at 500. Contact detail returns up to 30 tasks and 100 notes.

## Writes

- Models subclass `CRMInput`: strip strings, `extra="forbid"`. PATCH with no fields is 400. Null is 422 except nullable links (`company_id`, `contact_id`, `deal_id`, `expected_close_date`, `due_date` where that model allows them).
- Duplicate non-empty email on insert or update is HTTP 409. Missing foreign keys are 400. Unknown ids are 404.
- `POST /crm/contacts/check-duplicate` matches email case-insensitively and phone by digits only. Empty email and empty phone return no matches. Response: `{ exists, matches[] }` with `matched_fields`.
- `POST /crm/contacts/find-match` uses that same email/phone match first. If none, it matches a name of at least 2 characters against full name, first name, or last name (`COLLATE NOCASE`, `LIMIT 1`). The inbox UI does not call this route today.
- Manual notes: `POST /crm/contacts/{id}/notes`. Body 1–8000 chars. Optional `source_key` makes the insert idempotent (`INSERT OR IGNORE`). Response includes `duplicate: true` when the existing row was kept.

## Inbox → CRM (do not collapse these)

Promotion is not a generic contact create. Sync is not promotion. Neither creates a deal.

**Sync** `POST /crm/inbox/sync-message`:

- Outbound returns `{ synced: false, reason: "outbound_message" }` and writes nothing.
- Source key: `unipile:{account_id}:{kind}:{conversation_id}:{message_id}`.
- Existing key returns the existing note (`duplicate: true`).
- Otherwise email/phone must match **exactly one** contact. Zero matches → `contact_not_found`. Two or more → `ambiguous_contact_match`. Both write nothing.
- The note body is a plain-text header plus the message, capped at 12,000 characters. Contact `updated_at` is touched.

**Promotion** `POST /crm/inbox-promotions` (reviewed Add to CRM):

- Runs in `BEGIN IMMEDIATE`. More than one email/phone match → 409 `ambiguous_contact_match` and the whole transaction rolls back (no company, contact, or note).
- One match **merges**: fill only empty phone, email, title, and company; append the source string to tags if missing. Do not overwrite fields that already have values. `contact_created` is false and `merged` is true.
- No match inserts a contact. Status is `lead` when `classification.is_lead` is true, otherwise `prospect`.
- Non-empty company name reuses `name COLLATE NOCASE` or inserts a company (domain lowercased).
- Note `source_key` is `promotion:{account}:{kind}:{conversation}:{message}` when those ids are present. Body is JSON with `record_type: "inbox_conversation"`, plus `classification`, `lead_details`, `unverified_fields`, channel/account/conversation ids, and `conversation` (the reviewed note text).
- `details_verified: false` stores every non-empty `lead_details` key in `unverified_fields`. Verified promotions store `[]`.
- A repeated promotion with the same source key does not insert a second note (`duplicate_conversation`).

Field limits, the JSON shape, and response flags are in [reference.md](reference.md).

## AI conversation assistant

`POST /crm/ai/assist`. `text` is 10–12,000 characters. Optional `contact_context` ≤ 2,000. `analysis_focus`: `general` | `follow_up` | `quick_summary` | `deal_blockers`.

The UI must keep the consent checkbox before any OpenRouter call. `components/recent-conversations.tsx` loads up to 10 threads per connected account only after the user asks; choosing one fills the composer. It does not classify or extract.

Results are suggestions. `suggested_reply` is copied or sent only after the user submits the send dialog. Sending uses the Unipile bridge, then `POST /crm/contacts/{id}/notes` with `source_key` prefix `sent:`. If the provider send succeeds and the note fails, tell the user the message went out and the timeline did not.

Do not invent dates, blockers, or commitments. The `deal_blockers` focus must say when no linked deal or no evidence exists.

### Save a suggested next step

Both the assistant workspace (`.crm-ai-workspace-result`) and the contact drawer AI section show a due-date control beside **SUGGESTED NEXT STEP**.

- `<input type="date">` shares `followUpDueDate`. Initial value is tomorrow (`Date.now() + 24h`, UTC `YYYY-MM-DD`). `min` is today on the same UTC calendar. The user can pick any date from today forward before saving.
- **＋ Save as follow-up task** calls `POST /crm/tasks`. Title is `next_step` truncated to 180 characters. Description is `Suggested by AI after reviewing a conversation with {name}. Review before acting.` Priority is `medium`. `due_date` is the picker value. `contact_id` is the open contact drawer, otherwise the assistant's selected contact.
- The workspace button stays disabled until a contact is selected. The drawer already has that contact.
- On success the label becomes **✓ Saved to follow-ups** for 3.5 seconds, then returns to the save label. This does not send a message.

### Follow-up rows

Overview (**Upcoming follow-ups**), the Tasks list, and the contact drawer (**Follow-ups & tasks**) each render a task as three non-overlapping parts: checkbox, text, actions. Keep that split. Long titles and contact names truncate with ellipsis (`min-width: 0` on the text column). Action pills stay `flex-shrink: 0` and, in the overview, `margin-left: auto`. Do not put the title and the pills back in one unwrapped line; that is what made them collide in `.crm-followups-preview`.

| Surface | Classes | Reply / AI |
| --- | --- | --- |
| Overview | `.crm-task-preview` → `.crm-task-check`, `.crm-task-preview-copy`, `.crm-task-preview-actions` | Only when `task.contact_id` is set. Labels **✉ Reply** and **✦ AI** |
| Tasks | `.crm-task-row` → `.crm-task-check`, `.crm-task-copy`, priority, related name, due `<time>`, `.crm-task-actions` | Same gate. Labels **✉ Reply** and **✦ AI Help** |
| Contact drawer | `.crm-drawer-task-row` | Incomplete tasks only. Labels **✉ Reply** and **✦ AI** |

`.crm-task-check` is the complete/reopen control (green `.checked` state). A due date strictly before today's UTC `YYYY-MM-DD` on an open task gets the `.overdue` class (muted red, weight 600). Styles live in `app/globals.css`.

**✉ Reply** (`handleFollowUpReply`) opens the existing send dialog. It does not send by itself. Draft body is `Hi {first name or "there"}`, then `Following up regarding: {title}`, then a short close signed Anand. Subject is `Following up: {title}`. Recipient is that contact. After a successful send, the usual outbound note is written.

**✦ AI** (`handleFollowUpAI`) switches to the assistant view, selects `task.contact_id`, and fills the composer with the task title, description, due date, and contact name/company. It sets consent checked and clears any previous result. It does not call OpenRouter until the user clicks analyze. The pre-checked consent is only for this task context the user just asked to open.

OpenRouter: `https://openrouter.ai/api/v1/chat/completions`, temperature `0.2`, `response_format: json_object`, model from `OPENROUTER_MODEL`. Missing key → 503. Timeout → 504. Upstream or JSON failure → 502. Validate with `AIAssistResponse` (`extra` is not forbid on the response model, but unknown keys are ignored and missing required keys fail).

## Changing CRM safely

1. Change schema in `initialize_database()` with `CREATE TABLE IF NOT EXISTS` plus an `ALTER TABLE` only when `PRAGMA table_info` shows the column is missing. There is no migration framework.
2. Update the Pydantic model and the route in `crm.py` together. Keep enum values identical to the TypeScript unions in `crm-workspace.tsx` and `unified-inbox.tsx`.
3. Preserve human review for new contacts. Sync may attach a note to a contact that already exists; it must not start creating contacts.
4. Keep demo endpoints for local testing. Do not put demo buttons or labels back in the CRM UI.
5. Deal `currency` stays `^[A-Z]{3}$`, amount `>= 0`. Leave amount at `0` when the UI is not collecting it.

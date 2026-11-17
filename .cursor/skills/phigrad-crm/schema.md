# CRM schema

File: `data/phigrad-crm.sqlite3` unless `CRM_DATABASE_PATH` is set. Created on API startup. `foreign_keys = ON`.

`initialize_database()` runs `CREATE TABLE IF NOT EXISTS` and then adds missing `activities` columns with `ALTER TABLE`. New columns on existing installs must follow that pattern. Do not drop tables to "migrate".

## companies

`id` PK, `name` NOT NULL, `domain`, `industry`, `website`, `size`, `notes` default `''`, `created_at`, `updated_at`. Index `idx_companies_name` on `name COLLATE NOCASE`.

## contacts

`id` PK, `first_name`, `last_name` default `''`, `email`, `phone`, `title`, `company_id` → companies ON DELETE SET NULL, `source`, `status` default `lead`, `tags` default `[]`, `archived` integer default 0, timestamps.

Indexes: name `(last_name, first_name) COLLATE NOCASE`, email `COLLATE NOCASE`, unique `idx_contacts_client_email` on `(client_id, lower(email)) WHERE email <> ''`. The old global `idx_contacts_unique_email` must stay dropped. `companies`, `contacts`, `deals`, `tasks`, and `activities` all have `client_id`.

## deals

`id` PK, `title`, `contact_id` and `company_id` ON DELETE SET NULL, `stage` default `new`, `amount` REAL default 0, `currency` default `USD`, `expected_close_date` nullable, `description`, timestamps. Index `idx_deals_stage`.

## tasks

`id` PK, `title`, `description`, `due_date` nullable, `priority` default `medium`, `completed` integer default 0, `contact_id` and `deal_id` ON DELETE SET NULL, timestamps. Index `idx_tasks_due` on `(completed, due_date)`.

`as_dict` converts `completed` to bool the same way as `archived`.

## activities

`id` PK, `contact_id` NOT NULL ON DELETE CASCADE, `body` NOT NULL, `created_at`, plus:

| Column | Default |
| --- | --- |
| `channel` | `''` |
| `source_key` | NULL |
| `account_id` | `''` |
| `conversation_id` | `''` |
| `conversation_kind` | `''` |
| `message_id` | `''` |
| `unverified_fields` | `[]` |

Index `idx_activities_contact` on `(contact_id, created_at DESC)`. Unique `idx_activities_source_key` where `source_key` is not null and not `''`.

Older databases get these columns from the `PRAGMA table_info` loop. A new activity column needs both the `CREATE TABLE` text and that loop, or existing files will not gain it.

## demo_datasets

`dataset_id` PK (`sample-v1` only), `created_at`, and JSON arrays `company_ids`, `contact_ids`, `deal_ids`, `task_ids`.

`DELETE /crm/demo-data` deletes those ids and the dataset row. It does not delete notes by itself; contact delete cascades their activities. It does not touch rows created after the demo load.

Demo companies are `Northstar Analytics (Demo)`, `Harbor & Pine (Demo)`, `Summit Works (Demo)`. Contacts use `@northstar.example`, `@harbor-pine.example`, and `@summit-works.example`. Notes are prefixed `DEMO:`.

## users, sessions, invitations

`users` has `is_superadmin` and `is_suspended`, both integer default 0. Add them with `ALTER TABLE` when `PRAGMA table_info` does not already list them. Do not recreate `users`.

`workspace_invitations` stores `token_hash` (SHA-256), never the raw token. Status is derived: `revoked_at` means Revoked, `accepted_at` means Accepted, `expires_at` in the past means Expired, otherwise Pending. Acceptance is one `UPDATE` that requires the invitation to still be pending, inside `BEGIN IMMEDIATE`. New accounts get only the workspace and role on that row. They are not added to `default_workspace`.

## Timestamps

`utc_now()` is `datetime.now(timezone.utc).isoformat(timespec="seconds")` (for example `2026-11-16T08:00:00+00:00`). `normalized_timestamp` accepts ISO including `Z`, assumes UTC when naive, and falls back to now on parse failure. Due-date comparisons in summary use `date.today().isoformat()`, which is the machine's local calendar date, not a UTC conversion of the timestamp.

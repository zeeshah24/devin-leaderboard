# Scorecard input data

Mock data for 100 users, 1 Aug – 21 Oct 2026 (October is partial). Timestamps are Unix seconds (UTC).
Devin API files use the paging wrapper `{items, end_cursor, has_next_page, total}`.

## Files

| File | Source | One record per | Join key |
|---|---|---|---|
| `devin_api/sessions.json` | Devin `GET /v3/organizations/{org_id}/sessions` (+ attachments per session) | session | `user_id`, `playbook_id`, `automation_id`, `session_id`, `attachments[].attachment_id` |
| `devin_api/assets.json` | Devin playbooks + automations + knowledge notes APIs, merged | asset | `asset_id`, `created_by_user_id` |
| `enrichment/org_directory.json` | Your HR / identity provider | user (`users[]`), department (`departments[]`) | `user_id`, `department_id` |
| `enrichment/document_reviews.json` | Your document tools | Devin-created document | `attachment_id`, `session_id` |
| `enrichment/knowledge_note_owners.json` | Your own records (Devin notes API has no creator) | knowledge note | `note_id` |
| `enrichment/knowledge_note_usage.json` | Session Insights (not in the API) | note used in a session | `session_id`, `note_id` |
| `enrichment/automation_triggers.json` | Your own event log | automation run | `session_id`, `automation_id` |
| `manifest.json` | Loader metadata: endpoints, time window, join keys | – | – |

## Fields for each part of the formula

| Part (weight) | Fields |
|---|---|
| PR or document output sessions (50%) | `sessions.pull_requests[]` (`pr_state`: `open` / `merged` / `closed`); `sessions.attachments[]` with `source == "devin"`; optional quality filter: `document_reviews.review_status == "approved"` |
| Playbook utilisation (20%) | `sessions.playbook_id` (not null = session used a playbook) |
| Session frequency (20%) | `sessions.created_at`, counted per `user_id` |
| Session impact / size (5%) | `sessions.acus_consumed`; duration = `updated_at - created_at`; `child_session_ids[]` / `parent_session_id` |
| ACU efficiency (5%) | `sessions.acus_consumed` together with the output counts above |
| Peer grouping (optional) | `org_directory.users[].job_function`, `department_id`, `is_developer` |
| Session filter (optional) | `sessions.status`, `origin`, `category` |

## Creator bonus (assets used by others)

| Asset | Creator | Use, and who used it |
|---|---|---|
| Playbook | `assets.created_by_user_id` | sessions with that `playbook_id`; user = `sessions.user_id` |
| Automation | `assets.created_by_user_id` | sessions with that `automation_id`; user = `automation_triggers.triggered_by_user_id` |
| Knowledge note | `knowledge_note_owners.creator_user_id` (`assets.created_by_user_id` is null) | `knowledge_note_usage`; user = `session_user_id`; `classification` = `useful` / `misleading` |

Use by others = the user is not the creator. `triggered_by_user_id` is null for scheduled runs, which have no human user.

## Notes for real data
- In real Devin data, session-level `acus_consumed` was 0. Use `GET /v3/organizations/{org_id}/consumption/daily/users/{user_id}` for real ACUs.
- In this mock, an automation session's `user_id` is the automation creator; the person who triggered it is in `automation_triggers.json`.

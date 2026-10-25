# Requirements Document

## Introduction

The Devin Usage Leaderboard is a single self-contained `index.html` web application that loads Devin API session data and enrichment files, computes a weighted usage score for each user in the organisation, and presents an interactive leaderboard. Users can filter by month, department, and job function; explore ranked scores and tier assignments; inspect per-user session details; and view creator-bonus breakdowns — all without a build step or server-side dependency.

## Glossary

- **App**: The browser application with source files in `index.html` and `scoring.js`, and a generated distributable in `index.dist.html`.
- **Session**: One record from `devin_api/sessions.json`, identified by `session_id`, associated with a `user_id`.
- **Asset**: One record from `devin_api/assets.json`; may be a playbook, automation, or knowledge note.
- **User**: A member of the organisation as defined in `enrichment/org_directory.json`.
- **Department**: An organisational grouping defined by `department_id` / `department_name` in `org_directory.json`.
- **JobFunction**: The `job_function` field on a user record in `org_directory.json`.
- **FilterWindow**: The subset of sessions selected by the active Month, Department, and Job-Function filters.
- **OutputSession**: A session that has at least one entry in `pull_requests[]` OR at least one attachment with `source == "devin"`.
- **OutputScore**: The count of OutputSessions for a user in the FilterWindow.
- **PlaybookScore**: The count of sessions with a non-null `playbook_id` for a user in the FilterWindow.
- **FrequencyScore**: The total count of sessions for a user in the FilterWindow.
- **SessionSizeScore**: The sum of `acus_consumed` for a user in the FilterWindow.
- **EfficiencyScore**: `total_acus_consumed / outputSessionCount` for a user in the FilterWindow; 0 when `outputSessionCount` is 0; inverted before normalisation so that a lower ACU-per-output produces a higher normalised score.
- **NormScore**: A min-max normalised value in the range 0–100 computed across all users in the FilterWindow.
- **TotalScore**: The weighted sum `(NormOutputScore × 0.50) + (NormPlaybookScore × 0.20) + (NormFrequencyScore × 0.20) + (NormSessionSizeScore × 0.05) + (NormEfficiencyScore × 0.05) + min(CreatorBonus, 5)`, clamped to the 0–100 range and displayed as a percentage.
- **CreatorBonus**: An integer equal to the count of distinct assets (playbooks, automations, or knowledge notes) created by a user and used by others within the FilterWindow; knowledge notes count only when `classification == "useful"`.
- **Tier**: A score band assigned per user per month: Power (>51), Proficient (>40), Standard (>30), Basic (>20), or Limited (≤20).
- **MonthlyBucket**: A pre-computed record of per-user raw component tallies (outputCount, playbookCount, sessionCount, totalACUs, totalDuration, childCount) for a single calendar month.
- **LookupMap**: A JavaScript `Map` built at load time keyed by a join field (e.g. `user_id`, `session_id`, `note_id`) for O(1) access.
- **DataLoader**: The App subsystem responsible for fetching JSON files and falling back to file-upload when a fetch fails.
- **ScoreEngine**: The App subsystem responsible for pre-indexing, MonthlyBucket computation, normalisation, tier assignment, and CreatorBonus calculation.
- **UI**: The App subsystem responsible for rendering tabs, stat cards, charts, tables, and the User Session Insight view.
- **Chart.js**: The charting library loaded from CDN at `https://cdn.jsdelivr.net/npm/chart.js`.

---

## Requirements

### Requirement 1 — Data Loading

**User Story:** As an app operator, I want all required JSON data files loaded automatically on page open, so that the leaderboard is populated without manual steps.

#### Acceptance Criteria

1. WHEN the App initialises, THE DataLoader SHALL attempt to fetch the following seven files via `fetch()` using relative paths: `data/devin_api/sessions.json`, `data/devin_api/assets.json`, `data/enrichment/org_directory.json`, `data/enrichment/document_reviews.json`, `data/enrichment/knowledge_note_owners.json`, `data/enrichment/knowledge_note_usage.json`, and `data/enrichment/automation_triggers.json`.
2. IF a `fetch()` call fails or returns a non-OK HTTP status, THEN THE DataLoader SHALL display a file-upload prompt for the specific failed file and accept a user-selected JSON file as a substitute.
3. WHEN all seven files are successfully loaded (via fetch or upload), THE DataLoader SHALL pass the parsed JSON data to the ScoreEngine for indexing.
4. THE DataLoader SHALL parse each file as JSON and SHALL surface a user-visible error message if parsing fails.

---

### Requirement 2 — Pre-Indexing and MonthlyBucket Computation

**User Story:** As a user of the leaderboard, I want filter changes to respond instantly, so that I can explore different time windows without waiting.

#### Acceptance Criteria

1. WHEN all data files are loaded, THE ScoreEngine SHALL build a LookupMap for each of the following join keys: `user_id` → user record, `session_id` → session record, `attachment_id` → document review record, `note_id` → knowledge note owner record, `asset_id` → asset record, and `automation_id` → asset record.
2. WHEN all data files are loaded, THE ScoreEngine SHALL iterate sessions exactly once and SHALL populate a two-level map keyed by `user_id` then by calendar month (formatted `YYYY-MM`) storing a MonthlyBucket containing: `outputCount`, `playbookCount`, `sessionCount`, `totalACUs`, `totalDurationHours`, `childCount`, `pullRequests[]`, and `attachments[]`.
3. THE ScoreEngine SHALL derive a session's calendar month from the `created_at` Unix timestamp (UTC).
4. WHEN all data files are loaded, THE ScoreEngine SHALL build a per-month CreatorBonus index mapping `user_id` to distinct asset-use counts, using only asset uses where the consuming user differs from the asset creator.
5. THE ScoreEngine SHALL complete pre-indexing before the UI renders any data.

---

### Requirement 3 — Score Computation on Filter Change

**User Story:** As a leaderboard viewer, I want scores to update immediately when I change a filter, so that comparisons across time periods and groups are seamless.

#### Acceptance Criteria

1. WHEN a filter value changes, THE ScoreEngine SHALL aggregate scores by summing MonthlyBuckets that fall within the selected month range without re-scanning the raw sessions array.
2. THE ScoreEngine SHALL compute OutputScore, PlaybookScore, FrequencyScore, SessionSizeScore, and EfficiencyScore from aggregated MonthlyBucket totals for each user.
3. THE ScoreEngine SHALL apply min-max normalisation across all users in the FilterWindow to produce NormOutputScore, NormPlaybookScore, NormFrequencyScore, NormSessionSizeScore, and NormEfficiencyScore each in the range 0–100; WHEN all users share the same raw value, THE ScoreEngine SHALL assign a NormScore of 0 to all users.
4. THE ScoreEngine SHALL invert the raw EfficiencyScore before normalisation so that a lower ACU-per-output yields a higher NormEfficiencyScore.
5. THE ScoreEngine SHALL compute TotalScore as `(NormOutputScore × 0.50) + (NormPlaybookScore × 0.20) + (NormFrequencyScore × 0.20) + (NormSessionSizeScore × 0.05) + (NormEfficiencyScore × 0.05) + min(CreatorBonus, 5)`, capped at 100.
6. THE ScoreEngine SHALL assign each user a tier from their TotalScore: Power if >51, Proficient if >40, Standard if >30, Basic if >20, and Limited otherwise.
7. WHEN the Department filter is active, THE ScoreEngine SHALL exclude users not belonging to the selected department before aggregation and normalisation.
8. WHEN the Job-Function filter is active, THE ScoreEngine SHALL exclude users whose `job_function` does not match the selected value before aggregation and normalisation.

---

### Requirement 4 — Filter Controls

**User Story:** As a leaderboard viewer, I want to filter data by month, department, and job function, so that I can compare specific subgroups and time windows.

#### Acceptance Criteria

1. THE UI SHALL render a Month filter that lists all calendar months present in the loaded session data, plus an "All" option.
2. THE UI SHALL render a Department filter that lists all distinct department names from `org_directory.json`, plus an "All" option.
3. THE UI SHALL render a Job-Function filter that lists all distinct `job_function` values from `org_directory.json`, plus an "All" option.
4. WHEN any filter value changes, THE UI SHALL recompute scores via the ScoreEngine and SHALL re-render all visible stat cards, charts, and tables within the same user interaction cycle.
5. THE UI SHALL reflect the active filter state visually on all three top-level tabs so that the viewer knows which FilterWindow is active.

---

### Requirement 5 — Stat Cards (Shared Across All Views)

**User Story:** As a leaderboard viewer, I want summary statistics visible on every tab, so that context is always available without switching views.

#### Acceptance Criteria

1. THE UI SHALL render three summary stat cards at the top of the Overview, Leaderboard, and Creator Bonus tabs, and four user metrics in the User Session Insight view.
2. THE UI SHALL label the overview, leaderboard, and creator bonus cards: "Total Sessions", "Power Users", and "Limited Users".
3. WHEN the FilterWindow changes, THE UI SHALL update "Total Sessions" to the count of sessions in the FilterWindow.
4. WHEN the FilterWindow changes, THE UI SHALL update "Power Users" to the count of users assigned the Power tier in the FilterWindow.
5. WHEN the FilterWindow changes, THE UI SHALL update "Limited Users" to the count of users assigned the Limited tier in the FilterWindow.

---

### Requirement 6 — Overview Tab

**User Story:** As a leaderboard viewer, I want a visual summary of top scorers and session distribution, so that I can quickly understand usage patterns.

#### Acceptance Criteria

1. THE UI SHALL render a horizontal bar chart titled "Top-10 Scorers" displaying the 10 users with the highest TotalScore in the FilterWindow, with user names on the Y-axis and TotalScore values on the X-axis.
2. THE UI SHALL render a donut chart titled "Session Size Distribution" with five slices corresponding to enterprise ACU sizes: XS (≤20), S (>20–50), M (>50–100), L (>100–200), and XL (>200); each slice value equals the count of sessions in the FilterWindow whose `acus_consumed` falls in that bucket.
3. THE UI SHALL render a donut chart titled "Sessions by Department" with one slice per department; each slice value equals the count of sessions in the FilterWindow belonging to users in that department.
4. WHEN a filter changes, THE UI SHALL destroy the existing Chart.js instance for each chart and SHALL create a new Chart.js instance with the updated data.
5. THE UI SHALL load Chart.js from the CDN URL `https://cdn.jsdelivr.net/npm/chart.js`.

---

### Requirement 7 — Leaderboard Tab

**User Story:** As a leaderboard viewer, I want a ranked table of all users with detailed score breakdowns, so that I can compare individual performance.

#### Acceptance Criteria

1. THE UI SHALL render a table on the Leaderboard tab with the following columns in order: Rank, Name, Department, Job Function, Tier, Total Score, Output Score, Playbook Score, Frequency Score, Session Size Score, Efficiency Score, Creator Bonus.
2. THE UI SHALL display TotalScore and all sub-scores rounded to two decimal places.
3. THE UI SHALL default the Leaderboard table sort to Rank ascending.
4. WHEN the user clicks a column header, THE UI SHALL sort the table by that column; clicking the same header again SHALL reverse the sort direction.
5. WHEN the user clicks a table row, THE UI SHALL replace the Leaderboard tab content with the User Session Insight view for the selected user.

---

### Requirement 8 — User Session Insight View

**User Story:** As a leaderboard viewer, I want to drill into a specific user's session history and output details, so that I can understand what drove their score.

#### Acceptance Criteria

1. THE UI SHALL display a back button in the User Session Insight view; WHEN clicked, THE UI SHALL return to the Leaderboard tab table.
2. THE UI SHALL render a line chart titled "Score Trend" showing the user's TotalScore per calendar month from the earliest month in the loaded data through the latest month in the active FilterWindow.
3. THE UI SHALL render a sessions table with the following columns: Session ID (first 8 characters of `session_id`), Date (formatted `YYYY-MM-DD`), Status, Category, Session Size (`acus_consumed` to 2 decimal places), Output Type (one of: "PR", "Doc", "PR+Doc", or "—"), PRs (count of entries in `pull_requests[]`), Docs (count of devin-source attachments), Duration (hours to 2 decimal places).
4. THE UI SHALL render a PR Output section listing all pull requests from sessions in the FilterWindow for the selected user, with columns: Session Date, PR URL, PR State (open / merged / closed).
5. THE UI SHALL render a Doc Output section listing all devin-source attachments from sessions in the FilterWindow for the selected user, with columns: Session Date, Attachment Name, Review Status (from `document_reviews.json` where `attachment_id` matches, otherwise "—").
6. IF the selected user has no pull requests in the FilterWindow, THEN THE UI SHALL display the message "No PR output in this window." in the PR Output section.
7. IF the selected user has no devin-source attachments in the FilterWindow, THEN THE UI SHALL display the message "No document output in this window." in the Doc Output section.
8. THE UI SHALL display the stat cards at the top of the User Session Insight view using the same FilterWindow values as the other tabs.
9. THE UI SHALL display user-specific metrics for session count, PR-created session count, document-created session count, and average monthly TotalScore.
10. THE UI SHALL paginate the selected user's session, PR Output, and Doc Output lists with 10 items per page and previous/next controls for each list.

---

### Requirement 9 — Creator Bonus Tab

**User Story:** As a leaderboard viewer, I want to see which users created assets that others used, so that I can recognise knowledge and automation contributors.

#### Acceptance Criteria

1. THE UI SHALL render a table on the Creator Bonus tab with the following columns in order: Creator Name, Department, Playbook Bonus, Automation Bonus, Knowledge Note Bonus, Total Bonus.
2. THE UI SHALL display only users whose Total Bonus is greater than 0 in the FilterWindow.
3. THE ScoreEngine SHALL compute Playbook Bonus as the count of distinct playbooks created by the user and used in sessions by other users within the FilterWindow.
4. THE ScoreEngine SHALL compute Automation Bonus as the count of distinct automations created by the user and triggered by other users (non-null `triggered_by_user_id`) within the FilterWindow.
5. THE ScoreEngine SHALL compute Knowledge Note Bonus as the count of distinct knowledge notes created by the user, used in sessions within the FilterWindow, and having `classification == "useful"`.
6. WHEN the user clicks a column header in the Creator Bonus table, THE UI SHALL sort the table by that column; clicking the same header again SHALL reverse the sort direction.

---

### Requirement 10 — Performance and DOM Efficiency

**User Story:** As a leaderboard viewer, I want the app to respond to filter changes without perceptible delay, so that exploration feels fluid.

#### Acceptance Criteria

1. WHEN a filter changes, THE UI SHALL batch all DOM mutations for each table into a single `innerHTML` assignment per table to minimise browser reflow.
2. THE App SHALL perform all data joins at load time using LookupMaps so that score computation after a filter change requires no array scans of raw session or enrichment data.
3. WHEN pre-indexing is complete, THE ScoreEngine SHALL have built MonthlyBuckets for every user-month combination present in the data so that FilterWindow aggregation iterates only over calendar-month keys, not individual session records.
4. WHILE the App is computing scores after a filter change, THE UI SHALL disable the filter controls to prevent concurrent recomputations.
5. WHEN score computation completes, THE UI SHALL re-enable the filter controls.

---

### Requirement 11 — Application Structure and Delivery

**User Story:** As an app operator, I want a self-contained HTML distributable that can be hosted as a static file or opened directly in a modern browser.

#### Acceptance Criteria

1. THE distributable SHALL be `index.dist.html`, generated by `node build.js`, and SHALL contain the application HTML, CSS, JavaScript, and data inline.
2. THE App SHALL load Chart.js exclusively from the CDN URL `https://cdn.jsdelivr.net/npm/chart.js` and SHALL NOT bundle or inline the Chart.js source.
3. THE App SHALL require no server-side processing; all data loading, joining, scoring, and rendering SHALL occur in the browser. The distributable MAY be hosted by any static file host.
4. THE App SHALL render correctly in the latest stable versions of Chrome, Firefox, and Safari without polyfills.
5. THE UI SHALL present three top-level tabs labelled "Overview", "Leaderboard", and "Creator Bonus"; WHEN a tab is selected, THE UI SHALL display only the content for that tab.

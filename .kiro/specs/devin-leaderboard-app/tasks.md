# Implementation Plan: Devin Leaderboard App

## Overview

Build a single `index.html` web application (vanilla JS, inline CSS, Chart.js from CDN) with six logical subsystems inside one IIFE: DataLoader, Indexer, ScoreEngine, FilterState, ChartManager, and UI. A companion `build.js` Node.js script embeds all seven JSON files as `window.__DATA__` to produce `index.dist.html`.

Tasks follow the order: scaffolding → data loading → indexing → scoring → UI components → charts → tests → build script.

## Tasks

- [x] 1. Scaffold the project: IIFE shell, HTML skeleton, and inline CSS
  - [x] 1.1 Create `index.html` with full HTML5 boilerplate, inline `<style>` block, and a top-level `<script>` wrapping a single IIFE
    - Include `<header>` with `<h1>Devin Leaderboard</h1>` and `<div id="filters">` containing three `<select>` elements (`filter-month`, `filter-dept`, `filter-jobfn`)
    - Include `<nav id="tabs">` with three `<button data-tab="…">` buttons: Overview, Leaderboard, Creator Bonus
    - Include `<main>` with four `<div>` panes: `tab-overview`, `tab-leaderboard`, `tab-creator-bonus`, and `user-insight` (hidden)
    - Add the Chart.js CDN `<script src="https://cdn.jsdelivr.net/npm/chart.js">` tag
    - Declare six stub objects inside the IIFE: `DataLoader`, `Indexer`, `ScoreEngine`, `FilterState`, `ChartManager`, `UI`
    - Inline CSS: tab switching (`display: block` / `display: none`), tier badge classes `.tier-1` (gold), `.tier-2` (silver), `.tier-3` (grey), stat cards, filter bar, table, chart containers
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 2. Implement DataLoader
  - [x] 2.1 Implement `DataLoader.load()` with the three-priority data acquisition strategy
    - Check `window.__DATA__` first; if present call `_fromEmbedded()`
    - Otherwise call `_fromNetwork()` which fetches all 7 files listed in `FILES` in parallel using `Promise.all()`
    - For any `fetch()` failure or non-OK status, call `_promptUpload(fileName)` to render a `<input type="file">` and return a `Promise` resolved via `FileReader`
    - Implement `_fromEmbedded()` to validate the expected keys on `window.__DATA__` and return the parsed payloads
    - Surface a user-visible inline error banner if JSON parsing fails for any file; continue loading other files
    - After all 7 sources resolve, call `Indexer.build(rawData)`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Implement Indexer — LookupMaps and MonthlyBuckets
  - [x] 3.1 Implement `Indexer._buildLookupMaps(rawData)`
    - Build six `Map` instances: `userById` (user_id → user), `sessionById` (session_id → session), `reviewByAttId` (attachment_id → review), `noteOwnerById` (note_id → owner), `assetById` (asset_id → asset), `assetByAutoId` (automation_id → asset)
    - _Requirements: 2.1_
  - [ ]* 3.2 Write property test for LookupMap completeness (Property 1)
    - **Property 1: LookupMap completeness**
    - For any collection of records with unique join keys, building a LookupMap from those records and looking up each record's own key SHALL return the original record
    - **Validates: Requirements 2.1**
  - [x] 3.3 Implement `monthKey(unixSecs)` utility and `Indexer._buildMonthlyBuckets(sessions)`
    - `monthKey` derives `YYYY-MM` from a Unix timestamp using `Date.getUTCFullYear()` and `Date.getUTCMonth() + 1`
    - Iterate sessions exactly once; for each session get-or-create the user's bucket map then the month bucket; increment `outputCount`, `playbookCount`, `sessionCount`, `totalACUs`, `totalDurationHours`, `childCount`; append to `pullRequests[]` and `devinAttachments[]`
    - A session is an OutputSession if it has at least one entry in `pull_requests[]` OR at least one attachment with `source === 'devin'`
    - _Requirements: 2.2, 2.3_
  - [ ]* 3.4 Write property test for MonthlyBucket session count conservation (Property 2)
    - **Property 2: MonthlyBucket session count conservation**
    - The sum of `bucket.sessionCount` across all users and months SHALL equal the total number of input sessions
    - **Validates: Requirements 2.2**
  - [ ]* 3.5 Write property test for calendar month derivation correctness (Property 3)
    - **Property 3: Calendar month derivation correctness**
    - For any Unix timestamp in seconds (UTC), `monthKey(ts)` SHALL return `YYYY-MM` matching `Date.getUTCFullYear()` and `Date.getUTCMonth() + 1`
    - **Validates: Requirements 2.3**

- [x] 4. Implement Indexer — CreatorBonus index
  - [x] 4.1 Implement `Indexer._buildCreatorBonusIndex(rawData)`
    - **Playbook pass**: for each session with a non-null `playbook_id`, resolve creator via `assetById`; if `creator_user_id !== session.user_id` increment `playbookBonus` for creator at that session's month
    - **Automation pass**: for each `automation_triggers` record with a non-null `triggered_by_user_id`, resolve creator via `assetByAutoId` and session month via `sessionById`; if `creator_user_id !== triggered_by_user_id` increment `automationBonus`
    - **Knowledge note pass**: for each `knowledge_note_usage` record, resolve creator via `noteOwnerById`; if `creator_user_id !== session_user_id` AND `classification === 'useful'` increment `knowledgeNoteBonus`
    - Self-attribution excluded at index-build time
    - _Requirements: 2.4, 9.3, 9.4, 9.5_
  - [ ]* 4.2 Write property test for CreatorBonus non-self-attribution (Property 4)
    - **Property 4: CreatorBonus non-self-attribution**
    - For any asset-use event where the consuming user equals the asset creator, that event SHALL NOT appear as a bonus credit in the CreatorBonus index
    - **Validates: Requirements 2.4, 9.3, 9.4, 9.5**
  - [ ]* 4.3 Write property test for Knowledge Note Bonus classification gate (Property 11)
    - **Property 11: Knowledge Note Bonus classification gate**
    - For any knowledge note usage record where `classification !== 'useful'`, that record SHALL contribute 0 to the creator's Knowledge Note Bonus
    - **Validates: Requirements 9.5**

- [x] 5. Checkpoint — Ensure all indexing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement ScoreEngine
  - [x] 6.1 Implement `ScoreEngine._aggregate(userId, monthFilter)`
    - When `monthFilter === 'All'`, sum all monthly buckets for the user; otherwise read only the selected month bucket
    - Operate exclusively on MonthlyBucket keys; do not touch the raw sessions array
    - _Requirements: 3.1, 3.2_
  - [ ]* 6.2 Write property test for bucket aggregation additivity (Property 5)
    - **Property 5: Bucket aggregation additivity**
    - `aggregate(userId, 'All')` SHALL equal the field-wise sum of all individual monthly buckets for that user
    - **Validates: Requirements 3.1, 3.2**
  - [x] 6.3 Implement `ScoreEngine._normalise(values)` (min-max) and sub-score computation
    - Compute `OutputScore`, `PlaybookScore`, `FrequencyScore`, `ImpactScore`, `EfficiencyScore` (raw and inverted) from aggregated bucket totals
    - Apply min-max normalisation across all users in FilterWindow; return 0 for all when max equals min
    - _Requirements: 3.2, 3.3, 3.4_
  - [ ]* 6.4 Write property test for NormScore range invariant (Property 6)
    - **Property 6: NormScore range invariant**
    - Min-max normalisation SHALL produce values exclusively in [0, 100]; when all inputs are equal, SHALL return 0 for every user
    - **Validates: Requirements 3.3**
  - [ ]* 6.5 Write property test for EfficiencyScore inversion ordering (Property 7)
    - **Property 7: EfficiencyScore inversion ordering**
    - For any two users A and B where A's raw ACU-per-output is strictly less than B's, A's NormEfficiencyScore SHALL be strictly greater than B's
    - **Validates: Requirements 3.4**
  - [x] 6.6 Implement `ScoreEngine._computeTotalScore()` and `ScoreEngine._assignTiers()`
    - TotalScore formula: `(NormOutput × 0.50) + (NormPlaybook × 0.20) + (NormFrequency × 0.20) + (NormImpact × 0.05) + (NormEfficiency × 0.05) + CreatorBonus`
    - Tier 1 = top `Math.ceil(N × 0.10)`, Tier 2 = next `Math.ceil((N − tier1Count) × (0.20 / 0.90))`, Tier 3 = remainder
    - _Requirements: 3.5, 3.6_
  - [ ]* 6.7 Write property test for TotalScore decomposition (Property 8)
    - **Property 8: TotalScore decomposition**
    - TotalScore SHALL equal exactly `(NormOutput × 0.50) + (NormPlaybook × 0.20) + (NormFrequency × 0.20) + (NormImpact × 0.05) + (NormEfficiency × 0.05) + CreatorBonus`
    - **Validates: Requirements 3.5**
  - [ ]* 6.8 Write property test for Tier coverage invariant (Property 9)
    - **Property 9: Tier coverage invariant**
    - Tier counts SHALL be `Math.ceil(N × 0.10)`, `Math.ceil((N − t1) × (0.20 / 0.90))`, and remainder; three counts SHALL sum to N
    - **Validates: Requirements 3.6**
  - [x] 6.9 Implement filter exclusion in `ScoreEngine.compute(filterState)`
    - Apply Department and Job-Function filters to exclude non-matching users before aggregation and normalisation
    - Wire `FilterState.set()` to call `UI.onFilterChange()` which disables filter controls, calls `ScoreEngine.compute()`, re-renders, then re-enables controls
    - _Requirements: 3.7, 3.8, 10.4, 10.5_
  - [ ]* 6.10 Write property test for filter exclusion completeness (Property 10)
    - **Property 10: Filter exclusion completeness**
    - For any active Department or Job-Function filter, no non-matching user SHALL appear in scoring output, stat cards, or rendered tables
    - **Validates: Requirements 3.7, 3.8**

- [x] 7. Checkpoint — Ensure all ScoreEngine tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement FilterState and filter controls UI
  - [x] 8.1 Implement `FilterState` object and populate the three filter `<select>` elements
    - Populate Month filter with all distinct `YYYY-MM` values from session data plus "All"
    - Populate Department filter with all distinct `department_name` values from `org_directory` plus "All"
    - Populate Job-Function filter with all distinct `job_function` values from `org_directory` plus "All"
    - Attach `change` event listeners that call `FilterState.set(key, value)`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 9. Implement stat cards and tab switching
  - [-] 9.1 Implement `UI._renderStatCards(stats)` and tab switching logic
    - Render four stat cards: "Total Sessions", "Power Users", "Limited Users", "Sessions with Org Context"
    - Tab switching: set `display: block` on selected pane, `display: none` on others; attach click listeners to `<nav>` buttons
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 11.5_

- [ ] 10. Implement Leaderboard table and sorting
  - [-] 10.1 Implement `UI.renderLeaderboard(results)` with a sortable table
    - Build the table as a single `innerHTML` string assignment
    - Columns: Rank, Name, Department, Job Function, Tier (badge), Total Score, Output Score, Playbook Score, Frequency Score, Impact Score, Efficiency Score, Creator Bonus
    - Display all scores to 2 decimal places; default sort is Rank ascending
    - Attach column-header click listeners to toggle sort direction; clicking same header reverses sort
    - Attach row click listeners that call `UI.renderUserInsight(userId, results)`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 10.1_

- [ ] 11. Implement User Session Insight view
  - [~] 11.1 Implement `UI.renderUserInsight(userId, results)`
    - Show `#user-insight` pane; hide active tab pane
    - Back button: hide insight pane, restore Leaderboard table
    - Sessions table: Session ID (8 chars), Date (YYYY-MM-DD), Status, Category, Session Size (ACUs 2dp), Output Type (PR / Doc / PR+Doc / —), PRs count, Docs count, Duration (hrs 2dp); single `innerHTML` assignment
    - PR Output section: Session Date, PR URL, PR State; show "No PR output in this window." when empty
    - Doc Output section: Session Date, Attachment Name, Review Status (from `reviewByAttId` or "—"); show "No document output in this window." when empty
    - Stat cards at the top using same FilterWindow values
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [ ] 12. Implement Creator Bonus table
  - [-] 12.1 Implement `UI.renderCreatorBonus(results)`
    - Columns: Creator Name, Department, Playbook Bonus, Automation Bonus, Knowledge Note Bonus, Total Bonus
    - Display only rows where Total Bonus > 0
    - Single `innerHTML` assignment; same sort-on-header-click behaviour as Leaderboard
    - _Requirements: 9.1, 9.2, 9.6, 10.1_

- [ ] 13. Implement ChartManager and Overview tab charts
  - [ ] 13.1 Implement `ChartManager.create(canvasId, config)` with destroy-before-create semantics
    - Store Chart instances in `_instances` keyed by `canvasId`
    - Destroy existing instance before creating a new one
    - If `window.Chart` is undefined, render "Chart.js failed to load." text inside the chart container
    - _Requirements: 6.4, 6.5_
  - [~] 13.2 Implement `UI.renderOverview(results)` with three charts
    - Horizontal bar chart "Top-10 Scorers": top 10 TotalScore, name on Y-axis, score on X-axis
    - Donut chart "Session Size Distribution": ACU buckets 0–1, 1–2, 2–5, 5+
    - Donut chart "Sessions by Department": count per department
    - Each chart rendered via `ChartManager.create()`; destroy and recreate on every filter change
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 14. Implement Score Trend line chart in User Session Insight
  - [~] 14.1 Implement the "Score Trend" line chart inside `renderUserInsight`
    - X-axis: all calendar months from earliest loaded data month to latest FilterWindow month
    - Y-axis: user's TotalScore per month (recompute per-month ScoreEngine output for this user)
    - Rendered via `ChartManager.create()`
    - _Requirements: 8.2_

- [~] 15. Checkpoint — Ensure full app renders correctly with local data
  - Ensure all tests pass and the app opens in a browser with the sample data files served locally, ask the user if questions arise.

- [ ] 16. Implement `build.js` and `index.dist.html` generation
  - [~] 16.1 Write `build.js` as a dependency-free Node.js script
    - Read `index.html`
    - Read all 7 JSON files from `data/` using `fs.readFileSync`
    - Serialise them into a `window.__DATA__ = { sessions, assets, orgDirectory, documentReviews, knowledgeNoteOwners, knowledgeNoteUsage, automationTriggers }` assignment
    - Inject the `<script>` block containing the assignment just before `</body>`
    - Write the result to `index.dist.html`
    - _Requirements: 11.1, 11.3_

- [ ] 17. Error handling and edge cases
  - [~] 17.1 Implement and verify all error-handling paths
    - `user_id` not in `org_directory`: session counted in FilterWindow stats but user excluded from scoring tables
    - All users share the same raw score: `minMax` returns 0 for all
    - FilterWindow = 0 users: stat cards show 0, charts render empty state, tables show empty-state messages
    - `triggered_by_user_id` is null: automation trigger record skipped
    - _Requirements: 1.4, 3.3_

- [~] 18. Final checkpoint — full integration verification
  - Ensure all tests pass and `build.js` produces a working `index.dist.html`, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property tests cover all 11 correctness properties defined in the design document; each is annotated with its property number and requirements clause
- All table renders use a single `innerHTML` assignment per table to minimise browser reflow (Requirement 10.1)
- The app requires no npm install; Chart.js is loaded exclusively from CDN
- `build.js` is run manually (`node build.js`) to produce `index.dist.html`; no watch mode or bundler is involved

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1", "3.3"] },
    { "id": 3, "tasks": ["3.2", "3.4", "3.5", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3"] },
    { "id": 6, "tasks": ["6.4", "6.5", "6.6"] },
    { "id": 7, "tasks": ["6.7", "6.8", "6.9"] },
    { "id": 8, "tasks": ["6.10", "8.1"] },
    { "id": 9, "tasks": ["9.1"] },
    { "id": 10, "tasks": ["10.1"] },
    { "id": 11, "tasks": ["11.1", "12.1", "13.1"] },
    { "id": 12, "tasks": ["13.2", "14.1"] },
    { "id": 13, "tasks": ["16.1", "17.1"] }
  ]
}
```

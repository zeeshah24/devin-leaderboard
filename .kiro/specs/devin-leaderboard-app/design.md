# Design Document — Devin Leaderboard App

## Overview

The Devin Leaderboard App is a single `index.html` web application that loads Devin API session data and enrichment files, computes a weighted usage score for each user, and presents an interactive leaderboard with filtering, drill-down, and creator-bonus views.

The app ships as **two artifacts**:

| Artifact | Purpose | Data loading |
|---|---|---|
| `index.html` | Development version | DataLoader uses `fetch()` → file-upload fallback |
| `index.dist.html` | Distributable version | All 7 JSON blobs inlined as `window.__DATA__` by `build.js` |

`build.js` is a dependency-free Node.js script that reads `index.html`, reads all 7 JSON files, injects `window.__DATA__ = { ... }` as a `<script>` block just before `</body>`, and writes `index.dist.html`. No npm install is required to run the app itself; `build.js` is only needed to produce the distributable.

---

## Architecture

All HTML, CSS, and JavaScript live inline in one file. The JavaScript is wrapped in a single IIFE to avoid global-scope pollution. Six logical subsystems are defined inside that IIFE:

```
index.html
└── <script> (IIFE)
    ├── DataLoader      — window.__DATA__ → fetch() → FileReader fallback
    ├── Indexer         — LookupMaps + MonthlyBuckets + CreatorBonus index (runs once)
    ├── ScoreEngine     — aggregate, normalise, tier, bonus (runs on every filter change)
    ├── FilterState     — { month, department, jobFunction }, triggers recompute
    ├── ChartManager    — Chart.js destroy-before-create lifecycle
    └── UI              — tabs, stat cards, charts, tables, User Session Insight
```

### Startup sequence

```
page load
  └── DataLoader.load()
        ├── if window.__DATA__ → skip fetch, use embedded data
        ├── else fetch() each of 7 files in parallel
        │     └── on any fetch failure → show <input type="file"> for that file
        └── when all 7 sources resolved → Indexer.build(rawData)
              └── when indexing complete → FilterState.init() → UI.render()
```

### Data distribution — Option B (canonical)

**Development (`index.html`)**: DataLoader calls `fetch()` with relative paths. On failure it renders a file-upload input labelled with the file name. The user selects the JSON file; a `FileReader` reads it and the result is treated identically to a successful fetch.

**Distributable (`index.dist.html`)**: `build.js` inlines all 7 JSON files as a single `window.__DATA__` assignment. DataLoader checks for `window.__DATA__` first; if present it uses that object directly and never issues any `fetch()` call or upload prompt.

```js
// build.js (Node.js, no dependencies)
// reads index.html
// reads all 7 JSON files from data/
// serialises them into window.__DATA__ = { sessions, assets, orgDirectory, ... }
// injects the <script> block just before </body>
// writes index.dist.html
```

DataLoader priority order:
1. `window.__DATA__` exists → use directly (no network, no prompt)
2. else → `fetch()` each of the 7 files
3. if any `fetch()` fails → `<input type="file">` prompt for that specific file

---

## Components

### DataLoader

Responsible for acquiring all 7 raw JSON payloads and delivering them to the Indexer.

```js
const DataLoader = {
  FILES: [
    'devin_api/sessions.json',
    'devin_api/assets.json',
    'enrichment/org_directory.json',
    'enrichment/document_reviews.json',
    'enrichment/knowledge_note_owners.json',
    'enrichment/knowledge_note_usage.json',
    'enrichment/automation_triggers.json',
  ],

  async load() {
    if (window.__DATA__) return this._fromEmbedded(window.__DATA__);
    return this._fromNetwork();
  },

  _fromEmbedded(data) { /* validate keys, return parsed payloads */ },
  async _fromNetwork() { /* fetch all FILES in parallel, fall back to file-upload on failure */ },
  _promptUpload(fileName) { /* renders <input type="file">, returns Promise<parsedJSON> */ },
};
```

Errors surfaced to the user:
- `fetch()` failure → file-upload prompt (per file)
- JSON parse error → inline error banner with file name

### Indexer

Runs once after all data is loaded. Produces the LookupMaps, MonthlyBucket map, and CreatorBonus index that all subsequent operations read from.

```js
const Indexer = {
  build(rawData) {
    this._buildLookupMaps(rawData);
    this._buildMonthlyBuckets(rawData.sessions);
    this._buildCreatorBonusIndex(rawData);
  },
  // ... (see Pre-Indexing section below)
};
```

### ScoreEngine

Stateless computation layer. Called on every filter change.

```js
const ScoreEngine = {
  compute(filterState) {
    const users = this._filterUsers(filterState);
    const aggs  = this._aggregate(users, filterState.month);
    const norms = this._normalise(aggs);
    const tiers = this._assignTiers(norms);
    return this._attachBonuses(tiers, filterState.month);
  },
};
```

### FilterState

Holds the three active filter values. Calling `set()` triggers a full recompute and re-render.

```js
const FilterState = {
  month: 'All',        // 'All' | 'YYYY-MM'
  department: 'All',   // 'All' | department_name string
  jobFunction: 'All',  // 'All' | job_function string

  set(key, value) {
    this[key] = value;
    UI.onFilterChange();
  },
};
```

### ChartManager

Wraps Chart.js to guarantee clean destroy-before-create semantics.

```js
const ChartManager = {
  _instances: {},  // canvasId → Chart instance

  create(canvasId, config) {
    if (this._instances[canvasId]) {
      this._instances[canvasId].destroy();
    }
    if (!window.Chart) {
      document.getElementById(canvasId).closest('.chart-container')
        .textContent = 'Chart.js failed to load.';
      return;
    }
    this._instances[canvasId] = new Chart(
      document.getElementById(canvasId), config
    );
  },
};
```

Chart.js is loaded from CDN:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

### UI

Manages tab switching, stat card updates, chart renders, table renders, and the User Session Insight view.

```js
const UI = {
  activeTab: 'overview',   // 'overview' | 'leaderboard' | 'creator-bonus'
  insightUserId: null,     // non-null when User Session Insight is open

  onFilterChange() { /* disable controls, compute, render, re-enable controls */ },
  renderOverview(results) { /* stat cards + 3 charts */ },
  renderLeaderboard(results) { /* stat cards + sortable table */ },
  renderCreatorBonus(results) { /* stat cards + sortable table */ },
  renderUserInsight(userId, results) { /* back button + line chart + 3 tables */ },
  _renderStatCards(stats) { /* shared across all views */ },
};
```

---

## Pre-Indexing

### LookupMaps

All built with `new Map()` for O(1) access:

| Map name | Key | Value |
|---|---|---|
| `userById` | `user_id` | user record from `org_directory.users[]` |
| `sessionById` | `session_id` | session record |
| `reviewByAttId` | `attachment_id` | document review record |
| `noteOwnerById` | `note_id` | knowledge note owner record |
| `assetById` | `asset_id` | asset record |
| `assetByAutoId` | `automation_id` | asset record (for automation lookup) |

### MonthlyBucket map

Type: `Map<userId, Map<YYYY-MM, Bucket>>`

```js
// Bucket shape
{
  outputCount:        0,   // sessions with PR or devin-attachment
  playbookCount:      0,   // sessions with non-null playbook_id
  sessionCount:       0,   // all sessions
  totalACUs:          0,   // sum of acus_consumed
  totalDurationHours: 0,   // sum of (updated_at - created_at) / 3600
  childCount:         0,   // sum of child_session_ids.length
  pullRequests:       [],  // all pull_request entries
  devinAttachments:   [],  // all attachments where source === 'devin'
}
```

Calendar month derivation (UTC):
```js
function monthKey(unixSecs) {
  const d = new Date(unixSecs * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
```

The Indexer iterates sessions **exactly once**; for each session it:
1. Resolves the month key
2. Gets or creates the user's bucket map
3. Gets or creates the bucket for that month
4. Increments all relevant counters

### CreatorBonus index

Type: `Map<userId, Map<YYYY-MM, { playbookBonus, automationBonus, knowledgeNoteBonus }>>`

Built in three passes (one per asset type) after the MonthlyBucket map is complete:

**Playbook bonus** — for each session with a non-null `playbook_id`:
- Resolve creator via `assetById.get(playbook_id)?.created_by_user_id`
- If `creator_user_id !== session.user_id` → increment `playbookBonus` for creator at that month

**Automation bonus** — for each record in `automation_triggers` with a non-null `triggered_by_user_id`:
- Resolve creator via `assetByAutoId.get(automation_id)?.created_by_user_id`
- Resolve session month via `sessionById.get(session_id)?.created_at`
- If `creator_user_id !== triggered_by_user_id` → increment `automationBonus` for creator at that month

**Knowledge note bonus** — for each record in `knowledge_note_usage`:
- Resolve creator via `noteOwnerById.get(note_id)?.creator_user_id`
- If `creator_user_id !== session_user_id` AND `classification === 'useful'` → increment `knowledgeNoteBonus` for creator at that month

Self-attribution is excluded **at index-build time** so the ScoreEngine never needs to check it.

---

## Score Computation

### Aggregation

When `FilterState.month === 'All'`, the ScoreEngine collects all month keys for a user and sums their buckets. When a specific `YYYY-MM` is selected, only that key is read. No raw session array is touched.

```js
function aggregate(userId, monthFilter) {
  const buckets = monthlyBuckets.get(userId) ?? new Map();
  const keys = monthFilter === 'All'
    ? [...buckets.keys()]
    : [monthFilter];
  return keys.reduce((acc, k) => addBucket(acc, buckets.get(k) ?? emptyBucket()), emptyBucket());
}
```

### Sub-score formulas

| Sub-score | Formula |
|---|---|
| OutputScore | `agg.outputCount` |
| PlaybookScore | `agg.playbookCount` |
| FrequencyScore | `agg.sessionCount` |
| ImpactScore | `agg.totalACUs + agg.totalDurationHours` |
| EfficiencyScore (raw) | `agg.outputCount > 0 ? agg.totalACUs / agg.outputCount : 0` |
| EfficiencyScore (inverted) | `maxRawEff - rawEff` (computed across all FilterWindow users) |

### Min-max normalisation

```js
function minMax(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0);
  return values.map(v => ((v - min) / (max - min)) * 100);
}
```

Applied independently to each of the five components across all users in the FilterWindow.

### TotalScore

```
TotalScore = (NormOutput × 0.50)
           + (NormPlaybook × 0.20)
           + (NormFrequency × 0.20)
           + (NormImpact × 0.05)
           + (NormEfficiency × 0.05)
           + CreatorBonus
```

CreatorBonus for the active FilterWindow:
```js
function creatorBonus(userId, monthFilter) {
  const index = creatorBonusIndex.get(userId) ?? new Map();
  const keys  = monthFilter === 'All' ? [...index.keys()] : [monthFilter];
  return keys.reduce((sum, k) => {
    const b = index.get(k) ?? {};
    return sum + (b.playbookBonus ?? 0) + (b.automationBonus ?? 0) + (b.knowledgeNoteBonus ?? 0);
  }, 0);
}
```

### Tier assignment

```js
function assignTiers(sorted) {           // sorted descending by TotalScore
  const n  = sorted.length;
  const t1 = Math.ceil(n * 0.10);
  const t2 = Math.ceil((n - t1) * (0.20 / 0.90));
  sorted.forEach((u, i) => {
    u.tier = i < t1 ? 1 : i < t1 + t2 ? 2 : 3;
  });
}
```

### Filter application

Department and Job-Function filters exclude non-matching users **before** aggregation and normalisation, so NormScores reflect only the visible FilterWindow population.

---

## Data Models

### Input types (from JSON files)

```js
// Session (devin_api/sessions.json item)
{
  session_id, user_id, created_at, updated_at,
  acus_consumed, playbook_id, automation_id,
  pull_requests: [{ pr_url, pr_state }],
  attachments:   [{ attachment_id, source, name }],
  child_session_ids: [], parent_session_id,
  status, category, origin,
}

// Asset (devin_api/assets.json item)
{
  asset_id, asset_type,           // 'playbook' | 'automation' | 'knowledge_note'
  created_by_user_id,
  playbook_id, automation_id, note_id,  // whichever is relevant to asset_type
}

// OrgDirectory user
{
  user_id, name, department_id, department_name,
  job_function, is_developer,
}

// DocumentReview (enrichment/document_reviews.json item)
{ attachment_id, session_id, review_status }  // review_status: 'approved' | 'pending' | etc.

// KnowledgeNoteOwner (enrichment/knowledge_note_owners.json item)
{ note_id, creator_user_id }

// KnowledgeNoteUsage (enrichment/knowledge_note_usage.json item)
{ session_id, note_id, session_user_id, classification }  // classification: 'useful' | 'misleading'

// AutomationTrigger (enrichment/automation_triggers.json item)
{ session_id, automation_id, triggered_by_user_id }  // triggered_by_user_id null for scheduled runs
```

### window.__DATA__ shape (distributable only)

```js
window.__DATA__ = {
  sessions:             { items: [...], total, ... },
  assets:               { items: [...], total, ... },
  orgDirectory:         { users: [...], departments: [...] },
  documentReviews:      [...],
  knowledgeNoteOwners:  [...],
  knowledgeNoteUsage:   [...],
  automationTriggers:   [...],
};
```

### ScoreResult (output of ScoreEngine.compute)

```js
{
  user_id, name, department, jobFunction,
  rank, tier,
  rawOutput, rawPlaybook, rawFrequency, rawImpact, rawEfficiency,
  normOutput, normPlaybook, normFrequency, normImpact, normEfficiency,
  creatorBonus,
  totalScore,
  // for Creator Bonus tab:
  playbookBonus, automationBonus, knowledgeNoteBonus,
}
```

---

## UI Layout

### DOM structure

```
<header>
  <h1>Devin Leaderboard</h1>
  <div id="filters">
    <select id="filter-month">…</select>
    <select id="filter-dept">…</select>
    <select id="filter-jobfn">…</select>
  </div>
</header>

<nav id="tabs">
  <button data-tab="overview">Overview</button>
  <button data-tab="leaderboard">Leaderboard</button>
  <button data-tab="creator-bonus">Creator Bonus</button>
</nav>

<main>
  <div id="tab-overview">   … stat cards + 3 charts …</div>
  <div id="tab-leaderboard"> … stat cards + sortable table …</div>
  <div id="tab-creator-bonus">… stat cards + sortable table …</div>
  <div id="user-insight" hidden>… back + line chart + 3 tables …</div>
</main>
```

Tab switching sets `display: block` on the active pane and `display: none` on the rest. The `#user-insight` pane overlays the leaderboard tab when open.

### Stat cards (shared)

Rendered identically in Overview, Leaderboard, Creator Bonus, and User Session Insight:

| Card | Value |
|---|---|
| Total Sessions | count of sessions in FilterWindow |
| Power Users | count of Tier 1 users in FilterWindow |
| Limited Users | count of Tier 3 users in FilterWindow |
| Sessions with Org Context | sessions where `user_id` resolves in `userById` |

### Overview tab

- Horizontal bar chart **"Top-10 Scorers"** — top 10 TotalScore, name on Y, score on X
- Donut chart **"Session Size Distribution"** — ACU buckets: 0–1, 1–2, 2–5, 5+
- Donut chart **"Sessions by Department"** — count per department

### Leaderboard tab

Sortable table columns: Rank | Name | Department | Job Function | Tier | Total Score | Output Score | Playbook Score | Frequency Score | Impact Score | Efficiency Score | Creator Bonus

- Default sort: Rank ascending
- Tier badge classes: `.tier-1` (gold), `.tier-2` (silver), `.tier-3` (grey)
- Scores displayed to 2 decimal places
- Row click → open User Session Insight for that user

### User Session Insight view

- **Back button** → restores Leaderboard table
- **Line chart "Score Trend"** — user's monthly TotalScore from earliest data month to latest FilterWindow month
- **Sessions table** — Session ID (8 chars) | Date (YYYY-MM-DD) | Status | Category | Session Size (ACUs, 2dp) | Output Type (PR / Doc / PR+Doc / —) | PRs | Docs | Duration (hrs, 2dp)
- **PR Output section** — Session Date | PR URL | PR State
- **Doc Output section** — Session Date | Attachment Name | Review Status (from `reviewByAttId`, else "—")
- Empty states: "No PR output in this window." / "No document output in this window."

### Creator Bonus tab

Sortable table columns: Creator Name | Department | Playbook Bonus | Automation Bonus | Knowledge Note Bonus | Total Bonus

- Only rows where Total Bonus > 0
- Sort behaviour identical to Leaderboard table

### DOM performance

- Each table is rendered as a single `innerHTML` assignment (one string built with `Array.join('')`)
- Filter controls are disabled during recompute and re-enabled after
- All data joins use LookupMaps built at load time; no array scans during filter changes

---

## Error Handling

| Condition | Behaviour |
|---|---|
| `fetch()` fails or non-OK status | File-upload prompt rendered for that specific file |
| JSON parse error | Inline error banner with file name; other files continue loading |
| Chart.js CDN unavailable (`window.Chart` undefined) | Text fallback "Chart.js failed to load." inside each chart container |
| `user_id` not in `org_directory` | Session counted in FilterWindow stats but user excluded from scoring table |
| All users share the same raw score | `minMax` returns 0 for all (no division by zero) |
| FilterWindow = 0 users | Stat cards show 0; charts render empty state; tables show empty state |
| `triggered_by_user_id` is null | Automation trigger record skipped (scheduled run, no human user) |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: LookupMap completeness

*For any* collection of records with unique join keys, building a LookupMap from those records and then looking up each record's own key SHALL return the original record.

**Validates: Requirements 2.1**

---

### Property 2: MonthlyBucket session count conservation

*For any* array of session records, the sum of `bucket.sessionCount` across all users and all months in the resulting MonthlyBucket map SHALL equal the total number of input sessions.

**Validates: Requirements 2.2**

---

### Property 3: Calendar month derivation correctness

*For any* Unix timestamp in seconds (UTC), the `monthKey(ts)` function SHALL return a string of the form `YYYY-MM` matching `Date.getUTCFullYear()` and `Date.getUTCMonth() + 1` for that timestamp.

**Validates: Requirements 2.3**

---

### Property 4: CreatorBonus non-self-attribution

*For any* asset-use event, if the consuming user's `user_id` equals the asset's `created_by_user_id` (or the knowledge note's `creator_user_id`), that event SHALL NOT appear as a bonus credit in the CreatorBonus index.

**Validates: Requirements 2.4, 9.3, 9.4, 9.5**

---

### Property 5: Bucket aggregation additivity

*For any* user and any set of monthly buckets, the aggregated totals produced by `aggregate(userId, 'All')` SHALL equal the field-wise sum of all individual buckets for that user across all months.

**Validates: Requirements 3.1, 3.2**

---

### Property 6: NormScore range invariant

*For any* array of raw score values, applying min-max normalisation SHALL produce values exclusively in the range [0, 100]; and when all input values are equal, normalisation SHALL return 0 for every user.

**Validates: Requirements 3.3**

---

### Property 7: EfficiencyScore inversion ordering

*For any* two users A and B in the same FilterWindow where A's raw ACU-per-output is strictly less than B's, A's NormEfficiencyScore SHALL be strictly greater than B's NormEfficiencyScore.

**Validates: Requirements 3.4**

---

### Property 8: TotalScore decomposition

*For any* user in the FilterWindow, their TotalScore SHALL equal exactly `(NormOutput × 0.50) + (NormPlaybook × 0.20) + (NormFrequency × 0.20) + (NormImpact × 0.05) + (NormEfficiency × 0.05) + CreatorBonus`.

**Validates: Requirements 3.5**

---

### Property 9: Tier coverage invariant

*For any* population of N users sorted by TotalScore, the number of Tier 1 users SHALL be `Math.ceil(N × 0.10)`, the number of Tier 2 users SHALL be `Math.ceil((N − tier1Count) × (0.20 / 0.90))`, and every remaining user SHALL be Tier 3; the three counts SHALL sum to N.

**Validates: Requirements 3.6**

---

### Property 10: Filter exclusion completeness

*For any* dataset and any combination of active Department and Job-Function filter values, no user whose `department_name` or `job_function` does not match the active filter SHALL appear in any scoring output, stat card computation, or rendered table row.

**Validates: Requirements 3.7, 3.8**

---

### Property 11: Knowledge Note Bonus classification gate

*For any* knowledge note usage record, if `classification !== 'useful'`, that record SHALL contribute 0 to the creator's Knowledge Note Bonus, regardless of whether the consuming user differs from the creator.

**Validates: Requirements 9.5**

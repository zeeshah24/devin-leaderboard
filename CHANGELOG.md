# Changelog

## 2026-10-24

- Renamed the page and product heading to Devin Usage Leaderboard.
- Added Session Insight navigation with user-specific session, PR, document, and average-score metrics; paginated sessions, PRs, and documents independently.
- Aligned the average-score card with the latest three monthly scores shown in the trend chart.
- Added scoring configuration and five score-based tiers: Power, Proficient, Standard, Basic, and Limited.
- Capped Creator Bonus at 5 points and displayed total scores as percentages.
- Updated session-size distribution to enterprise XS–XL ACU thresholds and fixed chart sizing/animation.
- Added department ID-to-name resolution for accurate department filtering and labels.
- Added `build.js` to generate the self-contained `index.dist.html` bundle.
- Verified with Playwright and `node scoreengine.test.js` (60 tests passing).

### Documentation and release readiness

- Added a README with local development, build, test, deployment, project-file, and data-privacy guidance.
- Updated the data-field documentation with repository-relative input paths, manifest metadata, distributable build steps, CDN requirements, and a warning about publishing embedded organizational data.
- Aligned the requirements and design documentation with the source/distributable layout, scoring configuration, and actual data paths.
- Fixed the distributable build so embedded data is declared in the document head before application startup. This lets `index.dist.html` load its embedded data directly, including when opened with `file://`, without prompting for uploads.
- Rebuilt and validated `index.dist.html`; verified embedded data, static serving, and file-based loading with no upload prompts or errors. Confirmed all seven data files and `manifest.json` are valid JSON and all 60 score-engine tests pass.

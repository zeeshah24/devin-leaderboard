# Devin Usage Leaderboard

A static, browser-based leaderboard for exploring Devin usage by month, department, and job function. It calculates weighted user scores, displays score tiers and creator bonuses, and provides per-user session, pull request, and document insights.

## Run locally

The development page loads its data files with relative `fetch()` requests, so serve the repository over HTTP rather than opening the file directly:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000/index.html](http://localhost:8000/index.html). If a data request fails, the app prompts you to select the corresponding JSON file.

## Build the distributable

With Node.js installed, run this from the repository root:

```sh
node build.js
```

This generates `index.dist.html`, a self-contained HTML file with the application code and all seven data files embedded. Publish that file as a static asset. If your host expects the default document to be named `index.html`, publish the generated file under that name. Chart.js is loaded from jsDelivr, so charts require browser access to the CDN.

## Test

Run the score-engine tests with:

```sh
node scoreengine.test.js
```

## Project files

- `index.html` — development application.
- `scoring.js` — shared scoring weights and tier configuration.
- `build.js` — generates the distributable.
- `index.dist.html` — generated, data-embedded distributable.
- `data/` — session, asset, organization, and enrichment JSON inputs.
- `manifest.json` — source and time-window metadata for the data.
- `docs/DATA_FIELDS.md` — input schemas, joins, scoring fields, and data notes.
- `CHANGELOG.md` — recent project changes.

## Data and publishing notes

The checked-in JSON data is mock data. The generated distributable embeds every input record in the HTML and makes that data accessible to anyone who can download the file. Review and replace the data—and inspect the generated HTML—before publishing real organizational information. The app and build script do not require a backend or npm dependencies.

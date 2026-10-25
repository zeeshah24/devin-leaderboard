const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const htmlPath = path.join(rootDir, 'index.html');
const scoringPath = path.join(rootDir, 'scoring.js');
const distPath = path.join(rootDir, 'index.dist.html');

const jsonFiles = {
  sessions: 'data/devin_api/sessions.json',
  assets: 'data/devin_api/assets.json',
  orgDirectory: 'data/enrichment/org_directory.json',
  documentReviews: 'data/enrichment/document_reviews.json',
  knowledgeNoteOwners: 'data/enrichment/knowledge_note_owners.json',
  knowledgeNoteUsage: 'data/enrichment/knowledge_note_usage.json',
  automationTriggers: 'data/enrichment/automation_triggers.json',
};

const payload = {};
for (const [key, relPath] of Object.entries(jsonFiles)) {
  const filePath = path.join(rootDir, relPath);
  const text = fs.readFileSync(filePath, 'utf8');
  payload[key] = JSON.parse(text);
}

let html = fs.readFileSync(htmlPath, 'utf8');
const scoringSource = fs.readFileSync(scoringPath, 'utf8');
const scoringTag = '<script src="scoring.js"></script>';
if (!html.includes(scoringTag)) {
  throw new Error('Could not find scoring.js script tag in index.html');
}
html = html.replace(scoringTag, `<script>\n${scoringSource}\n</script>`);
const injected = `\n  <script>\n    window.__DATA__ = ${JSON.stringify(payload, null, 2)};\n  </script>\n`;
if (!html.includes('</head>')) {
  throw new Error('Could not find </head> in index.html');
}
const result = html.replace('</head>', `${injected}</head>`);
fs.writeFileSync(distPath, result, 'utf8');
console.log(`Built ${distPath}`);

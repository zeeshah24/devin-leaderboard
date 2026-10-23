---
inclusion: always
---
<!------------------------------------------------------------------------------------
   Add rules to this file or a short description and have Kiro refine them for you.
   
   Learn about inclusion modes: https://kiro.dev/docs/steering/#inclusion-modes
-------------------------------------------------------------------------------------> 

- Plain HTML + vanilla JS (ES modules) + Chart.js from CDN. No build step, no backend.
- Data lives in /data; field names and joins are in docs/DATA_FIELDS.md. Never rename fields.
- Score per user per month (0–100):
  50% PR-or-document output sessions, 20% playbook utilisation,
  20% session frequency, 5% session size, 5% ACU efficiency.
- Tiers: >51 Power, >40 Proficient, >30 Standard, >20 Basic, <=20 Limited.
- Keep all weights, tier cut-offs and rules (e.g. minimum sessions) in one config object in scoring.js.
- Start from all users in org_directory.json so users with no sessions score 0.
/**
 * ScoreEngine correctness tests
 *
 * Runs in Node.js with no dependencies (uses built-in assert module).
 * Tests all ScoreEngine functions extracted from index.html.
 *
 * Run with: node scoreengine.test.js
 */
'use strict';

const assert = require('assert');
const scoringConfig = require('./scoring.js');

// ─── Extracted logic from index.html ─────────────────────────────────────────
// These functions mirror the implementations in the IIFE exactly.

function monthKey(unixSecs) {
  const d = new Date(unixSecs * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sessionSizeBucket(acus) {
  if (acus <= 20) return 'XS';
  if (acus <= 50) return 'S';
  if (acus <= 100) return 'M';
  if (acus <= 200) return 'L';
  return 'XL';
}

function normalise(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0);
  return values.map(v => ((v - min) / (max - min)) * scoringConfig.scoreMax);
}

function computeSubScores(agg) {
  return {
    rawOutput:     agg.outputCount,
    rawPlaybook:   agg.playbookCount,
    rawFrequency:  agg.sessionCount,
    rawSessionSize: agg.totalACUs,
    rawEfficiency: agg.outputCount > 0 ? agg.totalACUs / agg.outputCount : 0,
  };
}

function computeTotalScore(normScores, creatorBonus) {
  const weights = scoringConfig.weights;
  const weightedScore = (normScores.normOutput      * weights.output)
                      + (normScores.normPlaybook    * weights.playbook)
                      + (normScores.normFrequency   * weights.frequency)
                      + (normScores.normSessionSize * weights.sessionSize)
                      + (normScores.normEfficiency  * weights.efficiency);
  const cappedCreatorBonus = Math.min(scoringConfig.creatorBonusCap, Math.max(0, creatorBonus));
  return Math.min(scoringConfig.scoreMax, Math.max(0, weightedScore + cappedCreatorBonus));
}

function assignTiers(items) {
  items.forEach(item => {
    const tier = scoringConfig.tiers.find(candidate => item.totalScore > candidate.minExclusive);
    item.tier = tier.name;
    item.tierKey = tier.key;
  });
}

// Minimal Indexer implementation for aggregate() tests
function buildMonthlyBuckets(sessions) {
  const monthlyBuckets = new Map();
  const sessionList = Array.isArray(sessions) ? sessions : (sessions?.items ?? []);
  for (const session of sessionList) {
    const mk = monthKey(session.created_at);
    let userBuckets = monthlyBuckets.get(session.user_id);
    if (!userBuckets) { userBuckets = new Map(); monthlyBuckets.set(session.user_id, userBuckets); }
    let bucket = userBuckets.get(mk);
    if (!bucket) {
      bucket = { outputCount: 0, playbookCount: 0, sessionCount: 0, totalACUs: 0,
                 totalDurationHours: 0, childCount: 0, pullRequests: [], devinAttachments: [] };
      userBuckets.set(mk, bucket);
    }
    bucket.sessionCount += 1;
    bucket.totalACUs    += (session.acus_consumed ?? 0);
    bucket.totalDurationHours += (session.updated_at - session.created_at) / 3600;
    bucket.childCount   += (session.child_session_ids || []).length;
    if (session.playbook_id != null) bucket.playbookCount += 1;
    const pullRequests     = session.pull_requests ?? [];
    const attachments      = session.attachments    ?? [];
    const devinAttachments = attachments.filter(a => a.source === 'devin');
    if (pullRequests.length > 0 || devinAttachments.length > 0) bucket.outputCount += 1;
    for (const pr  of pullRequests)     bucket.pullRequests.push(pr);
    for (const att of devinAttachments) bucket.devinAttachments.push(att);
  }
  return monthlyBuckets;
}

function aggregate(monthlyBuckets, userId, monthFilter) {
  const emptyBucket = () => ({ outputCount: 0, playbookCount: 0, sessionCount: 0, totalACUs: 0,
                               totalDurationHours: 0, childCount: 0, pullRequests: [], devinAttachments: [] });
  const buckets = monthlyBuckets.get(userId) ?? new Map();
  const keys = monthFilter === 'All' ? [...buckets.keys()] : [monthFilter];
  return keys.reduce((acc, k) => {
    const b = buckets.get(k);
    if (!b) return acc;
    acc.outputCount        += b.outputCount;
    acc.playbookCount      += b.playbookCount;
    acc.sessionCount       += b.sessionCount;
    acc.totalACUs          += b.totalACUs;
    acc.totalDurationHours += b.totalDurationHours;
    acc.childCount         += b.childCount;
    acc.pullRequests        = acc.pullRequests.concat(b.pullRequests);
    acc.devinAttachments    = acc.devinAttachments.concat(b.devinAttachments);
    return acc;
  }, emptyBucket());
}

// ─── Test runner helpers ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

function suite(name, fn) {
  console.log(`\n${name}`);
  fn();
}

const EPSILON = 1e-10;
function assertClose(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < EPSILON, msg || `Expected ~${expected} but got ${actual}`);
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

suite('monthKey utility', () => {
  test('known UTC timestamp → YYYY-MM', () => {
    // 2024-03-15T12:00:00Z = 1710504000
    assert.strictEqual(monthKey(1710504000), '2024-03');
  });

  test('first second of January 2000 UTC', () => {
    // 2000-01-01T00:00:00Z = 946684800
    assert.strictEqual(monthKey(946684800), '2000-01');
  });

  test('last second of December 2023 UTC', () => {
    // 2023-12-31T23:59:59Z = 1704067199
    assert.strictEqual(monthKey(1704067199), '2023-12');
  });

  test('single-digit month is zero-padded', () => {
    // 2024-05-01T00:00:00Z = 1714521600
    const result = monthKey(1714521600);
    assert.strictEqual(result, '2024-05');
    assert.match(result, /^\d{4}-\d{2}$/);
  });

  test('timestamp 0 → 1970-01', () => {
    assert.strictEqual(monthKey(0), '1970-01');
  });

  test('format is always YYYY-MM', () => {
    // Spot-check 12 months of 2023
    const months = ['2023-01','2023-02','2023-03','2023-04','2023-05','2023-06',
                    '2023-07','2023-08','2023-09','2023-10','2023-11','2023-12'];
    // Use UTC start-of-month timestamps
    const starts = [1672531200,1675209600,1677628800,1680307200,1682899200,1685577600,
                    1688169600,1690848000,1693526400,1696118400,1698796800,1701388800];
    starts.forEach((ts, i) => {
      assert.strictEqual(monthKey(ts), months[i], `Month ${i+1} failed`);
    });
  });
});

suite('Enterprise session size buckets', () => {
  test('uses exclusive lower and inclusive upper thresholds', () => {
    assert.strictEqual(sessionSizeBucket(0), 'XS');
    assert.strictEqual(sessionSizeBucket(20), 'XS');
    assert.strictEqual(sessionSizeBucket(20.01), 'S');
    assert.strictEqual(sessionSizeBucket(50), 'S');
    assert.strictEqual(sessionSizeBucket(50.01), 'M');
    assert.strictEqual(sessionSizeBucket(100), 'M');
    assert.strictEqual(sessionSizeBucket(100.01), 'L');
    assert.strictEqual(sessionSizeBucket(200), 'L');
    assert.strictEqual(sessionSizeBucket(200.01), 'XL');
  });
});

suite('ScoreEngine._normalise (min-max)', () => {
  test('simple range 0–100 → [0, 100]', () => {
    const result = normalise([0, 50, 100]);
    assertClose(result[0], 0);
    assertClose(result[1], 50);
    assertClose(result[2], 100);
  });

  test('all equal values → all 0 (no division by zero)', () => {
    const result = normalise([5, 5, 5]);
    result.forEach(v => assert.strictEqual(v, 0));
  });

  test('single value → 0', () => {
    assert.strictEqual(normalise([42])[0], 0);
  });

  test('all values in [0, 100] after normalisation', () => {
    const raw = [3, 7, 1, 9, 2, 5, 8, 0, 4, 6];
    const result = normalise(raw);
    result.forEach(v => {
      assert.ok(v >= 0 && v <= 100, `Value ${v} out of range [0,100]`);
    });
  });

  test('min maps to 0, max maps to 100', () => {
    const raw = [10, 20, 30, 40, 50];
    const result = normalise(raw);
    assertClose(result[0], 0);   // min = 10
    assertClose(result[4], 100); // max = 50
  });

  test('two distinct values → exactly [0, 100]', () => {
    const result = normalise([3, 7]);
    assertClose(result[0], 0);
    assertClose(result[1], 100);
  });

  test('negative values handled correctly', () => {
    const result = normalise([-10, 0, 10]);
    assertClose(result[0], 0);
    assertClose(result[1], 50);
    assertClose(result[2], 100);
  });
});

suite('Scoring configuration', () => {
  test('configured weights total 100 percent', () => {
    const totalWeight = Object.values(scoringConfig.weights).reduce((sum, weight) => sum + weight, 0);
    assertClose(totalWeight, 1);
  });

  test('sets the five configured score tiers in descending order', () => {
    assert.deepStrictEqual(scoringConfig.tiers.map(tier => tier.name), [
      'Power', 'Proficient', 'Standard', 'Basic', 'Limited',
    ]);
    assert.deepStrictEqual(scoringConfig.tiers.slice(0, 4).map(tier => tier.minExclusive), [51, 40, 30, 20]);
  });
});

suite('ScoreEngine._computeSubScores', () => {
  test('rawOutput = outputCount', () => {
    const agg = { outputCount: 7, playbookCount: 3, sessionCount: 10,
                  totalACUs: 20, totalDurationHours: 5 };
    assert.strictEqual(computeSubScores(agg).rawOutput, 7);
  });

  test('rawPlaybook = playbookCount', () => {
    const agg = { outputCount: 2, playbookCount: 4, sessionCount: 6,
                  totalACUs: 8, totalDurationHours: 2 };
    assert.strictEqual(computeSubScores(agg).rawPlaybook, 4);
  });

  test('rawFrequency = sessionCount', () => {
    const agg = { outputCount: 1, playbookCount: 1, sessionCount: 15,
                  totalACUs: 10, totalDurationHours: 3 };
    assert.strictEqual(computeSubScores(agg).rawFrequency, 15);
  });

  test('rawSessionSize = total ACUs consumed', () => {
    const agg = { outputCount: 1, playbookCount: 0, sessionCount: 5,
                  totalACUs: 12.5, totalDurationHours: 7.5 };
    assertClose(computeSubScores(agg).rawSessionSize, 12.5);
  });

  test('rawEfficiency = totalACUs / outputCount when outputCount > 0', () => {
    const agg = { outputCount: 4, playbookCount: 0, sessionCount: 4,
                  totalACUs: 20, totalDurationHours: 0 };
    assertClose(computeSubScores(agg).rawEfficiency, 5);
  });

  test('rawEfficiency = 0 when outputCount = 0', () => {
    const agg = { outputCount: 0, playbookCount: 0, sessionCount: 3,
                  totalACUs: 10, totalDurationHours: 2 };
    assert.strictEqual(computeSubScores(agg).rawEfficiency, 0);
  });
});

suite('ScoreEngine._computeTotalScore', () => {
  test('correct weighted formula with no creator bonus', () => {
    const normScores = { normOutput: 100, normPlaybook: 100,
                         normFrequency: 100, normSessionSize: 100, normEfficiency: 100 };
    // 100*0.50 + 100*0.20 + 100*0.20 + 100*0.05 + 100*0.05 = 100
    assertClose(computeTotalScore(normScores, 0), 100);
  });

  test('weights sum to 1.0 (all norms = 1 gives total = 1 + bonus)', () => {
    const normScores = { normOutput: 1, normPlaybook: 1,
                         normFrequency: 1, normSessionSize: 1, normEfficiency: 1 };
    assertClose(computeTotalScore(normScores, 0), 1.0);
  });

  test('creator bonus is capped at five points', () => {
    const normScores = { normOutput: 0, normPlaybook: 0,
                         normFrequency: 0, normSessionSize: 0, normEfficiency: 0 };
    assertClose(computeTotalScore(normScores, 5), 5);
    assertClose(computeTotalScore(normScores, 25), 5);
  });

  test('total score is capped at 100 percent', () => {
    const normScores = { normOutput: 100, normPlaybook: 100,
                         normFrequency: 100, normSessionSize: 100, normEfficiency: 100 };
    assertClose(computeTotalScore(normScores, 25), 100);
  });

  test('total score never falls below zero', () => {
    const normScores = { normOutput: 0, normPlaybook: 0,
                         normFrequency: 0, normSessionSize: 0, normEfficiency: 0 };
    assertClose(computeTotalScore(normScores, -5), 0);
  });

  test('NormOutput has 0.50 weight', () => {
    const base = { normOutput: 0, normPlaybook: 0, normFrequency: 0, normSessionSize: 0, normEfficiency: 0 };
    assertClose(computeTotalScore({ ...base, normOutput: 100 }, 0), 50);
  });

  test('NormPlaybook has 0.20 weight', () => {
    const base = { normOutput: 0, normPlaybook: 0, normFrequency: 0, normSessionSize: 0, normEfficiency: 0 };
    assertClose(computeTotalScore({ ...base, normPlaybook: 100 }, 0), 20);
  });

  test('NormFrequency has 0.20 weight', () => {
    const base = { normOutput: 0, normPlaybook: 0, normFrequency: 0, normSessionSize: 0, normEfficiency: 0 };
    assertClose(computeTotalScore({ ...base, normFrequency: 100 }, 0), 20);
  });

  test('NormSessionSize has 0.05 weight', () => {
    const base = { normOutput: 0, normPlaybook: 0, normFrequency: 0, normSessionSize: 0, normEfficiency: 0 };
    assertClose(computeTotalScore({ ...base, normSessionSize: 100 }, 0), 5);
  });

  test('NormEfficiency has 0.05 weight', () => {
    const base = { normOutput: 0, normPlaybook: 0, normFrequency: 0, normSessionSize: 0, normEfficiency: 0 };
    assertClose(computeTotalScore({ ...base, normEfficiency: 100 }, 0), 5);
  });

  test('typical mixed values', () => {
    const normScores = { normOutput: 80, normPlaybook: 60, normFrequency: 70,
                         normSessionSize: 40, normEfficiency: 50 };
    // 80*0.50 + 60*0.20 + 70*0.20 + 40*0.05 + 50*0.05 + 3
    // = 40 + 12 + 14 + 2 + 2.5 + 3 = 73.5
    assertClose(computeTotalScore(normScores, 3), 73.5);
  });
});

suite('ScoreEngine._assignTiers', () => {
  test('assigns all five tiers using the exact configured score cutoffs', () => {
    const arr = [52, 51, 40, 30, 20, 0].map(totalScore => ({ totalScore }));
    assignTiers(arr);
    assert.deepStrictEqual(arr.map(item => item.tier), [
      'Power', 'Proficient', 'Standard', 'Basic', 'Limited', 'Limited',
    ]);
  });

  test('score tier boundaries are strict lower cutoffs', () => {
    const arr = [51.01, 51, 40.01, 40, 30.01, 30, 20.01, 20]
      .map(totalScore => ({ totalScore }));
    assignTiers(arr);
    assert.deepStrictEqual(arr.map(item => item.tier), [
      'Power', 'Proficient', 'Proficient', 'Standard',
      'Standard', 'Basic', 'Basic', 'Limited',
    ]);
  });
});

suite('ScoreEngine._aggregate', () => {
  // Build a simple set of sessions for two users across two months
  const JAN = 1704067200; // 2024-01-01T00:00:00Z
  const FEB = 1706745600; // 2024-02-01T00:00:00Z

  const sessions = [
    // User A: 2 sessions in Jan, 1 in Feb
    { session_id: 's1', user_id: 'userA', created_at: JAN, updated_at: JAN + 3600,
      acus_consumed: 2, playbook_id: 'pb1', pull_requests: [{ pr_url: 'u', pr_state: 'open' }],
      attachments: [], child_session_ids: [] },
    { session_id: 's2', user_id: 'userA', created_at: JAN + 100, updated_at: JAN + 7200,
      acus_consumed: 3, playbook_id: null, pull_requests: [],
      attachments: [{ attachment_id: 'a1', source: 'devin', name: 'x' }], child_session_ids: [] },
    { session_id: 's3', user_id: 'userA', created_at: FEB, updated_at: FEB + 1800,
      acus_consumed: 5, playbook_id: null, pull_requests: [], attachments: [], child_session_ids: [] },
    // User B: 1 session in Jan
    { session_id: 's4', user_id: 'userB', created_at: JAN, updated_at: JAN + 3600,
      acus_consumed: 1, playbook_id: null, pull_requests: [], attachments: [], child_session_ids: [] },
  ];

  const buckets = buildMonthlyBuckets(sessions);

  test('aggregate("All") sums all months for userA', () => {
    const agg = aggregate(buckets, 'userA', 'All');
    assert.strictEqual(agg.sessionCount, 3);
    assertClose(agg.totalACUs, 10); // 2 + 3 + 5
  });

  test('aggregate("All") includes correct outputCount for userA', () => {
    const agg = aggregate(buckets, 'userA', 'All');
    // s1 (PR), s2 (devin attach) = 2 output sessions in Jan; s3 = no output in Feb
    assert.strictEqual(agg.outputCount, 2);
  });

  test('aggregate specific month filters correctly', () => {
    const aggJan = aggregate(buckets, 'userA', '2024-01');
    assert.strictEqual(aggJan.sessionCount, 2);
    assertClose(aggJan.totalACUs, 5); // 2 + 3

    const aggFeb = aggregate(buckets, 'userA', '2024-02');
    assert.strictEqual(aggFeb.sessionCount, 1);
    assertClose(aggFeb.totalACUs, 5);
  });

  test('aggregate for month with no data returns empty bucket', () => {
    const agg = aggregate(buckets, 'userA', '2024-03');
    assert.strictEqual(agg.sessionCount, 0);
    assert.strictEqual(agg.totalACUs, 0);
    assert.strictEqual(agg.outputCount, 0);
  });

  test('aggregate for unknown user returns empty bucket', () => {
    const agg = aggregate(buckets, 'unknownUser', 'All');
    assert.strictEqual(agg.sessionCount, 0);
    assert.strictEqual(agg.totalACUs, 0);
  });

  test('playbookCount correctly counted', () => {
    const aggJan = aggregate(buckets, 'userA', '2024-01');
    assert.strictEqual(aggJan.playbookCount, 1); // only s1 has playbook_id
  });

  test('totalDurationHours computed correctly for a session', () => {
    const aggFeb = aggregate(buckets, 'userA', '2024-02');
    // s3: (FEB + 1800 - FEB) / 3600 = 0.5 hours
    assertClose(aggFeb.totalDurationHours, 0.5);
  });

  test('all-months aggregation equals field-wise sum of individual months (additivity)', () => {
    const aggAll = aggregate(buckets, 'userA', 'All');
    const aggJan = aggregate(buckets, 'userA', '2024-01');
    const aggFeb = aggregate(buckets, 'userA', '2024-02');

    assert.strictEqual(aggAll.sessionCount, aggJan.sessionCount + aggFeb.sessionCount);
    assertClose(aggAll.totalACUs, aggJan.totalACUs + aggFeb.totalACUs);
    assertClose(aggAll.totalDurationHours, aggJan.totalDurationHours + aggFeb.totalDurationHours);
    assert.strictEqual(aggAll.outputCount, aggJan.outputCount + aggFeb.outputCount);
    assert.strictEqual(aggAll.playbookCount, aggJan.playbookCount + aggFeb.playbookCount);
  });
});

suite('EfficiencyScore inversion ordering', () => {
  test('user with lower ACU/output gets higher normalised efficiency score', () => {
    // User A: 10 ACUs, 2 outputs → efficiency = 5
    // User B: 20 ACUs, 2 outputs → efficiency = 10
    // After inversion: invA = max - 5, invB = max - 10 → invA > invB
    // After normalisation: normEffA > normEffB
    const rawEffA = 5;   // lower is better
    const rawEffB = 10;  // higher is worse
    const maxRaw = Math.max(rawEffA, rawEffB); // 10
    const invertedEff = [maxRaw - rawEffA, maxRaw - rawEffB]; // [5, 0]
    const normEff = normalise(invertedEff);
    assert.ok(normEff[0] > normEff[1], 'User A (lower ACU/output) should have higher NormEfficiency');
    assertClose(normEff[0], 100);
    assertClose(normEff[1], 0);
  });

  test('equal efficiencies → all normalised to 0', () => {
    const rawEff = [5, 5, 5];
    const maxRaw = 5;
    const inverted = rawEff.map(v => maxRaw - v); // [0, 0, 0]
    const norm = normalise(inverted);
    norm.forEach(v => assert.strictEqual(v, 0));
  });

  test('zero efficiency (no outputs) treated as 0, others ranked higher', () => {
    // User A: 0 outputs → rawEff = 0
    // User B: 2 ACUs, 1 output → rawEff = 2
    // Inversion: max = 2, invA = 2, invB = 0
    // After normalise: normEffA = 100, normEffB = 0
    // User A (more efficient: produced output per less ACU? No — rawEff=0 means no outputs)
    // Actually per spec: rawEfficiency = 0 when outputCount = 0
    // After inversion invA = max - 0 = max → normEffA is maximum
    const rawEffA = 0; // 0 outputs → 0 raw efficiency
    const rawEffB = 2;
    const maxRaw = Math.max(rawEffA, rawEffB); // 2
    const inverted = [maxRaw - rawEffA, maxRaw - rawEffB]; // [2, 0]
    const norm = normalise(inverted);
    assertClose(norm[0], 100);
    assertClose(norm[1], 0);
  });
});

suite('Department / Job-Function filter exclusion', () => {
  // Simulate _filterUsers logic
  function filterUsers(allUsers, filterState) {
    return allUsers.filter(user => {
      if (filterState.department !== 'All' && user.department_name !== filterState.department) return false;
      if (filterState.jobFunction !== 'All' && user.job_function !== filterState.jobFunction) return false;
      return true;
    });
  }

  const users = [
    { user_id: 'u1', name: 'Alice', department_name: 'Eng', job_function: 'Dev' },
    { user_id: 'u2', name: 'Bob',   department_name: 'Eng', job_function: 'QA'  },
    { user_id: 'u3', name: 'Carol', department_name: 'PM',  job_function: 'Dev' },
    { user_id: 'u4', name: 'Dave',  department_name: 'PM',  job_function: 'PM'  },
  ];

  test('department filter excludes non-matching users', () => {
    const result = filterUsers(users, { department: 'Eng', jobFunction: 'All' });
    assert.strictEqual(result.length, 2);
    assert.ok(result.every(u => u.department_name === 'Eng'));
  });

  test('job function filter excludes non-matching users', () => {
    const result = filterUsers(users, { department: 'All', jobFunction: 'Dev' });
    assert.strictEqual(result.length, 2);
    assert.ok(result.every(u => u.job_function === 'Dev'));
  });

  test('combined department + job function filter', () => {
    const result = filterUsers(users, { department: 'Eng', jobFunction: 'Dev' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].user_id, 'u1');
  });

  test('All filters → all users included', () => {
    const result = filterUsers(users, { department: 'All', jobFunction: 'All' });
    assert.strictEqual(result.length, 4);
  });

  test('filter with no matching users → empty array', () => {
    const result = filterUsers(users, { department: 'Sales', jobFunction: 'All' });
    assert.strictEqual(result.length, 0);
  });

  test('no user with wrong department appears in output', () => {
    const result = filterUsers(users, { department: 'PM', jobFunction: 'All' });
    assert.ok(result.every(u => u.department_name === 'PM'));
    assert.ok(result.every(u => u.department_name !== 'Eng'));
  });
});

suite('MonthlyBucket — session count conservation', () => {
  test('sum of sessionCount across all users/months equals input session count', () => {
    const JAN = 1704067200;
    const FEB = 1706745600;
    const sessions = [
      { session_id: 's1', user_id: 'u1', created_at: JAN, updated_at: JAN+100, acus_consumed: 1,
        playbook_id: null, pull_requests: [], attachments: [], child_session_ids: [] },
      { session_id: 's2', user_id: 'u1', created_at: JAN+200, updated_at: JAN+300, acus_consumed: 2,
        playbook_id: null, pull_requests: [], attachments: [], child_session_ids: [] },
      { session_id: 's3', user_id: 'u2', created_at: FEB, updated_at: FEB+100, acus_consumed: 3,
        playbook_id: null, pull_requests: [], attachments: [], child_session_ids: [] },
    ];
    const buckets = buildMonthlyBuckets(sessions);
    let total = 0;
    for (const userBuckets of buckets.values()) {
      for (const bucket of userBuckets.values()) {
        total += bucket.sessionCount;
      }
    }
    assert.strictEqual(total, sessions.length);
  });

  test('empty sessions array → empty buckets', () => {
    const buckets = buildMonthlyBuckets([]);
    assert.strictEqual(buckets.size, 0);
  });

  test('sessions with { items: [...] } envelope shape are handled', () => {
    const JAN = 1704067200;
    const sessions = { items: [
      { session_id: 's1', user_id: 'u1', created_at: JAN, updated_at: JAN+3600,
        acus_consumed: 2, playbook_id: null, pull_requests: [], attachments: [], child_session_ids: [] },
    ]};
    const buckets = buildMonthlyBuckets(sessions);
    assert.strictEqual(buckets.size, 1);
    assert.strictEqual(buckets.get('u1').get('2024-01').sessionCount, 1);
  });
});

suite('OutputSession classification', () => {
  const BASE_TS = 1704067200; // 2024-01-01

  function buildAndGet(session) {
    const buckets = buildMonthlyBuckets([session]);
    return buckets.get(session.user_id).get(monthKey(session.created_at));
  }

  test('session with pull_requests → outputCount = 1', () => {
    const s = { session_id: 's1', user_id: 'u1', created_at: BASE_TS, updated_at: BASE_TS+100,
                acus_consumed: 1, playbook_id: null,
                pull_requests: [{ pr_url: 'x', pr_state: 'open' }],
                attachments: [], child_session_ids: [] };
    assert.strictEqual(buildAndGet(s).outputCount, 1);
  });

  test('session with devin attachment → outputCount = 1', () => {
    const s = { session_id: 's2', user_id: 'u1', created_at: BASE_TS, updated_at: BASE_TS+100,
                acus_consumed: 1, playbook_id: null, pull_requests: [],
                attachments: [{ attachment_id: 'a1', source: 'devin', name: 'doc' }],
                child_session_ids: [] };
    assert.strictEqual(buildAndGet(s).outputCount, 1);
  });

  test('session with non-devin attachment → outputCount = 0', () => {
    const s = { session_id: 's3', user_id: 'u1', created_at: BASE_TS, updated_at: BASE_TS+100,
                acus_consumed: 1, playbook_id: null, pull_requests: [],
                attachments: [{ attachment_id: 'a2', source: 'user', name: 'doc' }],
                child_session_ids: [] };
    assert.strictEqual(buildAndGet(s).outputCount, 0);
  });

  test('session with no PRs and no attachments → outputCount = 0', () => {
    const s = { session_id: 's4', user_id: 'u1', created_at: BASE_TS, updated_at: BASE_TS+100,
                acus_consumed: 1, playbook_id: null, pull_requests: [],
                attachments: [], child_session_ids: [] };
    assert.strictEqual(buildAndGet(s).outputCount, 0);
  });

  test('session with both PR and devin attachment → outputCount = 1 (not 2)', () => {
    const s = { session_id: 's5', user_id: 'u1', created_at: BASE_TS, updated_at: BASE_TS+100,
                acus_consumed: 1, playbook_id: null,
                pull_requests: [{ pr_url: 'x', pr_state: 'open' }],
                attachments: [{ attachment_id: 'a3', source: 'devin', name: 'doc' }],
                child_session_ids: [] };
    assert.strictEqual(buildAndGet(s).outputCount, 1);
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nSome tests FAILED. Review the errors above.');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✓');
}

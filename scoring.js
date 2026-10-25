(function (root) {
  'use strict';

  const config = Object.freeze({
    scoreMax: 100,
    creatorBonusCap: 5,
    weights: Object.freeze({
      output: 0.50,
      playbook: 0.20,
      frequency: 0.20,
      sessionSize: 0.05,
      efficiency: 0.05,
    }),
    tiers: Object.freeze([
      Object.freeze({ name: 'Power', key: 'power', minExclusive: 51 }),
      Object.freeze({ name: 'Proficient', key: 'proficient', minExclusive: 40 }),
      Object.freeze({ name: 'Standard', key: 'standard', minExclusive: 30 }),
      Object.freeze({ name: 'Basic', key: 'basic', minExclusive: 20 }),
      Object.freeze({ name: 'Limited', key: 'limited', minExclusive: -Infinity }),
    ]),
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
  }
  if (root) {
    root.SCORING_CONFIG = config;
  }
})(typeof window !== 'undefined' ? window : globalThis);

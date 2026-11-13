const {
  AGGREGATION_POLICIES,
  DEFAULT_AGGREGATION_POLICY,
  GUARDIAN_FIELD,
  corroboratingFields,
  isGuardianOnlyMatch,
  normalizeAggregationPolicy,
  selectFlaggedCandidates,
  summarizeAggregation,
} = require('../src/services/duplicateAggregation');

const THRESHOLD = 0.5;

// Two children of one guardian: same school, same guardian, similar names, nothing else.
function sibling(score = 0.93, overrides = {}) {
  return candidate(score, {
    features: {
      jaro_winkler: 0.94, dob_match: 0, school_match: 1, guardian_match: 1, upi_match: 0, birth_certificate_match: 0,
    },
    ...overrides,
  });
}

function candidate(score, overrides = {}) {
  return {
    candidate: { id: overrides.id || `student-${score}-${Math.random()}` },
    score,
    features: { jaro_winkler: 0.9, dob_match: 0, school_match: 1, guardian_match: 0, upi_match: 0, birth_certificate_match: 0 },
    exactIdentifiers: [],
    ...overrides,
  };
}

describe('Registration-level duplicate aggregation', () => {
  const originalPolicy = process.env.DUPLICATE_AGGREGATION_POLICY;

  afterEach(() => {
    if (originalPolicy === undefined) delete process.env.DUPLICATE_AGGREGATION_POLICY;
    else process.env.DUPLICATE_AGGREGATION_POLICY = originalPolicy;
  });

  test('defaults to top-1 so one registration cannot flood the review queue', () => {
    expect(DEFAULT_AGGREGATION_POLICY).toBe('top-1');
    expect(normalizeAggregationPolicy(undefined)).toBe('top-1');
    expect(normalizeAggregationPolicy('')).toBe('top-1');
  });

  test('reads DUPLICATE_AGGREGATION_POLICY and rejects unknown values', () => {
    process.env.DUPLICATE_AGGREGATION_POLICY = 'top-1-corroborated';
    expect(normalizeAggregationPolicy()).toBe('top-1-corroborated');
    expect(normalizeAggregationPolicy(' ALL ')).toBe('all');
    expect(() => normalizeAggregationPolicy('top-3')).toThrow(/DUPLICATE_AGGREGATION_POLICY/);
    expect(AGGREGATION_POLICIES).toEqual(['top-1', 'top-1-corroborated', 'all']);
  });

  test('creates only one flag when several candidates exceed the cutoff', () => {
    const scored = [
      candidate(0.55, { id: 'a' }),
      candidate(0.91, { id: 'b' }),
      candidate(0.73, { id: 'c' }),
      candidate(0.10, { id: 'below-cutoff' }),
    ];

    const selected = selectFlaggedCandidates(scored, { policy: 'top-1', threshold: THRESHOLD });

    expect(selected).toHaveLength(1);
    expect(selected[0].candidate.id).toBe('b');
    expect(selected[0].score).toBe(0.91);
  });

  test('ranks exact identifier agreement above a higher model score', () => {
    const scored = [
      candidate(0.97, { id: 'score-only' }),
      candidate(0.35, { id: 'exact-identifier', exactIdentifiers: ['UPI'] }),
    ];

    const selected = selectFlaggedCandidates(scored, { policy: 'top-1', threshold: THRESHOLD });

    expect(selected).toHaveLength(1);
    expect(selected[0].candidate.id).toBe('exact-identifier');
  });

  test('breaks score ties deterministically by comparison order', () => {
    const selected = selectFlaggedCandidates(
      [candidate(0.8, { id: 'first' }), candidate(0.8, { id: 'second' })],
      { policy: 'top-1', threshold: THRESHOLD },
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].candidate.id).toBe('first');
  });

  test('never flags a candidate below the cutoff without an exact identifier match', () => {
    const selected = selectFlaggedCandidates([candidate(0.49, { id: 'below' })], {
      policy: 'top-1',
      threshold: THRESHOLD,
    });

    expect(selected).toEqual([]);
  });

  test('flags a below-cutoff candidate when an identifier matches exactly', () => {
    const selected = selectFlaggedCandidates(
      [candidate(0.2, { id: 'exact', exactIdentifiers: ['birth certificate number'] })],
      { policy: 'top-1', threshold: THRESHOLD },
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].exactIdentifiers).toEqual(['birth certificate number']);
  });

  test('all keeps the legacy one-flag-per-candidate behaviour for comparison', () => {
    const scored = [candidate(0.55), candidate(0.91), candidate(0.10)];

    const selected = selectFlaggedCandidates(scored, { policy: 'all', threshold: THRESHOLD });

    expect(selected).toHaveLength(2);
  });

  test('top-1-corroborated suppresses weak single-field candidates', () => {
    const weak = candidate(0.62, { id: 'name-and-school-only' });
    const corroborated = candidate(0.62, {
      id: 'dob-and-guardian',
      features: { ...weak.features, dob_match: 1, guardian_match: 1 },
    });

    expect(selectFlaggedCandidates([weak], { policy: 'top-1-corroborated', threshold: THRESHOLD })).toEqual([]);
    expect(selectFlaggedCandidates([corroborated], { policy: 'top-1-corroborated', threshold: THRESHOLD })).toHaveLength(1);
  });

  test('top-1-corroborated still flags an exact identifier match without other corroboration', () => {
    const exact = candidate(0.3, { id: 'exact', exactIdentifiers: ['National ID'] });

    expect(selectFlaggedCandidates([exact], { policy: 'top-1-corroborated', threshold: THRESHOLD })).toHaveLength(1);
  });

  test('counts qualifying and suppressed candidates for the audit trail', () => {
    const scored = [candidate(0.55), candidate(0.91), candidate(0.10), candidate(0.2, { exactIdentifiers: ['UPI'] })];
    const flagged = selectFlaggedCandidates(scored, { policy: 'top-1', threshold: THRESHOLD });

    const summary = summarizeAggregation(scored, flagged, { policy: 'top-1', threshold: THRESHOLD });

    expect(summary).toEqual({
      policy: 'top-1',
      candidates_considered: 4,
      candidates_qualifying: 3,
      candidates_guardian_only: 0,
      flags_selected: 1,
      candidates_suppressed: 2,
    });
  });

  test('a shared guardian id alone is a sibling, not a duplicate', () => {
    const { features } = sibling();
    expect(GUARDIAN_FIELD).toBe('guardian_match');
    expect(corroboratingFields(features)).toEqual(['guardian_match']);
    expect(isGuardianOnlyMatch(features)).toBe(true);

    // Every policy obeys the rule, including the legacy one used for comparison.
    for (const policy of AGGREGATION_POLICIES) {
      expect(selectFlaggedCandidates([sibling()], { policy, threshold: THRESHOLD })).toEqual([]);
    }
  });

  test('a shared guardian still flags as soon as one independent field agrees', () => {
    const sameChild = sibling(0.86, {
      id: 'same-child',
      features: {
        jaro_winkler: 0.94, dob_match: 1, school_match: 1, guardian_match: 1, upi_match: 0, birth_certificate_match: 0,
      },
    });

    expect(isGuardianOnlyMatch(sameChild.features)).toBe(false);
    const selected = selectFlaggedCandidates([sameChild], { policy: 'top-1', threshold: THRESHOLD });
    expect(selected).toHaveLength(1);
    expect(selected[0].candidate.id).toBe('same-child');
  });

  test('an exact identifier outranks the guardian rule', () => {
    const exact = sibling(0.3, { id: 'exact-identifier', exactIdentifiers: ['UPI'] });

    expect(isGuardianOnlyMatch(exact.features, exact.exactIdentifiers)).toBe(false);
    expect(selectFlaggedCandidates([exact], { policy: 'top-1', threshold: THRESHOLD })).toHaveLength(1);
  });

  test('the audit summary counts sibling pairs apart from near misses', () => {
    const scored = [candidate(0.55, { id: 'name-and-school' }), sibling()];
    const flagged = selectFlaggedCandidates(scored, { policy: 'top-1', threshold: THRESHOLD });

    const summary = summarizeAggregation(scored, flagged, { policy: 'top-1', threshold: THRESHOLD });

    expect(summary).toEqual({
      policy: 'top-1',
      candidates_considered: 2,
      candidates_qualifying: 1,
      candidates_guardian_only: 1,
      flags_selected: 1,
      candidates_suppressed: 0,
    });
  });

  test('corroboration ignores name similarity and shared school', () => {
    expect(corroboratingFields({ jaro_winkler: 1, school_match: 1 })).toEqual([]);
    expect(corroboratingFields({ upi_match: 1, birth_certificate_match: 0.99 })).toEqual([
      'upi_match',
      'birth_certificate_match',
    ]);
  });

  test('rejects a missing threshold instead of guessing one', () => {
    expect(() => selectFlaggedCandidates([candidate(0.9)], { policy: 'top-1' })).toThrow(/threshold/);
    expect(() => summarizeAggregation([], [], { policy: 'top-1' })).toThrow(/threshold/);
  });
});

/**
 * Suffix tables for `standard` notation.
 *
 * Tiers 1-10 (1e3 … 1e30) use the familiar short-scale abbreviations. From
 * tier 11 (1e33) upwards names are composed from ones + tens + hundreds
 * fragments, so 1e45 (tier 15, index 14) is `Qa` + `Dc` = `QaDc`.
 */
export const SMALL_SUFFIXES: readonly string[] = [
  'k',
  'M',
  'B',
  'T',
  'Qa',
  'Qi',
  'Sx',
  'Sp',
  'Oc',
  'No',
];

export const ONES_FRAGMENTS: readonly string[] = [
  '',
  'U',
  'D',
  'T',
  'Qa',
  'Qi',
  'Sx',
  'Sp',
  'Oc',
  'N',
];

export const TENS_FRAGMENTS: readonly string[] = [
  '',
  'Dc',
  'Vg',
  'Tg',
  'qg',
  'Qg',
  'sg',
  'Sg',
  'Og',
  'Ng',
];

export const HUNDREDS_FRAGMENTS: readonly string[] = [
  '',
  'Ce',
  'Dn',
  'Tc',
  'Qd',
  'Qe',
  'Se',
  'St',
  'Og',
  'Nn',
];

/** Tier at which composed suffixes begin (1e33). */
export const COMPOSED_SUFFIX_START_TIER = 11;

/** Above this tier there is no name left to compose; fall back to scientific. */
export const MAX_NAMED_TIER = 1000;

export const DURATION_UNITS: readonly { readonly label: string; readonly ms: number }[] = [
  { label: 'd', ms: 86_400_000 },
  { label: 'h', ms: 3_600_000 },
  { label: 'm', ms: 60_000 },
  { label: 's', ms: 1_000 },
];

/**
 * FATF jurisdiction policy snapshot used by consistency tests and as the documented source of truth
 * for which ISO-2 codes DFX must block under FATF black/grey-list obligations.
 *
 * This snapshot is reviewed after every FATF plenary (typically February, June, October).
 * Compliance owns the decision. Changes to this file without a matching migration and seed update
 * will fail the tests in `__tests__/fatf-policy.spec.ts` — that is intentional.
 * The FATF website is **never** queried at runtime.
 */

/** Effective date of this snapshot (last FATF plenary incorporated). */
export const FATF_POLICY_EFFECTIVE_DATE = '2026-06-19' as const;

/** Authoritative FATF publications for this snapshot. */
export const FATF_POLICY_SOURCES = [
  'https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html',
  'https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/increased-monitoring-june-2026.html',
] as const;

/** Call for action (black list) — high-risk jurisdictions subject to a call for action. */
export const FATF_CALL_FOR_ACTION = ['IR', 'KP', 'MM'] as const;

/** Increased monitoring (grey list) — jurisdictions under increased monitoring. Alphabetical. */
export const FATF_INCREASED_MONITORING = [
  'AO',
  'BA',
  'BG',
  'BO',
  'CD',
  'CI',
  'CM',
  'HT',
  'IQ',
  'KE',
  'KW',
  'LA',
  'LB',
  'MC',
  'NP',
  'PG',
  'SS',
  'SY',
  'VE',
  'VG',
  'VN',
  'YE',
] as const;

/** Union of call-for-action and increased-monitoring lists. Alphabetical, 25 entries. */
export const FATF_LISTED_COUNTRIES = [
  'AO',
  'BA',
  'BG',
  'BO',
  'CD',
  'CI',
  'CM',
  'HT',
  'IQ',
  'IR',
  'KE',
  'KP',
  'KW',
  'LA',
  'LB',
  'MC',
  'MM',
  'NP',
  'PG',
  'SS',
  'SY',
  'VE',
  'VG',
  'VN',
  'YE',
] as const;

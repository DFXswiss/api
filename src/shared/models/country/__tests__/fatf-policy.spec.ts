import * as fs from 'fs';
import * as path from 'path';
import {
  FATF_CALL_FOR_ACTION,
  FATF_INCREASED_MONITORING,
  FATF_LISTED_COUNTRIES,
  FATF_POLICY_EFFECTIVE_DATE,
  FATF_POLICY_SOURCES,
} from '../fatf-policy';

describe('FATF policy fixture', () => {
  it('uses the June 2026 snapshot metadata', () => {
    expect(FATF_POLICY_EFFECTIVE_DATE).toBe('2026-06-19');
    expect(FATF_POLICY_SOURCES).toEqual([
      'https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html',
      'https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/increased-monitoring-june-2026.html',
    ]);
  });

  it('lists exactly 25 unique alphabetically sorted ISO-2 codes', () => {
    expect(FATF_LISTED_COUNTRIES).toHaveLength(25);
    expect(new Set(FATF_LISTED_COUNTRIES).size).toBe(25);
    expect([...FATF_LISTED_COUNTRIES]).toEqual([...FATF_LISTED_COUNTRIES].sort());
  });

  it('keeps call-for-action and increased-monitoring disjoint', () => {
    const callForAction = new Set<string>(FATF_CALL_FOR_ACTION);
    const increased = new Set<string>(FATF_INCREASED_MONITORING);
    for (const code of callForAction) {
      expect(increased.has(code)).toBe(false);
    }
    expect(FATF_CALL_FOR_ACTION).toHaveLength(3);
    expect(FATF_INCREASED_MONITORING).toHaveLength(22);
    expect([...FATF_INCREASED_MONITORING]).toEqual([...FATF_INCREASED_MONITORING].sort());
  });

  it('includes CD (DR Congo) and excludes CG (Republic of the Congo)', () => {
    expect(FATF_LISTED_COUNTRIES).toContain('CD');
    expect(FATF_LISTED_COUNTRIES).not.toContain('CG');
  });

  it('equals the sorted union of the two component lists', () => {
    const union = [...new Set([...FATF_CALL_FOR_ACTION, ...FATF_INCREASED_MONITORING])].sort();
    expect([...FATF_LISTED_COUNTRIES]).toEqual(union);
  });
});

describe('FATF policy vs seed country.csv', () => {
  const csvPath = path.join(__dirname, '../../../../../migration/seed/country.csv');

  type SeedRow = {
    symbol: string;
    dfxEnable: string;
    fatfEnable: string;
    nationalityStepEnable: string;
    ipEnable: string;
  };

  const loadSeed = (): Map<string, SeedRow> => {
    const text = fs.readFileSync(csvPath, 'utf8');
    const lines = text.trim().split(/\r?\n/);
    const header = lines[0].split(',');
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const map = new Map<string, SeedRow>();
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const cols = line.split(',');
      map.set(cols[idx.symbol], {
        symbol: cols[idx.symbol],
        dfxEnable: cols[idx.dfxEnable],
        fatfEnable: cols[idx.fatfEnable],
        nationalityStepEnable: cols[idx.nationalityStepEnable],
        ipEnable: cols[idx.ipEnable],
      });
    }
    return map;
  };

  it('requires every FATF-listed symbol to exist in the seed CSV', () => {
    const seed = loadSeed();
    for (const symbol of FATF_LISTED_COUNTRIES) {
      expect(seed.has(symbol)).toBe(true);
    }
  });

  it('requires every FATF-listed symbol to be fully blocked in the seed (fatf/dfx/nationalityStep)', () => {
    // Seed invariant (forward only): every FATF-listed jurisdiction must be blocked in country.csv
    // so a freshly seeded local environment matches production compliance behaviour.
    //
    // The reverse is intentionally NOT asserted: DFX may block jurisdictions beyond the FATF lists
    // (currently seven over-blocks). Cleaning those over-blocks is a separate compliance decision
    // and must not be forced by this guardrail.
    const seed = loadSeed();
    for (const symbol of FATF_LISTED_COUNTRIES) {
      const row = seed.get(symbol);
      expect(row).toBeDefined();
      expect(row!.fatfEnable).toBe('FALSE');
      expect(row!.dfxEnable).toBe('FALSE');
      expect(row!.nationalityStepEnable).toBe('FALSE');
    }
  });

  it('requires every call-for-action symbol to have ipEnable=FALSE in the seed', () => {
    // IP block is the stricter measure and is reserved in the seed for the black-list set
    // (FATF_CALL_FOR_ACTION). The 22 increased-monitoring jurisdictions keep ipEnable=TRUE,
    // and the BlockFatfListedCountries migration does not touch ipEnable at all.
    //
    // Forward only: every call-for-action jurisdiction must be IP-blocked in country.csv.
    // The reverse is intentionally NOT asserted: DFX may IP-block beyond the FATF lists.
    // Measured 2026-08-07 against GET https://api.dfx.swiss/v1/country: production returns
    // locationAllowed=false for IL, IR, KP, MM, US — so IL and US sit outside any FATF list.
    // An equality assertion would already be false today.
    const seed = loadSeed();
    expect(FATF_CALL_FOR_ACTION).toHaveLength(3);
    expect(FATF_CALL_FOR_ACTION.filter((s) => seed.get(s)?.ipEnable !== 'FALSE')).toEqual([]);
  });
});

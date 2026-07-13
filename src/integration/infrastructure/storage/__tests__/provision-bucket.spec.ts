import { GEBUEV_RETENTION_FLOOR_YEARS, getRetentionYears } from '../../../../../scripts/storage/provision-bucket';

// Proves the GeBüV retention-floor guard in the WORM bucket provisioning script: COMPLIANCE-mode
// Object Lock retention is extend-only/irreversible, so a value below the 10-year floor must fail
// closed rather than silently under-retain compliance objects.
describe('provision-bucket getRetentionYears (GeBüV retention floor)', () => {
  const RETENTION_ENV = 'RETENTION_YEARS';
  let savedEnv: string | undefined;
  let savedArgv: string[];

  beforeEach(() => {
    savedEnv = process.env[RETENTION_ENV];
    savedArgv = process.argv;
    // Neutralize the positional CLI fallback (process.argv[3]) that getRetentionYears also reads.
    process.argv = ['node', 'provision-bucket.ts'];
    delete process.env[RETENTION_ENV];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[RETENTION_ENV];
    else process.env[RETENTION_ENV] = savedEnv;
    process.argv = savedArgv;
  });

  it('exposes a 10-year GeBüV floor', () => {
    expect(GEBUEV_RETENTION_FLOOR_YEARS).toBe(10);
  });

  it('defaults to 11 years (GeBüV 10y + safety margin) when unset', () => {
    expect(getRetentionYears()).toBe(11);
  });

  it('rejects RETENTION_YEARS=9 with a GeBüV-floor error and does not fall back to a value', () => {
    process.env[RETENTION_ENV] = '9';
    expect(() => getRetentionYears()).toThrow(/GeBüV 10-year retention floor/);
  });

  it('rejects every year below the floor (1..9)', () => {
    for (let y = 1; y <= GEBUEV_RETENTION_FLOOR_YEARS - 1; y++) {
      process.env[RETENTION_ENV] = String(y);
      expect(() => getRetentionYears()).toThrow(/below the GeBüV/);
    }
  });

  it('accepts exactly the 10-year floor', () => {
    process.env[RETENTION_ENV] = '10';
    expect(getRetentionYears()).toBe(10);
  });

  it('accepts 11 years (the default, above the floor)', () => {
    process.env[RETENTION_ENV] = '11';
    expect(getRetentionYears()).toBe(11);
  });

  it('still rejects non-positive / non-integer values before the floor check', () => {
    process.env[RETENTION_ENV] = '0';
    expect(() => getRetentionYears()).toThrow(/expected positive integer/);

    process.env[RETENTION_ENV] = '10.5';
    expect(() => getRetentionYears()).toThrow(/expected positive integer/);
  });
});
